const express = require('express');
const router = express.Router();
const db = require('../db');
const { normalizeDirection, isReturnDirection } = require('../utils/direction');
const { ensureIntentOwner } = require('../utils/intentOwner');
const { requirePublicAuth } = require('../middleware/publicAuth');

const PUBLIC_CATEGORY_CANDIDATES = (() => {
  const raw = process.env.PUBLIC_PRICING_CATEGORY_IDS || '2,1';
  const parts = raw
    .split(',')
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (parts.length === 0) return [1];
  const seen = new Set();
  const ordered = [];
  for (const id of parts) {
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
})();

// Exclusiv categoria Online pentru public (fără fallback)
const PUBLIC_ONLY_CATEGORY_ID = Number(process.env.PUBLIC_ONLY_CATEGORY_ID || 2);


async function execQuery(client, sql, params = []) {
  if (client && typeof client.query === 'function' && client !== db) {
    const [rows] = await client.query(sql, params);
    const isArray = Array.isArray(rows);
    const insertId = typeof rows?.insertId === 'number' ? rows.insertId : null;
    return {
      rows: isArray ? rows : [],
      insertId,
      raw: rows,
    };
  }
  return db.query(sql, params);
}

function sanitizeDate(dateStr) {
  if (!dateStr) return null;
  const str = String(dateStr).slice(0, 10);
  if (!/\d{4}-\d{2}-\d{2}/.test(str)) return null;
  return str;
}

function sanitizePhone(raw) {
  if (!raw) return '';
  return String(raw).replace(/\D/g, '').slice(0, 20);
}

function buildPhoneVariants(raw) {
  const digits = sanitizePhone(raw);
  if (!digits) return [];
  const variants = new Set();
  variants.add(digits);

  if (digits.startsWith('40') && digits.length > 2) {
    variants.add(digits.slice(2));
  }
  if (digits.startsWith('4') && digits.length > 1) {
    variants.add(digits.slice(1));
  }
  if (!digits.startsWith('0') && digits.length === 9) {
    variants.add(`0${digits}`);
  }
  if (digits.startsWith('0') && digits.length === 10) {
    variants.add(`4${digits}`);
    variants.add(`40${digits.slice(1)}`);
  }

  return Array.from(variants).filter((value) => value && value.length);
}

function normalizeDatePart(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const str = String(value).trim();
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    return str.slice(0, 10);
  }
  return null;
}

function parseTripDeparture(trip) {
  if (!trip) return null;
  const rawTs = trip.departure_at ?? trip.departure_ts ?? null;
  if (rawTs instanceof Date && !Number.isNaN(rawTs.getTime())) {
    return rawTs;
  }

  const rawTime = trip.time ?? trip.departure_time ?? null;
  const timeStr = rawTime instanceof Date
    ? rawTime.toISOString().slice(11, 16)
    : typeof rawTime === 'string'
      ? rawTime.trim().slice(0, 5)
      : null;

  const dateStr = normalizeDatePart(trip.date);
  if (!timeStr || !dateStr) {
    return null;
  }

  const composite = `${dateStr}T${timeStr}`;
  const candidate = new Date(composite);
  if (Number.isNaN(candidate.getTime())) {
    return null;
  }
  return candidate;
}

function evaluateTripAvailability(trip) {
  if (!trip) {
    return { status: 'not_found' };
  }
  const boarding = Number(trip.boarding_started || trip.boardingStarted || 0) === 1;
  if (boarding) {
    return { status: 'boarding' };
  }
  const departure = parseTripDeparture(trip);
  if (departure && departure.getTime() <= Date.now()) {
    return { status: 'past', departure };
  }
  return { status: 'ok', departure };
}

function toHHMM(timeStr) {
  if (!timeStr) return null;
  const str = String(timeStr);
  if (str.length >= 5) return str.slice(0, 5);
  if (/^\d{1,2}:\d{1,2}$/.test(str)) return str;
  return null;
}

