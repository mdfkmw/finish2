const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(100) NOT NULL,
    setting_value TEXT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (setting_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
`;

let ensureTablePromise = null;

async function ensureTable() {
  if (!ensureTablePromise) {
    ensureTablePromise = db.query(TABLE_SQL).catch((err) => {
      ensureTablePromise = null;
      throw err;
    });
  }
  return ensureTablePromise;
}

async function getSetting(key) {
  await ensureTable();
  const { rows } = await db.query('SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1', [key]);
  const value = rows?.[0]?.setting_value;
  return typeof value === 'string' ? value : '';
}

async function setSetting(key, value) {
  await ensureTable();
  const normalized = typeof value === 'string' ? value.trim() : '';
  await db.query(
    `INSERT INTO app_settings (setting_key, setting_value)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP`,
    [key, normalized]
  );
}

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
