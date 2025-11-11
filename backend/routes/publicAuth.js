const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { isMailerConfigured, sendMailSafe } = require('../utils/mailer');
const {
  PUBLIC_REFRESH_COOKIE,
  PUBLIC_REFRESH_TTL_SEC,
  PUBLIC_REFRESH_REMEMBER_TTL_SEC,
  signPublicAccessToken,
  signPublicRefreshToken,
  setPublicAuthCookies,
  clearPublicAuthCookies,
  requirePublicAuth,
} = require('../middleware/publicAuth');

const router = express.Router();

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeEmail(raw) {
  if (!raw) return '';
  return String(raw).trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

function normalizePhone(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str) return null;
  const hasPlus = str.startsWith('+');
  const digits = str.replace(/\D/g, '');
  if (digits.length < 7) return null;
  const normalizedDigits = digits.slice(0, 20);
  if (hasPlus) {
    return `+${normalizedDigits}`;
  }
  if (normalizedDigits.startsWith('40') && normalizedDigits.length >= 10) {
    return `0${normalizedDigits.slice(-9)}`;
  }
  if (normalizedDigits.startsWith('0')) {
    return normalizedDigits;
  }
  if (normalizedDigits.length === 9) {
    return `0${normalizedDigits}`;
  }
  return normalizedDigits;
}

function normalizePhoneDigits(phone) {
  if (!phone) return null;
  return String(phone).replace(/\D/g, '').slice(0, 20) || null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function mapUser(row) {
  const id = typeof row.id === 'bigint' ? Number(row.id) : Number(row.id);
  return {
    id,
    email: row.email,
    name: row.name || null,
    phone: row.phone || null,
    emailVerified: Boolean(row.email_verified_at),
    phoneVerified: Boolean(row.phone_verified_at),
  };
}

function buildSession(row, overrides = {}) {
  return {
    user: mapUser(row),
    ...overrides,
  };
}

async function loadUserById(id) {
  const { rows } = await db.query(
    `SELECT id, email, name, phone, phone_normalized, email_verified_at, phone_verified_at
       FROM public_users
      WHERE id = ?
      LIMIT 1`,
    [id]
  );
  return rows && rows.length ? rows[0] : null;
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim().slice(0, 64) || null;
  }
  return (req.ip || '').slice(0, 64) || null;
}

async function createSession(req, res, userRow, options = {}) {
  const remember = Boolean(options.remember);
  const ttlSec = options.refreshTtlSec || (remember ? PUBLIC_REFRESH_REMEMBER_TTL_SEC : PUBLIC_REFRESH_TTL_SEC);
  const sessionId = crypto.randomUUID();
  const userId = typeof userRow.id === 'bigint' ? Number(userRow.id) : Number(userRow.id);
  const accessPayload = {
    id: userId,
    email: userRow.email,
    name: userRow.name || null,
  };
  const refreshPayload = {
    sid: sessionId,
    userId,
    remember,
  };

  const accessToken = signPublicAccessToken(accessPayload);
  const refreshToken = signPublicRefreshToken(refreshPayload);
  const refreshHash = sha256(refreshToken);

  await db.query(
    `INSERT INTO public_user_sessions (user_id, token_hash, user_agent, ip_address, created_at, expires_at, persistent, rotated_from)
     VALUES (?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND), ?, ?)`
    ,
    [
      userId,
      refreshHash,
      (req.headers['user-agent'] || '').slice(0, 255) || null,
      clientIp(req),
      ttlSec,
      remember ? 1 : 0,
      options.rotatedFromHash || null,
    ]
  );

  await db.query('UPDATE public_users SET last_login_at = NOW(), updated_at = NOW() WHERE id = ?', [userId]);

  setPublicAuthCookies(res, accessToken, refreshToken, { remember, refreshTtlSec: ttlSec });
  const session = buildSession(userRow);

  res.status(options.statusCode || 200).json({
    success: true,
    message: options.message || null,
    session,
  });
}

