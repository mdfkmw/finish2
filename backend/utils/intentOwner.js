const COOKIE_NAME = process.env.PUBLIC_INTENT_COOKIE || 'public_intent_id';
const RAW_COOKIE_MAX_AGE_DAYS = Number(process.env.PUBLIC_INTENT_COOKIE_MAX_AGE_DAYS || 7);
const COOKIE_MAX_AGE_DAYS = Number.isFinite(RAW_COOKIE_MAX_AGE_DAYS) && RAW_COOKIE_MAX_AGE_DAYS > 0
  ? RAW_COOKIE_MAX_AGE_DAYS
  : 7;
const COOKIE_MAX_AGE_MS = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

function generatePublicOwnerId() {
  const min = 1_000_000_000;
  const max = 2_147_483_647; // signed 32-bit max
  const value = Math.floor(Math.random() * (max - min + 1)) + min;
  return -value;
}

function ensureIntentOwner(req, res) {
  if (req?.user && Number.isInteger(Number(req.user.id))) {
    return {
      ownerId: Number(req.user.id),
      source: 'user',
      isNew: false,
    };
  }

  const cookies = req?.cookies || {};
  const raw = cookies[COOKIE_NAME];
  let parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed === 0) {
    parsed = generatePublicOwnerId();
    if (res && typeof res.cookie === 'function') {
      res.cookie(COOKIE_NAME, String(parsed), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: COOKIE_MAX_AGE_MS,
      });
    }
    return {
      ownerId: parsed,
      source: 'public',
      isNew: true,
    };
  }

  return {
    ownerId: parsed,
    source: 'public',
    isNew: false,
  };
}

module.exports = {
  ensureIntentOwner,
  COOKIE_NAME,
};
