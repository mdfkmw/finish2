const db = require('../db');

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

function normalizeValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return String(value);
}

async function getSetting(key, defaultValue = '') {
  await ensureTable();
  const { rows } = await db.query(
    'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
    [key]
  );
  if (!rows || !rows.length) {
    return typeof defaultValue === 'string' ? defaultValue : normalizeValue(defaultValue);
  }
  return normalizeValue(rows[0].setting_value);
}

async function setSetting(key, value) {
  await ensureTable();
  const normalized = normalizeValue(value).trim();
  await db.query(
    `INSERT INTO app_settings (setting_key, setting_value)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP`,
    [key, normalized]
  );
}

async function getSettings(keys) {
  await ensureTable();
  if (!Array.isArray(keys) || keys.length === 0) {
    return {};
  }
  const placeholders = keys.map(() => '?').join(', ');
  const { rows } = await db.query(
    `SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (${placeholders})`,
    keys
  );
  const result = {};
  keys.forEach((key) => {
    result[key] = '';
  });
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (row && Object.prototype.hasOwnProperty.call(result, row.setting_key)) {
        result[row.setting_key] = normalizeValue(row.setting_value);
      }
    }
  }
  return result;
}

module.exports = {
  ensureTable,
  getSetting,
  setSetting,
  getSettings,
};