router.get('/session', async (req, res) => {
  if (!req.publicUser) {
    return res.json({ success: true, session: null });
  }
  const userRow = await loadUserById(req.publicUser.id);
  if (!userRow) {
    clearPublicAuthCookies(res);
    return res.json({ success: true, session: null });
  }
  return res.json({ success: true, session: buildSession(userRow) });
});

router.post('/register', async (req, res) => {
  const { email, password, name, phone } = req.body || {};
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    return res.status(400).json({ error: 'Te rugăm să introduci o adresă de email validă.' });
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'Parola trebuie să aibă cel puțin 8 caractere.' });
  }

  const existing = await db.query(
    'SELECT id FROM public_users WHERE email_normalized = ? LIMIT 1',
    [normalizedEmail]
  );
  if (existing.rows.length) {
    return res.json({ success: false, message: 'Există deja un cont pentru această adresă de email.' });
  }

  const hashedPassword = await bcrypt.hash(String(password), 12);
  const cleanedPhone = normalizePhone(phone);
  const normalizedDigits = normalizePhoneDigits(cleanedPhone);

  const insert = await db.query(
    `INSERT INTO public_users (email, email_normalized, password_hash, name, phone, phone_normalized, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      String(email).trim(),
      normalizedEmail,
      hashedPassword,
      name ? String(name).trim() : null,
      cleanedPhone,
      normalizedDigits,
    ]
  );

  const userId = insert.insertId;
  const userRow = await loadUserById(userId);
  if (!userRow) {
    return res.status(500).json({ error: 'Nu am putut crea contul. Încearcă din nou.' });
  }

  if (isMailerConfigured()) {
    const displayName = userRow.name ? userRow.name.trim() : null;
    const textBody = [
      `Bine ai venit${displayName ? `, ${displayName}` : ''}!`,
      '',
      'Ți-am creat contul pe pris-com.ro. Poți accesa rezervările tale și să gestionezi plecările direct din contul tău.',
      '',
      'Dacă nu tu ai creat acest cont, te rugăm să ne contactezi.',
    ].join('\n');

    const htmlBody = [
      '<!DOCTYPE html>',
      '<html lang="ro">',
      '  <body style="font-family: Arial, sans-serif; color: #111;">',
      `    <p>Bine ai venit${displayName ? `, ${escapeHtml(displayName)}` : ''}!</p>`,
      '    <p>Contul tău pe <strong>pris-com.ro</strong> a fost creat cu succes. De acum poți vedea și gestiona rezervările online.</p>',
      '    <p>Dacă nu tu ai inițiat această acțiune, anunță-ne imediat pentru a securiza contul.</p>',
      '    <p style="margin-top: 24px;">Mulțumim,<br /><strong>Echipa Pris-Com</strong></p>',
      '  </body>',
      '</html>',
    ].join('\n');

    sendMailSafe({
      to: normalizedEmail,
      subject: 'Bine ai venit la Pris-Com',
      text: textBody,
      html: htmlBody,
      from: process.env.SMTP_FROM,
    });
  }

  return createSession(req, res, userRow, {
    statusCode: 201,
    message: 'Cont creat cu succes! Bine ai venit.',
  });
});

router.post('/login', async (req, res) => {
  const { email, password, remember } = req.body || {};
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: 'Introdu emailul și parola pentru autentificare.' });
  }

  const { rows } = await db.query(
    `SELECT id, email, name, phone, phone_normalized, password_hash, email_verified_at, phone_verified_at
       FROM public_users
      WHERE email_normalized = ?
      LIMIT 1`,
    [normalizedEmail]
  );

  if (!rows.length) {
    return res.json({ success: false, message: 'Email sau parolă incorecte.' });
  }

  const userRow = rows[0];
  if (!userRow.password_hash) {
    return res.json({ success: false, message: 'Acest cont este legat de autentificarea socială. Folosește Google sau Apple.' });
  }

  const ok = await bcrypt.compare(String(password), String(userRow.password_hash));
  if (!ok) {
    return res.json({ success: false, message: 'Email sau parolă incorecte.' });
  }

  return createSession(req, res, userRow, {
    remember: Boolean(remember),
    message: 'Autentificare reușită.',
  });
});

router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.[PUBLIC_REFRESH_COOKIE];
  if (!refreshToken) {
    return res.status(401).json({ error: 'refresh lipsește' });
  }

  let payload;
  try {
    payload = jwt.verify(refreshToken, process.env.JWT_SECRET);
  } catch (err) {
    clearPublicAuthCookies(res);
    return res.status(401).json({ error: 'refresh invalid' });
  }

  if (!payload || payload.type !== 'public_refresh' || !payload.sid || !payload.userId) {
    clearPublicAuthCookies(res);
    return res.status(401).json({ error: 'refresh invalid' });
  }

  const refreshHash = sha256(refreshToken);
  const { rows } = await db.query(
    `SELECT id, user_id, revoked_at, expires_at
       FROM public_user_sessions
      WHERE token_hash = ?
      LIMIT 1`,
    [refreshHash]
  );

  if (!rows.length) {
    clearPublicAuthCookies(res);
    return res.status(401).json({ error: 'refresh revocat' });
  }

  const session = rows[0];
  if (session.revoked_at) {
    clearPublicAuthCookies(res);
    return res.status(401).json({ error: 'refresh revocat' });
  }

  if (session.expires_at && new Date(session.expires_at) <= new Date()) {
    await db.query('UPDATE public_user_sessions SET revoked_at = NOW() WHERE id = ?', [session.id]);
    clearPublicAuthCookies(res);
    return res.status(401).json({ error: 'refresh expirat' });
  }

  await db.query('UPDATE public_user_sessions SET revoked_at = NOW(), rotated_from = ? WHERE id = ?', [refreshHash, session.id]);

  const userRow = await loadUserById(session.user_id);
  if (!userRow) {
    clearPublicAuthCookies(res);
    return res.status(401).json({ error: 'cont inexistent' });
  }

  return createSession(req, res, userRow, {
    remember: Boolean(payload.remember),
    rotatedFromHash: refreshHash,
  });
});

router.post('/logout', requirePublicAuth, async (req, res) => {
  const refreshToken = req.cookies?.[PUBLIC_REFRESH_COOKIE];
  if (refreshToken) {
    try {
      const refreshHash = sha256(refreshToken);
      await db.query('UPDATE public_user_sessions SET revoked_at = NOW() WHERE token_hash = ?', [refreshHash]);
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[publicAuth] logout revoke failed:', err?.message || err);
      }
    }
  }
  clearPublicAuthCookies(res);
  return res.json({ success: true, message: 'Ai fost deconectat.' });
});

const SUPPORTED_OAUTH = {
  google: { envKey: 'PUBLIC_AUTH_GOOGLE_URL' },
  apple: { envKey: 'PUBLIC_AUTH_APPLE_URL' },
};

router.get('/oauth/providers', (req, res) => {
  const redirect = typeof req.query.redirect === 'string' ? req.query.redirect : null;
  const providers = Object.entries(SUPPORTED_OAUTH).map(([id, meta]) => {
    const base = process.env[meta.envKey];
    if (!base) {
      return { id, enabled: false, url: null, reason: 'neconfigurat' };
    }
    let url = base;
    if (redirect) {
      try {
        const parsed = new URL(base);
        parsed.searchParams.set('redirect', redirect);
        url = parsed.toString();
      } catch (_) {
        // dacă URL-ul din env nu e valid, îl trimitem ca atare fără redirect suplimentar
        url = base;
      }
    }
    return { id, enabled: true, url };
  });

  return res.json({ providers });
});

router.get('/oauth/:provider', (req, res) => {
  const provider = req.params.provider;
  if (!SUPPORTED_OAUTH[provider]) {
    return res.status(404).json({ error: 'provider necunoscut' });
  }
  const base = process.env[SUPPORTED_OAUTH[provider].envKey];
  if (!base) {
    return res.status(501).json({ error: 'provider neconfigurat' });
  }
  const redirect = typeof req.query.redirect === 'string' ? req.query.redirect : null;
  let url = base;
  if (redirect) {
    try {
      const parsed = new URL(base);
      parsed.searchParams.set('redirect', redirect);
      url = parsed.toString();
    } catch (_) {
      url = base;
    }
  }
  return res.redirect(url);
});

module.exports = router;
