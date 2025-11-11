const jwt = require('jsonwebtoken');
const db = require('../db');

const PUBLIC_ACCESS_COOKIE = 'public_access_token';
const PUBLIC_REFRESH_COOKIE = 'public_refresh_token';
const PUBLIC_ACCESS_TTL_SEC = 6 * 3600; // 6 ore pentru sesiunea de browser
const PUBLIC_REFRESH_TTL_SEC = 30 * 24 * 3600; // 30 de zile pentru sesiunea standard
const PUBLIC_REFRESH_REMEMBER_TTL_SEC = 90 * 24 * 3600; // 90 de zile când utilizatorul bifează "Ține-mă minte"

function signPublicAccessToken(payload) {
  return jwt.sign({ ...payload, type: 'public_access' }, process.env.JWT_SECRET, {
    expiresIn: PUBLIC_ACCESS_TTL_SEC,
  });
}

function signPublicRefreshToken(payload) {
  return jwt.sign({ ...payload, type: 'public_refresh' }, process.env.JWT_SECRET, {
    expiresIn: payload.remember ? PUBLIC_REFRESH_REMEMBER_TTL_SEC : PUBLIC_REFRESH_TTL_SEC,
  });
}

function setPublicAuthCookies(res, accessToken, refreshToken, options = {}) {
  const remember = Boolean(options.remember);
  const refreshTtlSec = options.refreshTtlSec || (remember ? PUBLIC_REFRESH_REMEMBER_TTL_SEC : PUBLIC_REFRESH_TTL_SEC);
  const secure = process.env.NODE_ENV === 'production';
  const sameSite = secure ? 'lax' : 'lax';

  res.cookie(PUBLIC_ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge: PUBLIC_ACCESS_TTL_SEC * 1000,
  });

  res.cookie(PUBLIC_REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge: refreshTtlSec * 1000,
  });
}

function clearPublicAuthCookies(res) {
  res.clearCookie(PUBLIC_ACCESS_COOKIE, { path: '/' });
  res.clearCookie(PUBLIC_REFRESH_COOKIE, { path: '/' });
}

async function attachPublicUser(req, _res, next) {
  const token = req.cookies?.[PUBLIC_ACCESS_COOKIE];
  if (!token) {
    return next();
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload || payload.type !== 'public_access' || !payload.id) {
      return next();
    }

    const { rows } = await db.query(
      `SELECT id, email, name, phone, phone_normalized, email_verified_at, phone_verified_at
         FROM public_users
        WHERE id = ?
        LIMIT 1`,
      [payload.id]
    );

    if (!rows || !rows.length) {
      return next();
    }

    const row = rows[0];
    req.publicUser = {
      id: Number(row.id),
      email: row.email,
      name: row.name || null,
      phone: row.phone || null,
      phoneNormalized: row.phone_normalized || null,
      emailVerified: Boolean(row.email_verified_at),
      phoneVerified: Boolean(row.phone_verified_at),
    };
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[publicAuth] attachPublicUser failed:', err?.message || err);
    }
  }

  return next();
}

function requirePublicAuth(req, res, next) {
  if (!req.publicUser) {
    return res.status(401).json({ error: 'autentificare necesară' });
  }
  return next();
}

module.exports = {
  PUBLIC_ACCESS_COOKIE,
  PUBLIC_REFRESH_COOKIE,
  PUBLIC_ACCESS_TTL_SEC,
  PUBLIC_REFRESH_TTL_SEC,
  PUBLIC_REFRESH_REMEMBER_TTL_SEC,
  signPublicAccessToken,
  signPublicRefreshToken,
  setPublicAuthCookies,
  clearPublicAuthCookies,
  attachPublicUser,
  requirePublicAuth,
};
