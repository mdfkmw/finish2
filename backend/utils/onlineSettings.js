const { getSettings, setSetting: setAppSetting } = require('./appSettings');

const DEFAULTS = {
  block_past_reservations: '1',
  public_min_lead_minutes: '0',
  public_max_advance_days: '0',
};

const CACHE_TTL_MS = 60 * 1000;
let cachedSettings = null;
let cacheExpiresAt = 0;

function parseBoolean(value, defaultValue = false) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return defaultValue;
    return value !== 0;
  }
  return defaultValue;
}

function parseNonNegativeInt(value, fallback = 0, max = null) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  const rounded = Math.floor(num);
  if (max !== null && rounded > max) return max;
  return rounded;
}

function parseSettings(rawMap) {
  const blockPast = parseBoolean(rawMap.block_past_reservations, true);
  const minLead = parseNonNegativeInt(rawMap.public_min_lead_minutes, 0, 60 * 24 * 7); // până la 7 zile în minute
  const maxAdvance = parseNonNegativeInt(rawMap.public_max_advance_days, 0, 365);
  return {
    blockPastReservations: blockPast,
    publicMinLeadMinutes: minLead,
    publicMaxAdvanceDays: maxAdvance,
  };
}

async function loadOnlineSettings({ useCache = true } = {}) {
  const now = Date.now();
  if (useCache && cachedSettings && cacheExpiresAt > now) {
    return cachedSettings;
  }
  const raw = await getSettings(Object.keys(DEFAULTS));
  const merged = { ...DEFAULTS, ...raw };
  const parsed = parseSettings(merged);
  cachedSettings = parsed;
  cacheExpiresAt = now + CACHE_TTL_MS;
  return parsed;
}

function invalidateOnlineSettingsCache() {
  cachedSettings = null;
  cacheExpiresAt = 0;
}

function combineDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  const datePart = String(dateStr).trim();
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(datePart)) return null;
  let timePart = typeof timeStr === 'string' ? timeStr.trim() : '';
  if (!timePart) timePart = '00:00';
  if (/^[0-9]{2}:[0-9]{2}$/.test(timePart)) {
    timePart = `${timePart}:00`;
  }
  if (!/^[0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(timePart)) return null;
  const [year, month, day] = datePart.split('-').map((value) => Number(value));
  const [hours, minutes, seconds] = timePart.split(':').map((value) => Number(value));
  if ([year, month, day, hours, minutes, seconds].some((value) => !Number.isFinite(value))) {
    return null;
  }
  return new Date(year, month - 1, day, hours, minutes, seconds);
}

function formatMinutesLabel(value) {
  if (!Number.isFinite(value) || value <= 0) return '0 minute';
  if (value % 60 === 0) {
    const hours = value / 60;
    return hours === 1 ? '1 oră' : `${hours} ore`;
  }
  return value === 1 ? '1 minut' : `${value} minute`;
}

function formatDaysLabel(value) {
  if (!Number.isFinite(value) || value <= 0) return '0 zile';
  return value === 1 ? '1 zi' : `${value} zile`;
}

function evaluateBookingWindow({
  date,
  time,
  settings,
  includeLeadTime = false,
  includeMaxAdvance = false,
  now = new Date(),
}) {
  if (!settings) {
    return { allowed: true, reason: null, departure: null };
  }
  const departure = combineDateTime(date, time);
  if (!departure || Number.isNaN(departure.getTime())) {
    return { allowed: true, reason: null, departure: null };
  }
  const diffMs = departure.getTime() - now.getTime();
  if (settings.blockPastReservations && diffMs < 0) {
    return {
      allowed: false,
      reason: 'Cursa a plecat deja. Rezervările nu mai sunt disponibile.',
      departure,
    };
  }
  if (includeLeadTime && settings.publicMinLeadMinutes > 0) {
    const leadMs = settings.publicMinLeadMinutes * 60 * 1000;
    if (diffMs <= leadMs) {
      return {
        allowed: false,
        reason: `Rezervările online se închid cu ${formatMinutesLabel(settings.publicMinLeadMinutes)} înainte de plecare.`,
        departure,
      };
    }
  }
  if (includeMaxAdvance && settings.publicMaxAdvanceDays > 0) {
    const maxMs = settings.publicMaxAdvanceDays * 24 * 60 * 60 * 1000;
    if (diffMs > maxMs) {
      return {
        allowed: false,
        reason: `Rezervările online sunt disponibile cu cel mult ${formatDaysLabel(settings.publicMaxAdvanceDays)} înainte de plecare.`,
        departure,
      };
    }
  }
  return { allowed: true, reason: null, departure };
}

async function saveOnlineSettings({
  blockPastReservations,
  publicMinLeadMinutes,
  publicMaxAdvanceDays,
}) {
  await setAppSetting('block_past_reservations', blockPastReservations ? '1' : '0');
  await setAppSetting('public_min_lead_minutes', String(publicMinLeadMinutes));
  await setAppSetting('public_max_advance_days', String(publicMaxAdvanceDays));
  invalidateOnlineSettingsCache();
}

module.exports = {
  loadOnlineSettings,
  invalidateOnlineSettingsCache,
  evaluateBookingWindow,
  combineDateTime,
  saveOnlineSettings,
};
