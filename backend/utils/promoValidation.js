const db = require('../db');

function toHHMM(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;
  const [hh = '00', mm = '00'] = str.split(':');
  return `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`;
}

async function runQuery(client, sql, params = []) {
  if (client && typeof client.query === 'function' && client !== db) {
    const [rows] = await client.query(sql, params);
    return Array.isArray(rows) ? rows : [];
  }
  const result = await db.query(sql, params);
  return Array.isArray(result.rows) ? result.rows : [];
}

function parseDateInput(date) {
  if (!date) return null;
  try {
    const dt = new Date(date);
    if (Number.isNaN(dt.getTime())) return null;
    return dt;
  } catch (_) {
    return null;
  }
}

function parseChannel(channel, fallback = 'online') {
  const normalized = String(channel || '').trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === 'agent' ? 'agent' : normalized;
}

async function validatePromoCode(client, {
  code,
  route_id,
  route_schedule_id,
  date,
  time,
  channel = 'online',
  price_value,
  phone,
} = {}) {
  const CODE = String(code || '').trim().toUpperCase();
  if (!CODE) return { valid: false, reason: 'Cod lipsă' };

  const currentChannel = parseChannel(channel);
  const promoRows = await runQuery(
    client,
    `SELECT * FROM promo_codes
       WHERE UPPER(code)=?
         AND active = 1
         AND (valid_from IS NULL OR NOW() >= valid_from)
         AND (valid_to   IS NULL OR NOW() <= valid_to)
       LIMIT 1`,
    [CODE]
  );

  const promo = promoRows[0];
  if (!promo) return { valid: false, reason: 'Cod inexistent sau expirat' };

  const allowedChannels = (promo.channels || '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);

  if (allowedChannels.length && !allowedChannels.includes(currentChannel)) {
    return { valid: false, reason: 'Cod nevalabil pe acest canal' };
  }

  const routeCountRows = await runQuery(
    client,
    'SELECT COUNT(*) AS c FROM promo_code_routes WHERE promo_code_id=?',
    [promo.id]
  );
  const hasRouteScope = Number(routeCountRows?.[0]?.c || 0) > 0;
  if (hasRouteScope) {
    const okRows = await runQuery(
      client,
      'SELECT COUNT(*) AS c FROM promo_code_routes WHERE promo_code_id=? AND route_id=?',
      [promo.id, route_id || 0]
    );
    if (!(Number(okRows?.[0]?.c || 0) > 0)) {
      return { valid: false, reason: 'Nu e valabil pe acest traseu' };
    }
  }

  const scheduleCountRows = await runQuery(
    client,
    'SELECT COUNT(*) AS c FROM promo_code_schedules WHERE promo_code_id=?',
    [promo.id]
  );
  const hasScheduleScope = Number(scheduleCountRows?.[0]?.c || 0) > 0;
  if (hasScheduleScope) {
    const okRows = await runQuery(
      client,
      'SELECT COUNT(*) AS c FROM promo_code_schedules WHERE promo_code_id=? AND route_schedule_id=?',
      [promo.id, route_schedule_id || 0]
    );
    if (!(Number(okRows?.[0]?.c || 0) > 0)) {
      return { valid: false, reason: 'Nu e valabil pe această oră' };
    }
  }

  const hhmm = toHHMM(time);
  if (hhmm) {
    const hourCountRows = await runQuery(
      client,
      'SELECT COUNT(*) AS c FROM promo_code_hours WHERE promo_code_id=?',
      [promo.id]
    );
    const hasHourScope = Number(hourCountRows?.[0]?.c || 0) > 0;
    if (hasHourScope) {
      const okRows = await runQuery(
        client,
        'SELECT COUNT(*) AS c FROM promo_code_hours WHERE promo_code_id=? AND ? BETWEEN start_time AND end_time',
        [promo.id, hhmm]
      );
      if (!(Number(okRows?.[0]?.c || 0) > 0)) {
        return { valid: false, reason: 'Nu e în intervalul orar' };
      }
    }
  }

  const dateObj = parseDateInput(date);
  if (dateObj) {
    const weekday = dateObj.getDay();
    const weekdayCountRows = await runQuery(
      client,
      'SELECT COUNT(*) AS c FROM promo_code_weekdays WHERE promo_code_id=?',
      [promo.id]
    );
    const hasWeekdayScope = Number(weekdayCountRows?.[0]?.c || 0) > 0;
    if (hasWeekdayScope) {
      const okRows = await runQuery(
        client,
        'SELECT COUNT(*) AS c FROM promo_code_weekdays WHERE promo_code_id=? AND weekday=?',
        [promo.id, weekday]
      );
      if (!(Number(okRows?.[0]?.c || 0) > 0)) {
        return { valid: false, reason: 'Nu e valabil în această zi' };
      }
    }
  }

  const totalUsesRows = await runQuery(
    client,
    'SELECT COUNT(*) AS c FROM promo_code_usages WHERE promo_code_id=?',
    [promo.id]
  );
  const totalUses = Number(totalUsesRows?.[0]?.c || 0);
  if (promo.max_total_uses && totalUses >= Number(promo.max_total_uses)) {
    return { valid: false, reason: 'Limită totală atinsă' };
  }

  if (phone) {
    const perRows = await runQuery(
      client,
      'SELECT COUNT(*) AS c FROM promo_code_usages WHERE promo_code_id=? AND phone=?',
      [promo.id, phone]
    );
    const perCount = Number(perRows?.[0]?.c || 0);
    if (promo.max_uses_per_person && perCount >= Number(promo.max_uses_per_person)) {
      return { valid: false, reason: 'Limită pe persoană atinsă' };
    }
  }

  const base = Number(price_value || 0);
  if (promo.min_price && base < Number(promo.min_price)) {
    return { valid: false, reason: 'Sub pragul minim' };
  }

  let discount = 0;
  const valueOff = Number(promo.value_off || 0);
  if (promo.type === 'percent') {
    discount = +(base * (valueOff / 100)).toFixed(2);
  } else {
    discount = +valueOff;
  }

  if (promo.max_discount) {
    discount = Math.min(discount, Number(promo.max_discount));
  }

  discount = Math.min(discount, base);

  return {
    valid: discount > 0,
    reason: discount > 0 ? undefined : 'Reducere indisponibilă',
    promo_code_id: promo.id,
    type: promo.type,
    value_off: valueOff,
    discount_amount: discount,
    combinable: !!promo.combinable,
  };
}

module.exports = {
  validatePromoCode,
};