function addMinutesToTime(timeStr, minutes) {
  if (!timeStr || !Number.isFinite(minutes)) return null;
  const parts = String(timeStr).split(':');
  if (parts.length < 2) return null;
  const hours = Number(parts[0]);
  const mins = Number(parts[1]);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return null;
  const base = Date.UTC(1970, 0, 1, hours, mins, 0);
  const result = new Date(base + minutes * 60000);
  const hh = String(result.getUTCHours()).padStart(2, '0');
  const mm = String(result.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function mapDiscountRow(row) {
  if (!row) return null;
  const id = Number(row.id ?? row.discount_type_id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return {
    id,
    code: row.code || null,
    label: row.label || '',
    value_off: Number(row.value_off),
    type: row.type,
  };
}

async function fetchOnlineDiscountTypes(client, scheduleId) {
  if (!Number.isFinite(scheduleId) || !scheduleId) return [];
  const { rows } = await execQuery(
    client,
    `
    SELECT dt.id, dt.code, dt.label, dt.value_off, dt.type
      FROM route_schedule_discounts rsd
      JOIN discount_types dt ON dt.id = rsd.discount_type_id
     WHERE rsd.route_schedule_id = ?
       AND rsd.visible_online = 1
     ORDER BY dt.label
    `,
    [scheduleId]
  );
  return rows.map(mapDiscountRow).filter(Boolean);
}

async function resolveOnlineDiscountType(client, scheduleId, discountTypeId) {
  if (!Number.isFinite(scheduleId) || !scheduleId || !Number.isFinite(discountTypeId) || !discountTypeId) {
    return null;
  }
  const { rows } = await execQuery(
    client,
    `
    SELECT dt.id, dt.code, dt.label, dt.value_off, dt.type
      FROM route_schedule_discounts rsd
      JOIN discount_types dt ON dt.id = rsd.discount_type_id
     WHERE rsd.route_schedule_id = ?
       AND rsd.discount_type_id = ?
       AND rsd.visible_online = 1
     LIMIT 1
    `,
    [scheduleId, discountTypeId]
  );
  return rows.length ? mapDiscountRow(rows[0]) : null;
}

async function resolveMultipleOnlineDiscountTypes(client, scheduleId, discountTypeIds) {
  if (!Number.isFinite(scheduleId) || !scheduleId) return new Map();
  const normalizedIds = Array.isArray(discountTypeIds)
    ? discountTypeIds
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    : [];
  if (!normalizedIds.length) return new Map();
  const placeholders = normalizedIds.map(() => '?').join(',');
  const params = [scheduleId, ...normalizedIds];
  const { rows } = await execQuery(
    client,
    `
    SELECT dt.id, dt.code, dt.label, dt.value_off, dt.type
      FROM route_schedule_discounts rsd
      JOIN discount_types dt ON dt.id = rsd.discount_type_id
     WHERE rsd.route_schedule_id = ?
       AND rsd.discount_type_id IN (${placeholders})
       AND rsd.visible_online = 1
    `,
    params,
  );
  const map = new Map();
  for (const row of rows) {
    const meta = mapDiscountRow(row);
    if (meta) {
      map.set(meta.id, meta);
    }
  }
  return map;
}

function computeTypeDiscountValue(price, discountRow) {
  const priceValue = Number(price || 0);
  if (!discountRow || !Number.isFinite(priceValue) || priceValue <= 0) return 0;
  const rawValue = Number(discountRow.value_off || 0);
  if (!Number.isFinite(rawValue) || rawValue <= 0) return 0;
  let result = 0;
  if (String(discountRow.type) === 'percent') {
    result = +(priceValue * rawValue / 100).toFixed(2);
  } else {
    result = +rawValue;
  }
  if (!Number.isFinite(result) || result <= 0) return 0;
  if (result > priceValue) return priceValue;
  return +result.toFixed(2);
}

async function estimateSegmentDuration(client, routeId, direction, boardStationId, exitStationId) {
  const { rows } = await execQuery(
    client,
    `
    SELECT station_id, travel_time_from_previous_minutes
      FROM route_stations
     WHERE route_id = ?
     ORDER BY sequence ASC
    `,
    [routeId]
  );

  if (!rows.length) return null;

  const stationIds = rows.map((row) => Number(row.station_id));
  const travel = rows.map((row, idx) => {
    if (idx === 0) return 0;
    const val = Number(row.travel_time_from_previous_minutes);
    return Number.isFinite(val) ? val : 0;
  });

  if (!stationIds.includes(Number(boardStationId)) || !stationIds.includes(Number(exitStationId))) {
    return null;
  }

  let orderIds = stationIds.slice();
  let travelFromPrev = travel.slice();

  if (isReturnDirection(direction)) {
    orderIds = stationIds.slice().reverse();
    travelFromPrev = orderIds.map((_, idx) => {
      if (idx === 0) return 0;
      const sourceIndex = stationIds.length - idx;
      return Number.isFinite(travel[sourceIndex]) ? travel[sourceIndex] : 0;
    });
  }

  let total = 0;
  let started = false;
  for (let i = 0; i < orderIds.length; i += 1) {
    const stationId = orderIds[i];
    if (!started) {
      if (stationId === Number(boardStationId)) {
        started = true;
      }
      continue;
    }
    total += Number.isFinite(travelFromPrev[i]) ? travelFromPrev[i] : 0;
    if (stationId === Number(exitStationId)) {
      return { minutes: total };
    }
  }

  return null;
}

async function getAllowedCategories(client, scheduleId) {
  if (!scheduleId) return null;
  const { rows } = await execQuery(
    client,
    `SELECT pricing_category_id FROM route_schedule_pricing_categories WHERE route_schedule_id = ?`,
    [scheduleId]
  );
  if (!rows.length) return null;
  return rows.map((row) => Number(row.pricing_category_id)).filter((n) => Number.isFinite(n));
}

async function getPublicPrice(client, { routeId, fromStationId, toStationId, date, scheduleId }) {
  if (!routeId || !fromStationId || !toStationId || !date) return null;
  // PUBLIC: ignorăm whitelisting-ul pe orar; afișăm EXCLUSIV categoria Online
  const catId = PUBLIC_ONLY_CATEGORY_ID;

  const { rows } = await execQuery(
    client,
    `
      SELECT
        pli.price,
        pl.id          AS price_list_id,
        pl.category_id AS pricing_category_id
      FROM price_list_items pli
      JOIN price_lists      pl ON pl.id = pli.price_list_id
      WHERE pl.route_id = ?
        AND pli.from_station_id = ?
        AND pli.to_station_id   = ?
        AND pl.category_id      = ?
        AND pl.effective_from = (
              SELECT MAX(effective_from)
                FROM price_lists
               WHERE route_id    = ?
                 AND category_id = ?
                 AND effective_from <= DATE(?)
        )
      LIMIT 1
    `,
    [routeId, fromStationId, toStationId, catId, routeId, catId, date]
  );

  if (!rows.length) return null; // FĂRĂ FALLBACK: dacă nu există Online, nu dăm altă categorie

  return {
    price: Number(rows[0].price),
    price_list_id: rows[0].price_list_id,
    pricing_category_id: rows[0].pricing_category_id,
  };
}

async function validatePromoForTrip(client, {
  code,
  tripId,
  boardStationId,
  exitStationId,
  seatCount,
  phone,
  priceInfoOverride = null,
  discountTypeId = null,
  discountTypeIds = null,
}) {
  const cleanCode = String(code || '').trim().toUpperCase();
  if (!cleanCode) {
    return { valid: false, reason: 'Cod lipsă' };
  }

  const seats = Number(seatCount || 0);
  if (!Number.isFinite(seats) || seats <= 0) {
    return { valid: false, reason: 'Selectează locurile înainte de a aplica codul.' };
  }

  const trip = await loadTripBasics(client, tripId);
  if (!trip) {
    return { valid: false, reason: 'Cursa nu mai este disponibilă.' };
  }

  const travelDate = sanitizeDate(trip.date);
  if (!travelDate) {
    return { valid: false, reason: 'Data cursei nu a putut fi validată.' };
  }

  let priceInfo = priceInfoOverride;
  if (!priceInfo) {
    priceInfo = await getPublicPrice(client, {
      routeId: trip.route_id,
      fromStationId: boardStationId,
      toStationId: exitStationId,
      date: travelDate,
      scheduleId: trip.schedule_id,
    });
  }

  if (!priceInfo || !Number.isFinite(Number(priceInfo.price))) {
    return { valid: false, reason: 'Tariful pentru această rută nu este disponibil.' };
  }

  const perSeatPrice = Number(priceInfo.price);
  const baseAmount = +(perSeatPrice * seats).toFixed(2);
  if (baseAmount <= 0) {
    return { valid: false, reason: 'Valoarea comenzii este zero.' };
  }

  const numericDiscountTypeId = Number(discountTypeId);
  const discountIdsArray = Array.isArray(discountTypeIds)
    ? discountTypeIds
        .map((value) => {
          const parsed = Number(value);
          return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        })
        .filter((value) => value !== null)
    : [];

  let typeDiscountTotal = 0;
  if (discountIdsArray.length > 0) {
    const discountMetaMap = await resolveMultipleOnlineDiscountTypes(client, trip.schedule_id, discountIdsArray);
    let running = 0;
    for (const id of discountIdsArray) {
      const meta = discountMetaMap.get(id);
      if (!meta) {
        return { valid: false, reason: 'Reducerea selectată nu este disponibilă pentru această cursă.' };
      }
      running += computeTypeDiscountValue(perSeatPrice, meta);
    }
    typeDiscountTotal = Number(running.toFixed(2));
  } else if (Number.isFinite(numericDiscountTypeId) && numericDiscountTypeId > 0) {
    const onlineDiscount = await resolveOnlineDiscountType(client, trip.schedule_id, numericDiscountTypeId);
    if (!onlineDiscount) {
      return { valid: false, reason: 'Reducerea selectată nu este disponibilă pentru această cursă.' };
    }
    const perSeatValue = computeTypeDiscountValue(perSeatPrice, onlineDiscount);
    typeDiscountTotal = Number((perSeatValue * seats).toFixed(2));
  }
  const baseAfterType = Math.max(0, baseAmount - typeDiscountTotal);
  if (baseAfterType <= 0) {
    return { valid: false, reason: 'Valoarea comenzii este zero.' };
  }

  const promoRes = await execQuery(
    client,
    `SELECT * FROM promo_codes
       WHERE UPPER(code)=? AND active=1
         AND (valid_from IS NULL OR NOW() >= valid_from)
         AND (valid_to   IS NULL OR NOW() <= valid_to)
      LIMIT 1`,
    [cleanCode]
  );

  const promo = promoRes.rows?.[0];
  if (!promo) {
    return { valid: false, reason: 'Cod inexistent sau expirat.' };
  }

  const channels = (promo.channels || '').split(',');
  if (!channels.includes('online')) {
    return { valid: false, reason: 'Codul nu este disponibil online.' };
  }

  const routesCount = await execQuery(
    client,
    'SELECT COUNT(*) AS c FROM promo_code_routes WHERE promo_code_id = ?',
    [promo.id]
  );
  if ((routesCount.rows?.[0]?.c ?? 0) > 0) {
    const allowed = await execQuery(
      client,
      'SELECT COUNT(*) AS c FROM promo_code_routes WHERE promo_code_id=? AND route_id=?',
      [promo.id, trip.route_id]
    );
    if (!((allowed.rows?.[0]?.c ?? 0) > 0)) {
      return { valid: false, reason: 'Cod indisponibil pentru această rută.' };
    }
  }

  const schedulesCount = await execQuery(
    client,
    'SELECT COUNT(*) AS c FROM promo_code_schedules WHERE promo_code_id=?',
    [promo.id]
  );
  if ((schedulesCount.rows?.[0]?.c ?? 0) > 0) {
    const allowed = await execQuery(
      client,
      'SELECT COUNT(*) AS c FROM promo_code_schedules WHERE promo_code_id=? AND route_schedule_id=?',
      [promo.id, trip.schedule_id || 0]
    );
    if (!((allowed.rows?.[0]?.c ?? 0) > 0)) {
      return { valid: false, reason: 'Codul nu este valabil pentru această plecare.' };
    }
  }

  const hhmm = toHHMM(trip.departure_time || trip.time);
  const hoursCount = await execQuery(
    client,
    'SELECT COUNT(*) AS c FROM promo_code_hours WHERE promo_code_id=?',
    [promo.id]
  );
  if ((hoursCount.rows?.[0]?.c ?? 0) > 0) {
    const within = await execQuery(
      client,
      'SELECT COUNT(*) AS c FROM promo_code_hours WHERE promo_code_id=? AND ? BETWEEN start_time AND end_time',
      [promo.id, hhmm || '']
    );
    if (!((within.rows?.[0]?.c ?? 0) > 0)) {
      return { valid: false, reason: 'Codul nu este disponibil la această oră.' };
    }
  }

  const weekday = Number.isFinite(new Date(travelDate).getTime())
    ? new Date(travelDate).getDay()
    : null;
  const weekdayCount = await execQuery(
    client,
    'SELECT COUNT(*) AS c FROM promo_code_weekdays WHERE promo_code_id=?',
    [promo.id]
  );
  if ((weekdayCount.rows?.[0]?.c ?? 0) > 0) {
    const allowed = await execQuery(
      client,
      'SELECT COUNT(*) AS c FROM promo_code_weekdays WHERE promo_code_id=? AND weekday=?',
      [promo.id, weekday]
    );
    if (!((allowed.rows?.[0]?.c ?? 0) > 0)) {
      return { valid: false, reason: 'Codul nu este valabil în această zi.' };
    }
  }

  const totalUses = await execQuery(
    client,
    'SELECT COUNT(*) AS c FROM promo_code_usages WHERE promo_code_id=?',
    [promo.id]
  );
  if (promo.max_total_uses && (totalUses.rows?.[0]?.c ?? 0) >= promo.max_total_uses) {
    return { valid: false, reason: 'S-a atins numărul maxim de utilizări.' };
  }

  const cleanPhone = sanitizePhone(phone);
  if (cleanPhone) {
    const perPerson = await execQuery(
      client,
      'SELECT COUNT(*) AS c FROM promo_code_usages WHERE promo_code_id=? AND phone=?',
      [promo.id, cleanPhone]
    );
    if (promo.max_uses_per_person && (perPerson.rows?.[0]?.c ?? 0) >= promo.max_uses_per_person) {
      return { valid: false, reason: 'Acest cod a fost deja folosit pentru numărul introdus.' };
    }
  }

  if (promo.min_price && baseAfterType < Number(promo.min_price)) {
    return { valid: false, reason: 'Valoarea minimă pentru cod nu este atinsă.' };
  }

  let discount = promo.type === 'percent'
    ? +(baseAfterType * (Number(promo.value_off) / 100)).toFixed(2)
    : +Number(promo.value_off);

  if (promo.max_discount) {
    discount = Math.min(discount, Number(promo.max_discount));
  }
  discount = Math.min(discount, baseAfterType);

  if (!Number.isFinite(discount) || discount <= 0) {
    return { valid: false, reason: 'Reducere indisponibilă pentru selecția curentă.' };
  }

  return {
    valid: true,
    promo_code_id: promo.id,
    code: cleanCode,
    type: promo.type,
    value_off: Number(promo.value_off),
    discount_amount: Number(discount),
    combinable: !!promo.combinable,
    base_amount: baseAfterType,
    price_per_seat: priceInfo ? Number(priceInfo.price) : null,
  };
}

async function loadTripBasics(client, tripId) {
  const { rows } = await execQuery(
    client,
    `
    SELECT
      t.id,
      t.route_id,
      t.vehicle_id,
      t.date,
      DATE_FORMAT(t.time, '%H:%i') AS departure_time,
      t.time,
      t.boarding_started,
      TIMESTAMP(t.date, t.time) AS departure_at,
      rs.direction,
      rs.id AS schedule_id
    FROM trips t
    JOIN route_schedules rs ON rs.id = t.route_schedule_id
    WHERE t.id = ?
      AND NOT EXISTS (
        SELECT 1
          FROM schedule_exceptions se
         WHERE se.schedule_id = t.route_schedule_id
           AND se.disable_online = 1
           AND (
                 se.exception_date IS NULL
              OR se.exception_date = DATE(t.date)
              OR (se.weekday IS NOT NULL AND se.weekday = DAYOFWEEK(t.date) - 1)
           )
      )
    LIMIT 1
    `,
    [tripId]
  );
  return rows[0] || null;
}

async function loadTripStationSequences(client, tripId) {
  const { rows } = await execQuery(
    client,
    `SELECT station_id, sequence FROM trip_stations WHERE trip_id = ?`,
    [tripId]
  );
  const map = new Map();
  rows.forEach((row) => {
    map.set(Number(row.station_id), Number(row.sequence));
  });
  return map;
}

async function computeSeatAvailability(client, {
  tripId,
  boardStationId,
  exitStationId,
  includeSeats = true,
  intentOwnerId = null,
  preloadedTrip = null,
}) {
  const trip = preloadedTrip || (await loadTripBasics(client, tripId));
  if (!trip) return null;

  const availability = evaluateTripAvailability(trip);
  if (availability.status !== 'ok') {
    return null;
  }

  const stationSeq = await loadTripStationSequences(client, tripId);
  const boardSeq = stationSeq.get(Number(boardStationId));
  const exitSeq = stationSeq.get(Number(exitStationId));
  if (!Number.isFinite(boardSeq) || !Number.isFinite(exitSeq) || boardSeq >= exitSeq) {
    return null;
  }

  const normalizedOwner = Number.isInteger(intentOwnerId) ? Number(intentOwnerId) : null;

  const { rows: intentRows } = await execQuery(
    client,
    `
      SELECT seat_id, user_id
        FROM reservation_intents
       WHERE trip_id = ?
         AND expires_at > NOW()
    `,
    [tripId],
  );

  const intentBySeat = new Map();
  for (const row of intentRows) {
    const seatId = Number(row.seat_id);
    if (!Number.isFinite(seatId)) continue;
    const ownerId = row.user_id === null ? null : Number(row.user_id);
    intentBySeat.set(seatId, Number.isFinite(ownerId) ? ownerId : null);
  }

  const vehicles = [];
  const seenVehicleIds = new Set();

  if (trip.vehicle_id) {
    const { rows } = await execQuery(
      client,
      `SELECT id, name, plate_number FROM vehicles WHERE id = ? LIMIT 1`,
      [trip.vehicle_id]
    );
    if (rows.length) {
      vehicles.push({
        vehicle_id: rows[0].id,
        vehicle_name: rows[0].name,
        plate_number: rows[0].plate_number,
        is_primary: true,
      });
      seenVehicleIds.add(rows[0].id);
    }
  }

  const { rows: tvRows } = await execQuery(
    client,
    `
    SELECT v.id, v.name, v.plate_number, tv.is_primary
      FROM trip_vehicles tv
      JOIN vehicles v ON v.id = tv.vehicle_id
     WHERE tv.trip_id = ?
     ORDER BY tv.is_primary DESC, v.id
    `,
    [tripId]
  );

  for (const row of tvRows) {
    if (seenVehicleIds.has(row.id)) {
      const idx = vehicles.findIndex((v) => v.vehicle_id === row.id);
      if (idx !== -1 && row.is_primary && !vehicles[idx].is_primary) {
        vehicles[idx].is_primary = true;
      }
      continue;
    }
    vehicles.push({
      vehicle_id: row.id,
      vehicle_name: row.name,
      plate_number: row.plate_number,
      is_primary: !!row.is_primary,
    });
    seenVehicleIds.add(row.id);
  }

  if (vehicles.length === 0) return null;

  let totalAvailable = 0;

  for (const veh of vehicles) {
    const { rows: seatRows } = await execQuery(
      client,
      `
      SELECT id, label, row, seat_col, seat_type, seat_number
        FROM seats
       WHERE vehicle_id = ?
       ORDER BY row, seat_col, id
      `,
      [veh.vehicle_id]
    );

    const { rows: resRows } = await execQuery(
      client,
      `
      SELECT r.seat_id, r.board_station_id, r.exit_station_id, r.status
        FROM reservations r
        JOIN seats s ON s.id = r.seat_id
       WHERE r.trip_id = ?
         AND r.status <> 'cancelled'
         AND s.vehicle_id = ?
      `,
      [tripId, veh.vehicle_id]
    );

    const seatReservations = new Map();
    for (const r of resRows) {
      const seatId = Number(r.seat_id);
      if (!seatReservations.has(seatId)) seatReservations.set(seatId, []);
      seatReservations.get(seatId).push({
        board: stationSeq.get(Number(r.board_station_id)),
        exit: stationSeq.get(Number(r.exit_station_id)),
        status: r.status,
      });
    }

    const seatList = [];

    for (const seat of seatRows) {
      const passengers = seatReservations.get(Number(seat.id)) || [];
      let isAvailable = true;
      let status = 'free';
      const overlaps = [];

      const seatId = Number(seat.id);
      const holdOwnerId = intentBySeat.get(seatId);
      const heldByMe = holdOwnerId !== undefined && holdOwnerId !== null && holdOwnerId === normalizedOwner;
      const heldByOther = holdOwnerId === null
        ? true
        : holdOwnerId !== undefined && holdOwnerId !== normalizedOwner;

      for (const p of passengers) {
        if (p.status !== 'active') continue;
        const rBoard = p.board;
        const rExit = p.exit;
        if (!Number.isFinite(rBoard) || !Number.isFinite(rExit)) continue;
        const overlap = Math.max(boardSeq, rBoard) < Math.min(exitSeq, rExit);
        if (overlap) {
          isAvailable = false;
          status = 'partial';
          overlaps.push({
            start: Math.max(boardSeq, rBoard),
            end: Math.min(exitSeq, rExit),
          });
          if (rBoard <= boardSeq && rExit >= exitSeq) {
            status = 'full';
            break;
          }
        }
      }

      if (!isAvailable && status === 'partial' && overlaps.length) {
        overlaps.sort((a, b) => (a.start - b.start) || (b.end - a.end));
        let coverage = boardSeq;
        let hasGap = false;
        for (const seg of overlaps) {
          if (seg.start > coverage) {
            hasGap = true;
            break;
          }
          coverage = Math.max(coverage, seg.end);
          if (coverage >= exitSeq) break;
        }
        if (!hasGap && coverage >= exitSeq) {
          status = 'full';
        }
      }

      if (heldByOther) {
        isAvailable = false;
        if (status === 'free') status = 'partial';
      }

      const selectable = isAvailable && !heldByOther;
      const countsAsAvailable = selectable && !heldByMe;

      if (seat.seat_type !== 'driver' && seat.seat_type !== 'guide' && countsAsAvailable) {
        totalAvailable += 1;
      }

      if (includeSeats) {
        seatList.push({
          id: seat.id,
          label: seat.label,
          row: seat.row,
          seat_col: seat.seat_col,
          seat_type: seat.seat_type,
          seat_number: seat.seat_number,
          status,
          is_available: selectable,
          hold_status: heldByMe ? 'mine' : heldByOther ? 'other' : null,
        });
      }
    }

    if (includeSeats) {
      veh.seats = seatList;
    }
  }

  return {
    trip,
    vehicles,
    totalAvailable,
  };
}

router.get('/routes', async (_req, res) => {
  try {
    const { rows } = await db.query(
      `
      SELECT
        rs.route_id,
        r.name AS route_name,
        rs.station_id,
        rs.sequence,
        s.name AS station_name
      FROM route_stations rs
      JOIN routes r ON r.id = rs.route_id
      JOIN stations s ON s.id = rs.station_id
      WHERE r.visible_online = 1
      ORDER BY rs.route_id, rs.sequence
      `
    );

    if (!rows.length) {
      return res.json({ stations: [], relations: [], routes: [], stopDetails: [] });
    }

    const { rows: priceRows } = await db.query(
      `
      SELECT
        pl.route_id,
        pli.from_station_id,
        pli.to_station_id,
        pli.price
      FROM price_list_items pli
      JOIN price_lists pl ON pl.id = pli.price_list_id
      WHERE pl.category_id = ?
        AND pli.price > 0
        AND pl.effective_from = (
              SELECT MAX(effective_from)
                FROM price_lists
               WHERE route_id = pl.route_id
                 AND category_id = pl.category_id
                 AND effective_from <= CURDATE()
        )
      `,
      [PUBLIC_ONLY_CATEGORY_ID]
    );

    const { rows: detailRows } = await db.query(
      `
      SELECT
        rs.route_id,
        rs.station_id,
        rs.sequence,
        s.name        AS station_name,
        s.latitude    AS station_latitude,
        s.longitude   AS station_longitude,
        rs.travel_time_from_previous_minutes,
        rs.public_note_tur,
        rs.public_note_retur,
        rs.public_latitude_tur,
        rs.public_longitude_tur,
        rs.public_latitude_retur,
        rs.public_longitude_retur
      FROM route_stations rs
      JOIN routes r ON r.id = rs.route_id
      JOIN stations s ON s.id = rs.station_id
      WHERE r.visible_online = 1
      ORDER BY rs.route_id, rs.sequence
      `
    );

    const stationsMap = new Map();
    const byRoute = new Map();

    for (const row of rows) {
      stationsMap.set(Number(row.station_id), row.station_name);
      const routeId = Number(row.route_id);
      if (!byRoute.has(routeId)) {
        byRoute.set(routeId, { name: row.route_name, stationIds: [] });
      }
      const entry = byRoute.get(routeId);
      entry.stationIds.push(Number(row.station_id));
    }

    const pricedPairsByRoute = new Map();
    const allowedStations = new Set();

    for (const priceRow of priceRows) {
      const routeId = Number(priceRow.route_id);
      if (!byRoute.has(routeId)) continue;
      const fromId = Number(priceRow.from_station_id);
      const toId = Number(priceRow.to_station_id);
      const priceValue = Number(priceRow.price);
      if (!Number.isFinite(priceValue) || priceValue <= 0) continue;

      if (!pricedPairsByRoute.has(routeId)) {
        pricedPairsByRoute.set(routeId, new Set());
      }
      const pairSet = pricedPairsByRoute.get(routeId);
      const key = `${fromId}|${toId}`;
      pairSet.add(key);
      allowedStations.add(fromId);
      allowedStations.add(toId);
    }

    if (!allowedStations.size) {
      return res.json({ stations: [], relations: [], routes: [], stopDetails: [] });
    }

    const relationSet = new Set();
    for (const [routeId, routeInfo] of byRoute.entries()) {
      const allowedPairs = pricedPairsByRoute.get(routeId);
      if (!allowedPairs || allowedPairs.size === 0) continue;
      const stationList = routeInfo.stationIds;
      for (let i = 0; i < stationList.length; i += 1) {
        for (let j = i + 1; j < stationList.length; j += 1) {
          const from = stationList[i];
          const to = stationList[j];
          const forwardKey = `${from}|${to}`;
          const reverseKey = `${to}|${from}`;
          if (allowedPairs.has(forwardKey)) {
            relationSet.add(forwardKey);
          }
          if (allowedPairs.has(reverseKey)) {
            relationSet.add(reverseKey);
          }
        }
      }
    }

    const stations = Array.from(stationsMap.entries())
      .filter(([id]) => allowedStations.has(Number(id)))
      .map(([id, name]) => ({ id: Number(id), name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const relations = Array.from(relationSet).map((key) => {
      const [from, to] = key.split('|').map((n) => Number(n));
      return { from_station_id: from, to_station_id: to };
    });

    const routes = Array.from(byRoute.entries())
      .filter(([id]) => {
        const allowedPairs = pricedPairsByRoute.get(Number(id));
        return allowedPairs && allowedPairs.size > 0;
      })
      .map(([id, info]) => ({
        id: Number(id),
        name: info.name,
        stations: info.stationIds
          .map((stationId) => stationsMap.get(stationId))
          .filter(Boolean),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const groupedDetails = new Map();
    for (const row of detailRows) {
      const routeId = Number(row.route_id);
      if (!groupedDetails.has(routeId)) {
        groupedDetails.set(routeId, []);
      }
      groupedDetails.get(routeId).push(row);
    }

    const stopDetails = [];
    for (const [routeId, list] of groupedDetails.entries()) {
      const ordered = list.slice().sort((a, b) => Number(a.sequence) - Number(b.sequence));

      let cumulativeForward = 0;
      ordered.forEach((row, idx) => {
        const noteTur = row.public_note_tur ? String(row.public_note_tur).trim() : null;
        const latTurRaw = row.public_latitude_tur != null ? Number(row.public_latitude_tur) : null;
        const lngTurRaw = row.public_longitude_tur != null ? Number(row.public_longitude_tur) : null;
        const latFallback = row.station_latitude != null ? Number(row.station_latitude) : null;
        const lngFallback = row.station_longitude != null ? Number(row.station_longitude) : null;

        stopDetails.push({
          route_id: routeId,
          station_id: Number(row.station_id),
          station_name: row.station_name,
          direction: 'tur',
          sequence: idx + 1,
          offset_minutes: cumulativeForward,
          note: noteTur || null,
          latitude: Number.isFinite(latTurRaw) ? latTurRaw : latFallback,
          longitude: Number.isFinite(lngTurRaw) ? lngTurRaw : lngFallback,
        });

        const segDuration = Number(row.travel_time_from_previous_minutes) || 0;
        cumulativeForward += segDuration > 0 ? segDuration : 0;
      });

      let cumulativeReturn = 0;
      for (let idx = ordered.length - 1, seq = 1; idx >= 0; idx -= 1, seq += 1) {
        const row = ordered[idx];
        const noteRet = row.public_note_retur ? String(row.public_note_retur).trim() : null;
        const latRetRaw = row.public_latitude_retur != null ? Number(row.public_latitude_retur) : null;
        const lngRetRaw = row.public_longitude_retur != null ? Number(row.public_longitude_retur) : null;
        const latTurRaw = row.public_latitude_tur != null ? Number(row.public_latitude_tur) : null;
        const lngTurRaw = row.public_longitude_tur != null ? Number(row.public_longitude_tur) : null;
        const latFallback = row.station_latitude != null ? Number(row.station_latitude) : null;
        const lngFallback = row.station_longitude != null ? Number(row.station_longitude) : null;

        stopDetails.push({
          route_id: routeId,
          station_id: Number(row.station_id),
          station_name: row.station_name,
          direction: 'retur',
          sequence: seq,
          offset_minutes: cumulativeReturn,
          note: noteRet || null,
          latitude: Number.isFinite(latRetRaw)
            ? latRetRaw
            : Number.isFinite(latTurRaw)
              ? latTurRaw
              : latFallback,
          longitude: Number.isFinite(lngRetRaw)
            ? lngRetRaw
            : Number.isFinite(lngTurRaw)
              ? lngTurRaw
              : lngFallback,
        });

        const segDuration = Number(row.travel_time_from_previous_minutes) || 0;
        cumulativeReturn += segDuration > 0 ? segDuration : 0;
      }
    }

    res.json({ stations, relations, routes, stopDetails });
  } catch (err) {
    console.error('[public/routes] error', err);
    res.status(500).json({ error: 'Eroare internă la încărcarea stațiilor.' });
  }
});

router.get('/trips', async (req, res) => {
  const fromStationId = Number(req.query.from_station_id);
  const toStationId = Number(req.query.to_station_id);
  const date = sanitizeDate(req.query.date);
  const passengers = Number(req.query.passengers || 1) || 1;
  const { ownerId: intentOwnerId } = ensureIntentOwner(req, res);

  if (!fromStationId || !toStationId || !date) {
    return res.status(400).json({ error: 'Parametri incompleți pentru căutare.' });
  }

  try {
    const { rows } = await db.query(
      `
      SELECT
        t.id AS trip_id,
        t.route_id,
        t.vehicle_id,
        t.date AS trip_date,
        DATE_FORMAT(t.time, '%H:%i') AS departure_time,
        t.boarding_started,
        rs.direction,
        rs.id AS schedule_id,
        r.name AS route_name
      FROM trips t
      JOIN trip_stations board ON board.trip_id = t.id AND board.station_id = ?
      JOIN trip_stations \`exit\` ON \`exit\`.trip_id = t.id AND \`exit\`.station_id = ?
      JOIN route_schedules rs ON rs.id = t.route_schedule_id
      JOIN routes r ON r.id = t.route_id
      JOIN route_stations board_rs ON board_rs.route_id = t.route_id AND board_rs.station_id = board.station_id
      JOIN route_stations exit_rs ON exit_rs.route_id = t.route_id AND exit_rs.station_id = \`exit\`.station_id
      WHERE t.date = DATE(?)
        AND board.sequence < \`exit\`.sequence
        AND (
          (COALESCE(rs.direction, 'tur') = 'tur' AND board_rs.sequence < exit_rs.sequence)
          OR (COALESCE(rs.direction, 'tur') = 'retur' AND board_rs.sequence > exit_rs.sequence)
        )
        AND r.visible_online = 1
        AND t.boarding_started = 0
        AND TIMESTAMP(t.date, t.time) > NOW()
        AND NOT EXISTS (
          SELECT 1
            FROM schedule_exceptions se
           WHERE se.schedule_id = t.route_schedule_id
             AND se.disable_online = 1
             AND (
                  se.exception_date IS NULL
               OR se.exception_date = DATE(?)
               OR (se.weekday IS NOT NULL AND se.weekday = DAYOFWEEK(DATE(?)) - 1)
             )
        )
      ORDER BY t.time ASC
      `,
      [fromStationId, toStationId, date, date, date]
    );

    const results = [];
    for (const trip of rows) {
      const availability = evaluateTripAvailability({
        ...trip,
        date: trip.trip_date || date,
      });
      if (availability.status !== 'ok') {
        continue;
      }

      const seatInfo = await computeSeatAvailability(db, {
        tripId: trip.trip_id,
        boardStationId: fromStationId,
        exitStationId: toStationId,
        includeSeats: false,
        intentOwnerId,
      });

      if (!seatInfo) continue;

      const durationInfo = await estimateSegmentDuration(
        db,
        trip.route_id,
        trip.direction,
        fromStationId,
        toStationId
      );

      const priceInfo = await getPublicPrice(db, {
        routeId: trip.route_id,
        fromStationId,
        toStationId,
        date,
        scheduleId: trip.schedule_id,
      });

      const priceValue = Number(priceInfo?.price);
      if (!Number.isFinite(priceValue) || priceValue <= 0) {
        continue;
      }

      const available = Number.isFinite(seatInfo.totalAvailable) ? seatInfo.totalAvailable : null;
      const canBook = available == null ? true : available >= Math.max(passengers, 1);

      results.push({
        trip_id: trip.trip_id,
        route_id: trip.route_id,
        route_name: trip.route_name,
        direction: normalizeDirection(trip.direction),
        departure_time: trip.departure_time,
        arrival_time: durationInfo?.minutes ? addMinutesToTime(trip.departure_time, durationInfo.minutes) : null,
        duration_minutes: durationInfo?.minutes ?? null,
        price: priceValue,
        currency: 'RON',
        price_list_id: priceInfo?.price_list_id ?? null,
        pricing_category_id: priceInfo?.pricing_category_id ?? null,
        available_seats: available,
        can_book: canBook,
        board_station_id: fromStationId,
        exit_station_id: toStationId,
        date,
        schedule_id: trip.schedule_id,
      });
    }

    res.json(results);
  } catch (err) {
    console.error('[public/trips] error', err);
    res.status(500).json({ error: 'Eroare internă la căutarea curselor.' });
  }
});

router.get('/trips/:tripId/seats', async (req, res) => {
  const tripId = Number(req.params.tripId);
  const boardStationId = Number(req.query.board_station_id);
  const exitStationId = Number(req.query.exit_station_id);

  if (!tripId || !boardStationId || !exitStationId) {
    return res.status(400).json({ error: 'Parametri insuficienți pentru diagrama locurilor.' });
  }

  try {
    const trip = await loadTripBasics(null, tripId);
    if (!trip) {
      return res.status(404).json({ error: 'Cursa nu a fost găsită.' });
    }

    const availability = evaluateTripAvailability(trip);
    if (availability.status === 'boarding') {
      return res.status(409).json({ error: 'Îmbarcarea a început pentru această cursă; rezervările nu mai sunt disponibile.' });
    }
    if (availability.status === 'past') {
      return res.status(409).json({ error: 'Cursa a plecat deja; rezervările nu mai sunt disponibile.' });
    }

    const { ownerId: intentOwnerId } = ensureIntentOwner(req, res);
    const seatInfo = await computeSeatAvailability(db, {
      tripId,
      boardStationId,
      exitStationId,
      includeSeats: true,
      intentOwnerId,
      preloadedTrip: trip,
    });

    if (!seatInfo) {
      return res.status(404).json({ error: 'Nu am găsit diagrama pentru cursa selectată.' });
    }

    const payload = {
      trip_id: tripId,
      board_station_id: boardStationId,
      exit_station_id: exitStationId,
      available_seats: seatInfo.totalAvailable,
        vehicles: seatInfo.vehicles.map((veh) => ({
          vehicle_id: veh.vehicle_id,
          vehicle_name: veh.vehicle_name,
          plate_number: veh.plate_number,
          is_primary: !!veh.is_primary,
          seats: (veh.seats || []).map((seat) => ({
            id: seat.id,
            label: seat.label,
            row: seat.row,
            seat_col: seat.seat_col,
            seat_type: seat.seat_type,
            status: seat.status,
            is_available: seat.is_available,
            hold_status: seat.hold_status ?? null,
          })),
        })),
      };

    res.json(payload);
  } catch (err) {
    console.error('[public/trip seats] error', err);
    res.status(500).json({ error: 'Eroare internă la încărcarea locurilor.' });
  }
});

router.get('/trips/:tripId/discount-types', async (req, res) => {
  const tripId = Number(req.params.tripId);
  if (!Number.isFinite(tripId) || tripId <= 0) {
    return res.status(400).json({ error: 'Parametru tripId invalid.' });
  }

  try {
    const trip = await loadTripBasics(null, tripId);
    if (!trip) {
      return res.status(404).json({ error: 'Cursa nu a fost găsită.' });
    }

    const availability = evaluateTripAvailability(trip);
    if (availability.status === 'boarding') {
      return res.status(409).json({ error: 'Îmbarcarea a început pentru această cursă; rezervările nu mai sunt disponibile.' });
    }
    if (availability.status === 'past') {
      return res.status(409).json({ error: 'Cursa a plecat deja; rezervările nu mai sunt disponibile.' });
    }

    const discounts = await fetchOnlineDiscountTypes(null, trip.schedule_id);
    res.json(discounts);
  } catch (err) {
    console.error('[public/trips/:tripId/discount-types] error', err);
    res.status(500).json({ error: 'Nu am putut încărca reducerile disponibile.' });
  }
});

router.get('/account/reservations', requirePublicAuth, async (req, res) => {
  try {
    const phoneRaw = req.publicUser?.phone || req.publicUser?.phoneNormalized || '';
    const phoneVariants = buildPhoneVariants(phoneRaw);

    const personIds = [];
    if (phoneVariants.length) {
      const placeholders = phoneVariants.map(() => '?').join(',');
      const { rows: peopleRows } = await db.query(
        `SELECT id FROM people WHERE phone IN (${placeholders})`,
        phoneVariants,
      );
      for (const row of peopleRows || []) {
        const id = Number(row.id);
        if (Number.isFinite(id)) {
          personIds.push(id);
        }
      }
    }

    const whereParts = [];
    const params = [];

    if (personIds.length) {
      const personPlaceholders = personIds.map(() => '?').join(',');
      whereParts.push(`r.person_id IN (${personPlaceholders})`);
      params.push(...personIds);
    }

    for (const variant of phoneVariants) {
      whereParts.push('r.observations LIKE ?');
      params.push(`%Telefon: ${variant}%`);
    }

    if (!whereParts.length) {
      return res.json({ upcoming: [], past: [] });
    }

    const sql = `
      SELECT
        r.id,
        r.trip_id,
        r.status,
        DATE_FORMAT(r.reservation_time, '%Y-%m-%dT%H:%i:%s') AS reservation_time,
        DATE_FORMAT(t.date, '%Y-%m-%d') AS trip_date,
        TIME_FORMAT(t.time, '%H:%i') AS trip_time,
        rt.name AS route_name,
        COALESCE(NULLIF(TRIM(rs.direction), ''), 'tur') AS direction,
        s.label AS seat_label,
        r.board_station_id,
        r.exit_station_id,
        sb.name AS board_name,
        se.name AS exit_name,
        p.name AS passenger_name,
        rp.price_value AS price_value,
        rp.price_list_id AS price_list_id,
        rp.pricing_category_id AS pricing_category_id,
        COALESCE(discounts.total_discount, 0) AS discount_total,
        COALESCE(payments.total_paid, 0) AS paid_amount,
        payments.last_method AS payment_method,
        payments.has_paid AS has_paid,
        CASE
          WHEN t.date IS NULL THEN 1
          WHEN t.time IS NULL THEN CASE WHEN t.date < CURDATE() THEN 1 ELSE 0 END
          ELSE CASE WHEN TIMESTAMP(t.date, t.time) < NOW() THEN 1 ELSE 0 END
        END AS is_past
      FROM reservations r
      JOIN trips t ON t.id = r.trip_id
      JOIN routes rt ON rt.id = t.route_id
      LEFT JOIN route_schedules rs ON rs.id = t.route_schedule_id
      JOIN seats s ON s.id = r.seat_id
      LEFT JOIN stations sb ON sb.id = r.board_station_id
      LEFT JOIN stations se ON se.id = r.exit_station_id
      LEFT JOIN people p ON p.id = r.person_id
      LEFT JOIN reservation_pricing rp ON rp.reservation_id = r.id
      LEFT JOIN (
        SELECT reservation_id, SUM(discount_amount) AS total_discount
          FROM reservation_discounts
         GROUP BY reservation_id
      ) discounts ON discounts.reservation_id = r.id
      LEFT JOIN (
        SELECT
          reservation_id,
          SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS total_paid,
          MAX(CASE WHEN status = 'paid' THEN payment_method ELSE NULL END) AS last_method,
          MAX(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS has_paid
        FROM payments
        GROUP BY reservation_id
      ) payments ON payments.reservation_id = r.id
      WHERE (${whereParts.join(' OR ')})
        AND (
          rp.booking_channel = 'online'
          OR (rp.booking_channel IS NULL AND r.observations LIKE '%Rezervare online%')
        )
      ORDER BY t.date DESC, t.time DESC, r.id DESC
    `;

    const { rows } = await db.query(sql, params);

    const seen = new Set();
    const upcoming = [];
    const past = [];

    for (const row of rows || []) {
      const id = Number(row.id);
      if (!Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id);

      const tripIdValue = row.trip_id == null ? null : Number(row.trip_id);
      const boardStationIdValue = row.board_station_id == null ? null : Number(row.board_station_id);
      const exitStationIdValue = row.exit_station_id == null ? null : Number(row.exit_station_id);
      const priceValue = row.price_value != null ? Number(row.price_value) : null;
      const discountTotal = row.discount_total != null ? Number(row.discount_total) : 0;
      const paidAmount = row.paid_amount != null ? Number(row.paid_amount) : 0;
      const isPast = Number(row.is_past) === 1;
      const isPaid = Number(row.has_paid) === 1;

      const entry = {
        id,
        trip_id: Number.isFinite(tripIdValue) ? tripIdValue : null,
        status: row.status || 'pending',
        reservation_time: row.reservation_time || null,
        trip_date: row.trip_date || null,
        trip_time: row.trip_time || null,
        travel_datetime: row.trip_date ? `${row.trip_date}T${row.trip_time || '00:00'}` : null,
        route_name: row.route_name || null,
        direction: row.direction || null,
        seat_label: row.seat_label || null,
        board_station_id: Number.isFinite(boardStationIdValue) ? boardStationIdValue : null,
        exit_station_id: Number.isFinite(exitStationIdValue) ? exitStationIdValue : null,
        board_name: row.board_name || null,
        exit_name: row.exit_name || null,
        passenger_name: row.passenger_name || null,
        price_value: priceValue,
        discount_total: discountTotal,
        paid_amount: paidAmount,
        payment_method: row.payment_method || null,
        is_paid: isPaid,
        currency: 'RON',
      };

      if (isPast) {
        past.push(entry);
      } else {
        upcoming.push(entry);
      }
    }

    res.json({ upcoming, past });
  } catch (err) {
    console.error('[public/account/reservations] error', err);
    res.status(500).json({ error: 'Nu am putut încărca rezervările.' });
  }
});

async function findOrCreatePerson(conn, { name, phone }) {
  const cleanPhone = sanitizePhone(phone);
  const cleanName = name && String(name).trim() ? String(name).trim().slice(0, 255) : null;

  if (cleanPhone) {
    const { rows: existing } = await execQuery(
      conn,
      `SELECT id, name FROM people WHERE phone = ? LIMIT 1`,
      [cleanPhone]
    );
    if (existing.length) {
      const personId = existing[0].id;
      if (cleanName && (!existing[0].name || existing[0].name.trim() !== cleanName)) {
        await execQuery(conn, `UPDATE people SET name = ? WHERE id = ?`, [cleanName, personId]);
      }
      return personId;
    }
    const insert = await execQuery(
      conn,
      `INSERT INTO people (name, phone) VALUES (?, ?)`,
      [cleanName, cleanPhone]
    );
    if (Number.isFinite(insert.insertId)) return insert.insertId;
    if (Number.isFinite(insert.raw?.insertId)) return insert.raw.insertId;
    return null;
  }

  if (cleanName) {
    const { rows: sameName } = await execQuery(
      conn,
      `SELECT id FROM people WHERE name = ? AND phone IS NULL LIMIT 1`,
      [cleanName]
    );
    if (sameName.length) return sameName[0].id;
    const insert = await execQuery(
      conn,
      `INSERT INTO people (name, phone) VALUES (?, NULL)`,
      [cleanName]
    );
    if (Number.isFinite(insert.insertId)) return insert.insertId;
    if (Number.isFinite(insert.raw?.insertId)) return insert.raw.insertId;
    return null;
  }

  return null;
}

async function isSeatFree(conn, { tripId, seatId, boardStationId, exitStationId }) {
  const [procRows] = await conn.query('CALL sp_is_seat_free(?, ?, ?, ?)', [
    tripId,
    seatId,
    boardStationId,
    exitStationId,
  ]);

  let resultRows = procRows;
  if (Array.isArray(procRows) && Array.isArray(procRows[0])) {
    resultRows = procRows[0];
  } else if (procRows && typeof procRows.rows === 'object') {
    resultRows = Array.isArray(procRows.rows[0]) ? procRows.rows[0] : procRows.rows;
  }

  const row = Array.isArray(resultRows) ? resultRows[0] : resultRows;
  const value = row && (row.is_free ?? row.IS_FREE ?? row.isFree ?? row[0]);
  return Number(value) === 1;
}

router.post('/promo/validate', async (req, res) => {
  try {
    const {
      code,
      trip_id: tripId,
      board_station_id: boardStationId,
      exit_station_id: exitStationId,
      seat_count: seatCount,
      phone,
      discount_type_id: discountTypeId,
      discount_type_ids: discountTypeIdsRaw,
    } = req.body || {};

    const discountTypeIds = Array.isArray(discountTypeIdsRaw)
      ? discountTypeIdsRaw.map((value) => {
          const parsed = Number(value);
          return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        })
      : null;

    const validation = await validatePromoForTrip(null, {
      code,
      tripId: Number(tripId),
      boardStationId: Number(boardStationId),
      exitStationId: Number(exitStationId),
      seatCount,
      phone,
      discountTypeId,
      discountTypeIds,
    });

    res.json(validation);
  } catch (err) {
    console.error('[public/promo/validate] error', err);
    res.status(500).json({ valid: false, reason: 'Nu am putut valida codul.' });
  }
});

router.post('/reservations', async (req, res) => {
  const {
    trip_id: tripIdRaw,
    board_station_id: boardStationIdRaw,
    exit_station_id: exitStationIdRaw,
    seats,
    contact,
    note,
    promo,
    passengers: passengersRawInput,
    discount_type_id: discountTypeIdRaw,
  } = req.body || {};

  const tripId = Number(tripIdRaw);
  const boardStationId = Number(boardStationIdRaw);
  const exitStationId = Number(exitStationIdRaw);
  const discountTypeId = Number(discountTypeIdRaw);
  const selectedDiscountTypeId = Number.isFinite(discountTypeId) && discountTypeId > 0 ? discountTypeId : null;
  const passengersRaw = Array.isArray(passengersRawInput) ? passengersRawInput : [];
  const passengerEntries = passengersRaw
    .map((item) => {
      const seatId = Number(item?.seat_id ?? item?.seatId);
      const name = item?.name ? String(item.name).trim().slice(0, 255) : '';
      const discountRaw = item?.discount_type_id ?? item?.discountTypeId ?? null;
      const parsedDiscount = Number(discountRaw);
      return {
        seatId: Number.isFinite(seatId) && seatId > 0 ? seatId : null,
        name,
        discountTypeId: Number.isFinite(parsedDiscount) && parsedDiscount > 0 ? parsedDiscount : null,
      };
    })
    .filter((entry) => entry.seatId !== null);

  const seatIdsFromBody = Array.isArray(seats)
    ? seats.map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0)
    : [];

  let seatIds = [];
  if (passengerEntries.length > 0) {
    const uniqueSeatIds = new Set();
    for (const entry of passengerEntries) {
      if (uniqueSeatIds.has(entry.seatId)) {
        return res.status(400).json({ error: 'Locurile selectate conțin duplicate.' });
      }
      uniqueSeatIds.add(entry.seatId);
    }
    seatIds = passengerEntries.map((entry) => entry.seatId);
    if (seatIdsFromBody.length > 0) {
      const normalized = seatIdsFromBody.slice().sort((a, b) => a - b);
      const fromPassengers = seatIds.slice().sort((a, b) => a - b);
      if (normalized.length !== fromPassengers.length || normalized.some((value, idx) => value !== fromPassengers[idx])) {
        return res.status(400).json({ error: 'Locurile selectate nu corespund cu pasagerii trimiși.' });
      }
    }
  } else {
    seatIds = seatIdsFromBody;
  }

  if (!tripId || !boardStationId || !exitStationId || seatIds.length === 0) {
    return res.status(400).json({ error: 'Date incomplete pentru rezervare.' });
  }

  const userPhone =
    (req.publicUser?.phone && String(req.publicUser.phone).trim()) ||
    (req.publicUser?.phoneNormalized && String(req.publicUser.phoneNormalized).trim()) ||
    '';
  if (req.publicUser && !userPhone) {
    return res.status(428).json({
      error: 'Pentru a continua, completează numărul de telefon din contul tău.',
      needsProfileUpdate: true,
    });
  }

  const cleanName = contact?.name && String(contact.name).trim();
  const cleanPhone = sanitizePhone(contact?.phone);
  const rawEmail = contact?.email ? String(contact.email).trim() : '';
  const cleanEmail = rawEmail && rawEmail.length <= 255 ? rawEmail : '';
  const emailValid = cleanEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail);
  if (!cleanName || !cleanPhone || !emailValid) {
    return res.status(400).json({ error: 'Numele, telefonul și emailul sunt obligatorii.' });
  }

  const passengersData = passengerEntries.length > 0
    ? passengerEntries.map((entry) => ({
        seatId: entry.seatId,
        name: entry.name || '',
        discountTypeId: entry.discountTypeId,
      }))
    : seatIds.map((seatId) => ({
        seatId,
        name: cleanName,
        discountTypeId: selectedDiscountTypeId,
      }));

  if (passengersData.length !== seatIds.length) {
    return res.status(400).json({ error: 'Datele pasagerilor sunt incomplete.' });
  }

  for (const passenger of passengersData) {
    passenger.name = passenger.name ? passenger.name.slice(0, 255) : '';
    if (!passenger.name) {
      return res.status(400).json({ error: 'Completează numele pentru fiecare pasager.' });
    }
  }

  const { ownerId: intentOwnerId } = ensureIntentOwner(req, res);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const trip = await loadTripBasics(conn, tripId);
    if (!trip) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ error: 'Cursa selectată nu există sau este indisponibilă.' });
    }

    const availability = evaluateTripAvailability(trip);
    if (availability.status === 'boarding') {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ error: 'Îmbarcarea a început pentru această cursă; rezervările nu mai sunt disponibile.' });
    }
    if (availability.status === 'past') {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ error: 'Cursa a plecat deja; rezervările nu mai sunt disponibile.' });
    }

    const stationSeq = await loadTripStationSequences(conn, tripId);
    const boardSeq = stationSeq.get(Number(boardStationId));
    const exitSeq = stationSeq.get(Number(exitStationId));
    if (!Number.isFinite(boardSeq) || !Number.isFinite(exitSeq) || boardSeq >= exitSeq) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ error: 'Segment invalid pentru această cursă.' });
    }

    const vehicleIds = new Set();
    if (trip.vehicle_id) vehicleIds.add(Number(trip.vehicle_id));
    const { rows: otherVeh } = await execQuery(
      conn,
      `SELECT vehicle_id FROM trip_vehicles WHERE trip_id = ?`,
      [tripId]
    );
    for (const row of otherVeh) {
      vehicleIds.add(Number(row.vehicle_id));
    }

    if (vehicleIds.size === 0) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ error: 'Nu există vehicule asociate cursei.' });
    }

    const placeholders = seatIds.map(() => '?').join(',');
    const { rows: seatRows } = await execQuery(
      conn,
      `SELECT id, vehicle_id, seat_type FROM seats WHERE id IN (${placeholders})`,
      seatIds
    );

    if (seatRows.length !== seatIds.length) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ error: 'Cel puțin un loc selectat nu există.' });
    }

    for (const seat of seatRows) {
      if (!vehicleIds.has(Number(seat.vehicle_id))) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: 'Locul selectat nu aparține acestei curse.' });
      }
      const allowedTypes = new Set(['normal', 'foldable', 'wheelchair']);
      if (!allowedTypes.has(seat.seat_type)) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: 'Unele locuri nu sunt disponibile pentru pasageri.' });
      }
    }

    if (seatIds.length) {
      const { rows: intentRows } = await execQuery(
        conn,
        `SELECT seat_id, user_id FROM reservation_intents WHERE trip_id = ? AND seat_id IN (${placeholders}) AND expires_at > NOW()`,
        [tripId, ...seatIds],
      );

      const normalizedOwner = Number.isInteger(intentOwnerId) ? Number(intentOwnerId) : null;
      for (const intent of intentRows) {
        const owner = intent.user_id === null ? null : Number(intent.user_id);
        const sameOwner = normalizedOwner !== null && owner === normalizedOwner;
        if (!sameOwner) {
          await conn.rollback();
          conn.release();
          return res.status(409).json({ error: 'Unul dintre locuri este rezervat temporar de alt client.' });
        }
      }
    }

    for (const seatId of seatIds) {
      const free = await isSeatFree(conn, {
        tripId,
        seatId,
        boardStationId,
        exitStationId,
      });
      if (!free) {
        await conn.rollback();
        conn.release();
        return res.status(409).json({ error: 'Unul dintre locuri a fost rezervat între timp. Te rugăm să actualizezi.' });
      }
    }

    const priceInfo = await getPublicPrice(conn, {
      routeId: trip.route_id,
      fromStationId: boardStationId,
      toStationId: exitStationId,
      date: sanitizeDate(trip.date),
      scheduleId: trip.schedule_id,
    });

    const seatPassengerMap = new Map();
    for (const passenger of passengersData) {
      seatPassengerMap.set(passenger.seatId, passenger);
    }

    const passengerDiscountIds = Array.from(
      new Set(
        passengersData
          .map((passenger) => (Number.isFinite(Number(passenger.discountTypeId)) && Number(passenger.discountTypeId) > 0
            ? Number(passenger.discountTypeId)
            : null))
          .filter((value) => value !== null),
      ),
    );

    const seatDiscounts = new Map();
    let typeDiscountTotal = 0;

    if (passengerDiscountIds.length > 0) {
      if (!priceInfo || !Number.isFinite(Number(priceInfo.price))) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: 'Tariful pentru această rută nu permite aplicarea reducerii.' });
      }
      const discountMetaMap = await resolveMultipleOnlineDiscountTypes(conn, trip.schedule_id, passengerDiscountIds);
      for (const passenger of passengersData) {
        let meta = null;
        let amount = 0;
        if (passenger.discountTypeId) {
          meta = discountMetaMap.get(passenger.discountTypeId);
          if (!meta) {
            await conn.rollback();
            conn.release();
            return res.status(400).json({ error: 'Reducerea selectată nu este disponibilă pentru această plecare.' });
          }
          amount = computeTypeDiscountValue(priceInfo.price, meta);
        }
        seatDiscounts.set(passenger.seatId, { meta, amount });
        typeDiscountTotal += amount;
      }
    } else {
      for (const passenger of passengersData) {
        seatDiscounts.set(passenger.seatId, { meta: null, amount: 0 });
      }
    }

    typeDiscountTotal = Number(typeDiscountTotal.toFixed(2));

    let promoResult = null;
    if (promo && promo.code) {
      promoResult = await validatePromoForTrip(conn, {
        code: promo.code,
        tripId,
        boardStationId,
        exitStationId,
        seatCount: seatIds.length,
        phone: cleanPhone,
        priceInfoOverride: priceInfo,
        discountTypeId: selectedDiscountTypeId,
        discountTypeIds: passengersData.map((passenger) => passenger.discountTypeId ?? null),
      });
      if (!promoResult.valid) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: promoResult.reason || 'Codul promoțional nu este valid.' });
      }
    }

    const reservationIds = [];
    const noteText = note && String(note).trim() ? String(note).trim().slice(0, 300) : null;
    const observationParts = [
      'Rezervare online',
      `Contact: ${cleanName}`,
      `Telefon: ${cleanPhone}`,
      `Email: ${cleanEmail}`,
    ];
    if (noteText) {
      observationParts.push(`Notă client: ${noteText}`);
    }
    const observation = observationParts.join('\n').slice(0, 500);

    const initialPromoAmount = promoResult?.discount_amount ? Number(promoResult.discount_amount) : 0;
    let promoRemaining = initialPromoAmount;
    let contactPhoneAssigned = false;

    for (const seatId of seatIds) {
      const passengerInfo = seatPassengerMap.get(seatId) || { name: cleanName, discountTypeId: null };
      const passengerName = passengerInfo.name || cleanName;
      const phoneForPassenger = !contactPhoneAssigned ? cleanPhone : null;
      if (!contactPhoneAssigned) {
        contactPhoneAssigned = true;
      }

      const personId = await findOrCreatePerson(conn, {
        name: passengerName,
        phone: phoneForPassenger,
      });

      const seatDiscount = seatDiscounts.get(seatId) || { meta: null, amount: 0 };

      const insertRes = await execQuery(
        conn,
        `
        INSERT INTO reservations (trip_id, seat_id, person_id, board_station_id, exit_station_id, observations, created_by)
        VALUES (?, ?, ?, ?, ?, ?, NULL)
        `,
        [tripId, seatId, personId, boardStationId, exitStationId, observation || 'Rezervare online']
      );
      let reservationId = null;
      if (Number.isFinite(insertRes.insertId)) {
        reservationId = insertRes.insertId;
      } else if (Number.isFinite(insertRes.raw?.insertId)) {
        reservationId = insertRes.raw.insertId;
      }
      if (!Number.isFinite(reservationId)) {
        throw new Error('Nu am putut salva rezervarea.');
      }
      reservationIds.push(Number(reservationId));

      if (seatDiscount.meta && seatDiscount.amount > 0) {
        await execQuery(
          conn,
          `
          INSERT INTO reservation_discounts
            (reservation_id, discount_type_id, discount_amount, discount_snapshot)
          VALUES (?, ?, ?, ?)
          `,
          [reservationId, seatDiscount.meta.id, seatDiscount.amount, Number(seatDiscount.meta.value_off)]
        );
      }

      let promoPiece = 0;
      if (priceInfo && promoResult && promoRemaining > 0) {
        const perSeatPriceValue = Number(priceInfo.price || 0);
        const perSeatAfterType = Math.max(0, perSeatPriceValue - seatDiscount.amount);
        if (perSeatAfterType > 0) {
          const potential = Math.max(0, perSeatAfterType);
          promoPiece = Math.min(promoRemaining, potential);
          if (promoPiece > 0) {
            await execQuery(
              conn,
              `
              INSERT INTO reservation_discounts
                (reservation_id, discount_type_id, promo_code_id, discount_amount, discount_snapshot)
              VALUES (?, NULL, ?, ?, ?)
              `,
              [reservationId, promoResult.promo_code_id, promoPiece, promoResult.value_off]
            );
            await execQuery(
              conn,
              `
              INSERT INTO promo_code_usages (promo_code_id, reservation_id, phone, discount_amount)
              VALUES (?, ?, ?, ?)
              `,
              [promoResult.promo_code_id, reservationId, cleanPhone || null, promoPiece]
            );
            promoRemaining = Number((promoRemaining - promoPiece).toFixed(2));
          }
        }
      }

      if (priceInfo) {
        const finalPrice = Math.max(0, Number(priceInfo.price || 0) - seatDiscount.amount - promoPiece);
        await execQuery(
          conn,
          `
          INSERT INTO reservation_pricing (reservation_id, price_value, price_list_id, pricing_category_id, booking_channel)
          VALUES (?, ?, ?, ?, 'online')
          `,
          [
            reservationId,
            Number(finalPrice.toFixed(2)),
            priceInfo.price_list_id,
            priceInfo.pricing_category_id,
          ]
        );
      }

      await execQuery(
        conn,
        `
        INSERT INTO reservation_events (reservation_id, action, actor_id, details)
        VALUES (?, 'create', NULL, JSON_OBJECT('channel', 'online'))
        `,
        [reservationId]
      );
    }

    const promoUsed = Number((initialPromoAmount - promoRemaining).toFixed(2));

    if (seatIds.length) {
      await execQuery(
        conn,
        `DELETE FROM reservation_intents WHERE trip_id = ? AND seat_id IN (${placeholders})`,
        [tripId, ...seatIds],
      );
    }

    await conn.commit();
    conn.release();

    const baseAmount = priceInfo ? Number(priceInfo.price) * seatIds.length : null;
    const discountTotal = Number((typeDiscountTotal + promoUsed).toFixed(2));
    const totalAmount = baseAmount !== null ? Math.max(0, Number(baseAmount) - Number(discountTotal)) : null;

    res.status(201).json({
      success: true,
      reservation_ids: reservationIds,
      trip_id: tripId,
      amount_total: totalAmount,
      discount_total: discountTotal,
      currency: priceInfo ? 'RON' : null,
    });
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {
      /* ignore */
    }
    conn.release();
    console.error('[public/reservations] error', err);
    res.status(500).json({ error: 'Eroare la salvarea rezervării.' });
  }
});

module.exports = router;
