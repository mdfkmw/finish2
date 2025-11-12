const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSetting, setSetting } = require('../utils/appSettings');

router.get('/', requireAuth, requireRole('admin', 'operator_admin', 'agent', 'driver'), async (_req, res) => {
  try {
    const receiptNote = await getSetting('receipt_note');
    res.json({ receipt_note: receiptNote });
  } catch (err) {
    console.error('[GET /api/fiscal-settings]', err);
    res.status(500).json({ error: 'Eroare la citirea setărilor fiscale' });
  }
});

router.put('/', requireAuth, requireRole('admin', 'operator_admin'), async (req, res) => {
  try {
    const raw = req.body?.receipt_note;
    const value = typeof raw === 'string' ? raw.slice(0, 120) : '';
    await setSetting('receipt_note', value);
    res.json({ ok: true });
  } catch (err) {
    console.error('[PUT /api/fiscal-settings]', err);
    res.status(500).json({ error: 'Eroare la salvarea setărilor fiscale' });
  }
});

module.exports = router;
