const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const {
  signAccessToken, signRefreshToken, setAuthCookies, clearAuthCookies,
  requireAuth
} = require('../middleware/auth');

// helper DB
async function q(sql, params) {
  const r = await db.query(sql, params);
  return r.rows || r[0] || r;
}
function hash(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

// POST /api/auth/login  { email | phone | username, password }
router.post('/login', async (req, res) => {
  const { email, phone, username, password } = req.body || {};
  const raw = (email ?? phone ?? username);
  if (!raw || !password) {
    console.log('[AUTH] 400 lipsă ident/parolă', { raw: !!raw, hasPassword: !!password });
    return res.status(400).json({ error: 'email/telefon sau username + parolă necesare' });
  }
  const ident = String(raw).trim();
  console.log('[AUTH] încerc login pentru ident=', ident);

  // Caută atât pe email cât și pe telefon (ident introdus într-un singur câmp)
  const rows = await q(
    `SELECT id, name, email, phone, username, role, operator_id, active, password_hash
       FROM employees
      WHERE (email = ? OR phone = ? OR username = ?)
      LIMIT 1`,
    [ident, ident, ident]
  );
  const emp = rows && rows[0] ? rows[0] : null;
  if (!emp) {
    console.log('[AUTH] 401 user negăsit pentru ident=', ident);
    return res.status(401).json({ error: 'cont invalid sau inactiv' });
  }
  if (!emp.active) {
    console.log('[AUTH] 401 user inactiv id=', emp.id);
    return res.status(401).json({ error: 'cont invalid sau inactiv' });
  }

  let ok = false;
  try {
    if (emp.password_hash && password) {
      ok = await bcrypt.compare(String(password), String(emp.password_hash));
    }
  } catch (err) {
    console.error('[AUTH] eroare bcrypt.compare', err);
    ok = false;
  }
  if (!ok) {
    console.log('[AUTH] 401 parolă greșită pentru id=', emp.id);
    return res.status(401).json({ error: 'credențiale invalide' });
  }

  const payload = {
    id: emp.id,
    role: emp.role,
    operator_id: emp.operator_id,
    name: emp.name,
    email: emp.email,
    username: emp.username,
  };
  const access = signAccessToken(payload);
  const refresh = signRefreshToken({ sid: crypto.randomUUID(), ...payload });

  await q(
    `INSERT INTO sessions (employee_id, token_hash, user_agent, ip, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))`,
    [emp.id, hash(refresh), req.headers['user-agent'] || null, req.ip || null]
  );

  setAuthCookies(res, access, refresh);
  console.log('[AUTH] 200 login OK id=', emp.id, 'role=', emp.role);
  return res.json({ ok: true, user: payload });
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  const refresh = req.cookies?.refresh_token;
  if (!refresh) return res.status(401).json({ error: 'no refresh' });

  // validăm semnătura JWT
  let payload;
  try {
    payload = require('jsonwebtoken').verify(refresh, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'refresh invalid' });
  }

  // verificăm în DB existența token-ului
  const rows = await q('SELECT id, employee_id, revoked_at, expires_at FROM sessions WHERE token_hash=? LIMIT 1', [hash(refresh)]);
  const sess = rows[0];
  if (!sess || sess.revoked_at) return res.status(401).json({ error: 'refresh revocat' });

  // rotim refresh-ul (nou hash, marcăm rotated_from)
  await q('UPDATE sessions SET revoked_at=NOW() WHERE id=?', [sess.id]);

  const empRows = await q('SELECT id, name, email, role, operator_id, active FROM employees WHERE id=? LIMIT 1', [sess.employee_id]);
  const emp = empRows[0];
  if (!emp) {
    console.log('[AUTH] nu a găsit employee pentru', ident);
    return res.status(401).json({ error: 'cont invalid sau inactiv' });
  }
  if (!emp.active) {
    console.log('[AUTH] employee inactiv id=', emp.id);
    return res.status(401).json({ error: 'cont invalid sau inactiv' });
  }

  const newPayload = {
    id: emp.id,
    role: emp.role,
    operator_id: emp.operator_id,
    name: emp.name,
    email: emp.email,
    username: emp.username,
  };
  const access = signAccessToken(newPayload);
  const newRefresh = signRefreshToken({ sid: crypto.randomUUID(), ...newPayload });
  await q(
    `INSERT INTO sessions (employee_id, token_hash, user_agent, ip, expires_at, rotated_from)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), ?)`,
    [emp.id, hash(newRefresh), req.headers['user-agent'] || null, req.ip || null, hash(refresh)]
  );
  setAuthCookies(res, access, newRefresh);
  res.json({ ok: true });
});

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req, res) => {
  const refresh = req.cookies?.refresh_token;
  if (refresh) {
    await q('UPDATE sessions SET revoked_at=NOW() WHERE token_hash=?', [hash(refresh)]);
  }
  clearAuthCookies(res);
  res.json({ ok: true });
});

 
// GET /api/auth/me — întoarce utilizatorul curent sau null (NU cere autentificare)
router.get('/me', (req, res) => {
  // req.user e setat de verifyAccessToken (dacă există cookie valid)
  res.status(200).json({ user: req.user || null });
});



module.exports = router;
