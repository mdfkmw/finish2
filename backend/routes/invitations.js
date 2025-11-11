const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { sendMailSafe, isMailerConfigured } = require('../utils/mailer');

// helper
async function q(sql, params) {
  const r = await db.query(sql, params);
  return r.rows || r[0] || r;
}
function genToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function resolveBaseUrl(req) {
  const configured = process.env.INVITE_BASE_URL;
  if (configured) {
    try {
      return new URL(configured).toString().replace(/\/?$/, '/');
    } catch (_) {
      console.warn('[invitations] INVITE_BASE_URL invalid, ignorăm valoarea.');
    }
  }

  const headerOrigin = req.headers['x-forwarded-origin'] || req.headers.origin;
  if (headerOrigin) {
    try {
      return new URL(headerOrigin).toString().replace(/\/?$/, '/');
    } catch (_) {
      console.warn('[invitations] Origin invalid pentru invitație:', headerOrigin);
    }
  }

  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:5173';
  return `${protocol}://${host}/`;
}

function buildInviteUrl(req, token) {
  const base = resolveBaseUrl(req);
  try {
    return new URL(`/invita/${token}`, base).toString();
  } catch (err) {
    console.warn('[invitations] nu am putut construi linkul de invitație:', err?.message || err);
    return `${base.replace(/\/?$/, '/') || 'http://localhost:5173/'}invita/${token}`;
  }
}

async function loadInvitation(token) {
  const rows = await q('SELECT * FROM invitations WHERE token=? LIMIT 1', [token]);
  return rows[0];
}

// POST /api/invitations  (admin/operator_admin)
router.post('/', requireRole('admin','operator_admin'), async (req, res) => {
  const { role, operator_id = null, email, ttl_hours = 72 } = req.body || {};
  if (!role || !email) return res.status(400).json({ error: 'role și email obligatorii' });

  const token = genToken();
  await q(
    `INSERT INTO invitations (token, role, operator_id, email, expires_at, created_by)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), ?)`,
    [token, role, operator_id || null, email, ttl_hours, req.user?.id || null]
  );
  const inviteUrl = buildInviteUrl(req, token);

  let emailResult = null;
  if (isMailerConfigured()) {
    const expiresAtRows = await q('SELECT expires_at FROM invitations WHERE token=?', [token]);
    const expiresAt = expiresAtRows[0]?.expires_at ? new Date(expiresAtRows[0].expires_at) : null;
    const expiresInfo = expiresAt ? expiresAt.toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' }) : null;

    const text = [
      'Bună,',
      '',
      'Ai primit o invitație să folosești platforma Pris-Com.',
      'Apasă pe linkul de mai jos pentru a-ți configura contul și parola:',
      inviteUrl,
      '',
      expiresInfo ? `Invitația expiră la ${expiresInfo}.` : 'Invitația este valabilă pentru o perioadă limitată.',
      '',
      'Dacă nu te aștepți la acest mesaj, ignoră-l.',
      '',
      'Echipa Pris-Com',
    ].join('\n');

    const html = `
      <p>Bună,</p>
      <p>Ai primit o invitație să folosești platforma <strong>Pris-Com</strong>.</p>
      <p><a href="${inviteUrl}">Apasă aici pentru a-ți configura contul</a>.</p>
      <p>${expiresInfo ? `Invitația expiră la <strong>${expiresInfo}</strong>.` : 'Invitația este valabilă pentru o perioadă limitată.'}</p>
      <p>Dacă nu te aștepți la acest mesaj, ignoră-l.</p>
      <p>Echipa Pris-Com</p>
    `;

    emailResult = await sendMailSafe({
      to: email,
      subject: 'Invitație Pris-Com',
      text,
      html,
    });
  }

  res.status(201).json({
    token,
    invite_url: inviteUrl,
    expires_in_hours: ttl_hours,
    email_sent: Boolean(emailResult),
  });
});

// POST /api/invitations/accept  { token, name, password }
router.post('/accept', async (req, res) => {
  const { token, name, username, password } = req.body || {};
  if (!token || !name || !username || !password) {
    return res.status(400).json({ error: 'token, nume, username și parolă necesare' });
  }

  const inv = await loadInvitation(token);
  if (!inv) return res.status(400).json({ error: 'invitație invalidă' });
  if (inv.used_at) return res.status(400).json({ error: 'invitație deja folosită' });
  if (new Date(inv.expires_at) < new Date()) return res.status(400).json({ error: 'invitație expirată' });

  const trimmedUsername = String(username).trim();
  if (!trimmedUsername) {
    return res.status(400).json({ error: 'username invalid' });
  }

  const existingUsername = await q('SELECT id FROM employees WHERE username = ? LIMIT 1', [trimmedUsername]);
  if (existingUsername.length) {
    return res.status(409).json({ error: 'Username-ul este deja folosit.' });
  }

  const existingEmail = await q('SELECT id FROM employees WHERE email = ? LIMIT 1', [inv.email]);
  if (existingEmail.length) {
    return res.status(409).json({ error: 'Există deja un cont cu acest email. Cere administratorului un alt link.' });
  }

  const pass = await bcrypt.hash(password, 12);
  // creăm employee
  await q(
    `INSERT INTO employees (name, username, email, role, operator_id, active, password_hash)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    [name, trimmedUsername, inv.email, inv.role, inv.operator_id || 1, pass]
  );
  const emp = await q('SELECT id FROM employees WHERE email=? ORDER BY id DESC LIMIT 1', [inv.email]);

  // marcăm invitația ca folosită
  await q('UPDATE invitations SET used_at=NOW(), used_by=? WHERE id=?', [emp[0].id, inv.id]);

  res.json({ ok: true });
});

// GET /api/invitations/:token — detalii pentru formularul de acceptare
router.get('/:token', async (req, res) => {
  const { token } = req.params;
  if (!token) return res.status(400).json({ error: 'token lipsă' });

  const inv = await loadInvitation(token);
  if (!inv) return res.status(404).json({ error: 'Invitație inexistentă' });

  const expired = new Date(inv.expires_at) < new Date();
  res.json({
    email: inv.email,
    role: inv.role,
    operator_id: inv.operator_id,
    expires_at: inv.expires_at,
    used_at: inv.used_at,
    expired,
  });
});

module.exports = router;
