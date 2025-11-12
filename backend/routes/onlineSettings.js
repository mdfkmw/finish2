const express = require('express');
const router = express.Router();

const { requireAuth, requireRole } = require('../middleware/auth');
const {
  loadOnlineSettings,
  saveOnlineSettings,
} = require('../utils/onlineSettings');

function parseBooleanInput(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'da', 'on', 'yes'].includes(normalized)) return true;
    if (['0', 'false', 'nu', 'off', 'no'].includes(normalized)) return false;
  }
  return false;
}

function parseNumberInput(value, fallback = 0, max = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  const normalized = Math.floor(parsed);
  if (max !== null && normalized > max) {
    return max;
  }
  return normalized;
}

router.get('/', requireAuth, requireRole('admin', 'operator_admin'), async (_req, res) => {
  try {
    const settings = await loadOnlineSettings({ useCache: false });
    res.json({
      block_past_reservations: settings.blockPastReservations,
      public_min_lead_minutes: settings.publicMinLeadMinutes,
      public_max_advance_days: settings.publicMaxAdvanceDays,
    });
  } catch (err) {
    console.error('[GET /api/online-settings] error', err);
    res.status(500).json({ error: 'Nu am putut încărca setările online.' });
  }
});

router.put('/', requireAuth, requireRole('admin', 'operator_admin'), async (req, res) => {
  try {
    const body = req.body || {};
    const blockPast = parseBooleanInput(body.block_past_reservations);
    const minLead = parseNumberInput(body.public_min_lead_minutes, 0, 60 * 24 * 7);
    const maxAdvance = parseNumberInput(body.public_max_advance_days, 0, 365);

    await saveOnlineSettings({
      blockPastReservations: blockPast,
      publicMinLeadMinutes: minLead,
      publicMaxAdvanceDays: maxAdvance,
    });

    const fresh = await loadOnlineSettings({ useCache: false });
    res.json({
      ok: true,
      settings: {
        block_past_reservations: fresh.blockPastReservations,
        public_min_lead_minutes: fresh.publicMinLeadMinutes,
        public_max_advance_days: fresh.publicMaxAdvanceDays,
      },
    });
  } catch (err) {
    console.error('[PUT /api/online-settings] error', err);
    res.status(500).json({ error: 'Nu am putut salva setările online.' });
  }
});

module.exports = router;
