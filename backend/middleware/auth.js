const jwt = require('jsonwebtoken');
const db = require('../db');

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';
const ACCESS_TTL_SEC = 12 * 3600;         // 12 ore
const REFRESH_TTL_SEC = 30 * 24 * 3600; // 30 zile

function signAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: ACCESS_TTL_SEC });
}
function signRefreshToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: REFRESH_TTL_SEC });
}

function setAuthCookies(res, accessToken, refreshToken) {
  // În DEV pe localhost trebuie Secure = false, altfel browserul nu salvează cookie-ul pe HTTP.
  const secure = false; // pune true doar în producție (HTTPS)
  res.cookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TTL_SEC * 1000
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_TTL_SEC * 1000
  });
}
function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
}

function verifyAccessToken(req, _res, next) {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, role, operator_id, name, email }
  } catch (_) {
    // token expirat/invalid — ignorăm, req.user rămâne neautentificat
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'auth required' });
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'auth required' });
    if (!roles.includes(req.user.role)) {
      // debug prietenos (dev only)
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[RBAC] role=', req.user.role, 'required=', roles, '→ 403');
      }
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  setAuthCookies,
  clearAuthCookies,
  verifyAccessToken,
  requireAuth,
  requireRole,
  ACCESS_COOKIE,
  REFRESH_COOKIE
};
