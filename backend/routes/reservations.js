// backend/routes/reservations.js (MariaDB 10.6)
const express = require('express');
const db = require('../db');
const { randomUUID } = require('crypto');
const router = express.Router();

const { requireAuth, requireRole } = require('../middleware/auth');
const { normalizeDirection, isReturnDirection, ensureDirection } = require('../utils/direction');

// ✅ Acces pentru rutele interne (admin, operator_admin, agent, driver)
router.use(['/', '/:id'], (req, res, next) => {
  // lăsăm să treacă public doar cererile de tip POST /public_reservation
  if (req.path.startsWith('/public_reservation')) return next();
  requireAuth(req, res, (err) => {
    if (err) return;
    requireRole('admin', 'operator_admin', 'agent', 'driver')(req, res, next);
  });
});




// ── Config fiscală din .env (asemenea routes/cash.js)
const FISCAL_URL = process.env.FISCAL_PRINTER_URL || '';
const FISCAL_ON = String(process.env.FISCAL_ENABLED || 'true').toLowerCase() === 'true';
const FISCAL_TO = Number(process.env.FISCAL_TIMEOUT_MS || 6000);

// Mapare operator -> device A/B din .env: FISCAL_DEV_FOR_OPERATOR_1=A, FISCAL_DEV_FOR_OPERATOR_2=B
function devForOperatorId(opId) {
  const envKey = `FISCAL_DEV_FOR_OPERATOR_${Number(opId)}`;
  return (process.env[envKey] || '').toUpperCase() || (Number(opId) === 1 ? 'A' : 'B');
}
function toMoneyDot(x, decimals = 2) {
  const n = Number(String(x).replace(',', '.').trim() || '0');
  return n.toFixed(decimals);
}
function safeJson(x) {
  try { return JSON.parse(x); } catch { return { raw: String(x) }; }
}






/* ---------------------- helpers: stații/valideri ---------------------- */


const sanitizePhone = (raw) => {
  if (!raw) return '';
  return String(raw).replace(/\D/g, '');
};


/**
 * Upsert pentru persoana asociată unei rezervări, pe baza nume/telefon.
 * Reguli:
 *  - dacă currentPersonId are phone NULL și primim telefon -> îl setăm (UPDATE)
 *  - dacă currentPersonId are phone diferit:
 *      - dacă noul telefon aparține altcuiva -> returnăm acel alt ID (rezervarea se mută pe acea persoană)
 *      - altfel -> actualizăm phone la persoana curentă
 *  - dacă nu avem currentPersonId:
 *      - dacă găsim persoană cu telefon -> o folosim
 *      - altfel creăm persoană nouă
 * Întoarce { personId, changed } unde changed=true dacă s-a făcut UPDATE/realocare.
 */
async function upsertPersonForReservation({ name, phone, currentPersonId }) {
  const cleanPhone = (phone || '').replace(/\D/g, '') || null;

  // 1) dacă avem deja persoana curentă
  if (currentPersonId) {
    const cur = await db.query(
      `SELECT id, name, phone FROM people WHERE id = ?`,
      [currentPersonId]
    );
    if (!cur.rows.length) {
      // nu există în DB -> cădem pe logica „ca și cum n-am avea current”
    } else {
      const row = cur.rows[0];
      const curPhone = row.phone ? String(row.phone).replace(/\D/g, '') : null;

      // a) dacă nu primim telefon nou -> eventual doar numele
      if (!cleanPhone) {
        if (name && name.trim() && name.trim() !== (row.name || '').trim()) {
          await db.query(`UPDATE people SET name=? WHERE id=?`, [name.trim(), row.id]);
          return { personId: row.id, changed: true };
        }
        return { personId: row.id, changed: false };
      }

      // b) avem telefon nou
      if (!curPhone) {
        // setăm telefonul pe aceeași persoană
        await db.query(`UPDATE people SET phone=?, name=COALESCE(NULLIF(?, ''), name) WHERE id=?`,
          [cleanPhone, (name || '').trim(), row.id]);
        return { personId: row.id, changed: true };
      }

      if (curPhone === cleanPhone) {
        // doar numele eventual
        if (name && name.trim() && name.trim() !== (row.name || '').trim()) {
          await db.query(`UPDATE people SET name=? WHERE id=?`, [name.trim(), row.id]);
          return { personId: row.id, changed: true };
        }
        return { personId: row.id, changed: false };
      }

      // telefonul diferă; verificăm dacă aparține altcuiva
      const other = await db.query(`SELECT id, name FROM people WHERE phone = ?`, [cleanPhone]);
      if (other.rows.length) {
        // realocăm rezervarea pe acea persoană
        const newId = other.rows[0].id;
        // putem ajusta numele acelei persoane dacă am primit unul non-gol
        if (name && name.trim()) {
          await db.query(`UPDATE people SET name=COALESCE(NULLIF(?, ''), name) WHERE id=?`, [name.trim(), newId]);
        }
        return { personId: newId, changed: true };
      }
      // nu există altcineva cu telefonul -> îl mutăm pe persoana curentă
      await db.query(`UPDATE people SET phone=?, name=COALESCE(NULLIF(?, ''), name) WHERE id=?`,
        [cleanPhone, (name || '').trim(), row.id]);
      return { personId: row.id, changed: true };
    }
  }

  // 2) nu avem currentPersonId
  if (cleanPhone) {
    const found = await db.query(`SELECT id FROM people WHERE phone = ?`, [cleanPhone]);
    if (found.rows.length) {
      const pid = found.rows[0].id;
      if (name && name.trim()) {
        await db.query(`UPDATE people SET name=COALESCE(NULLIF(?, ''), name) WHERE id=?`, [name.trim(), pid]);
      }
      return { personId: pid, changed: false };
    }
    const ins = await db.query(
      `INSERT INTO people (name, phone) VALUES (?, ?)`,
      [name && name.trim() ? name.trim() : null, cleanPhone]
    );
    return { personId: ins.insertId, changed: true };
  }

  // fără telefon -> identificăm după nume (nume+NULL phone)
  if (name && name.trim()) {
    const sameName = await db.query(
      `SELECT id FROM people WHERE name = ? AND phone IS NULL`,
      [name.trim()]
    );
    if (sameName.rows.length) return { personId: sameName.rows[0].id, changed: false };
    const ins = await db.query(`INSERT INTO people (name, phone) VALUES (?, NULL)`, [name.trim()]);
    return { personId: ins.insertId, changed: true };
  }
  return { personId: null, changed: false };
}



// ——— utils audit & booking-channel ———
// Scrie în audit_logs. Mapează acțiunile vechi:
//   'create' -> 'reservation.create', 'update' -> 'reservation.update',
//   'cancel' -> 'reservation.cancel', 'move' -> 'reservation.move',
//   'pay'    -> 'payment.capture' (entity='payment', related_id=reservationId)
async function logEvent(reservationId, action, actorId, details = null) {
  try {
    const correlation_id = details?.correlation_id || randomUUID();
    const channel = details?.channel || null;
    const amount = details?.amount || null;
    const payment_method = details?.method || null;
    const transaction_id = details?.transaction_id || null;
    const related_id = details?.from_reservation_id || details?.related_reservation_id || null;
    const note = details?.note || null;


    let entity = 'reservation';
    let finalAction = action && action.startsWith('reservation.') ? action : `reservation.${action}`;

    // plăți -> entitate 'payment', acțiune 'payment.capture', legată de rezervare prin related_id
    if (action === 'pay' || action === 'payment.capture') {
      entity = 'payment';
      finalAction = 'payment.capture';
    }

    await db.query(
      `
      INSERT INTO audit_logs
        (created_at, actor_id, entity, entity_id, action, related_entity, related_id,
         correlation_id, channel, amount, payment_method, transaction_id, note, before_json, after_json)
      VALUES (NOW(), ?, ?, ?, ?, 'reservation', ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      `,
      [
        actorId || null,
        entity,
        reservationId || null,
        finalAction,
        related_id || null,
        correlation_id,
        channel,
        amount,
        payment_method,
        transaction_id,
        note
      ]
    );
  } catch (e) {
    console.warn('[audit] failed', e.message);
  }
}

function deriveBookingChannel(role, requested) {
  // agenții / șoferii / operatorii -> 'agent'; altfel 'online' (sau ce vine explicit)
  if (role === 'agent' || role === 'driver' || role === 'operator_admin' || role === 'admin') {
    return 'agent';
  }
  return requested === 'agent' ? 'agent' : 'online';
}



async function touchTravelerDefault(phone, routeId, boardStationId, exitStationId, direction) {
  try {
    const cleanPhone = sanitizePhone(phone);
    const normDirection = ensureDirection(direction);
    if (
      !cleanPhone ||
      !Number.isInteger(routeId) ||
      !Number.isInteger(boardStationId) ||
      !Number.isInteger(exitStationId) ||
      !normDirection
    ) {
      return;
    }

    const existing = await db.query(
      'SELECT id FROM traveler_defaults WHERE phone = ? AND route_id = ? AND direction = ? LIMIT 1',
      [cleanPhone, routeId, normDirection],
    );

    let targetId = existing.rows[0]?.id || null;
    if (!targetId) {
      const legacy = await db.query(
        'SELECT id FROM traveler_defaults WHERE phone = ? AND route_id = ? LIMIT 1',
        [cleanPhone, routeId],
      );
      targetId = legacy.rows[0]?.id || null;
    }

    if (targetId) {
      await db.query(
        `
          UPDATE traveler_defaults
             SET board_station_id = ?,
                 exit_station_id  = ?,
                 direction        = ?,
                 use_count        = use_count + 1,
                 last_used_at     = NOW()
           WHERE id = ?
        `,
        [boardStationId, exitStationId, normDirection, targetId],
      );
    } else {
      await db.query(
        `
          INSERT INTO traveler_defaults
            (phone, route_id, direction, board_station_id, exit_station_id, use_count, last_used_at)
          VALUES
            (?, ?, ?, ?, ?, 1, NOW())
        `,
        [cleanPhone, routeId, normDirection, boardStationId, exitStationId],
      );
    }
  } catch (err) {
    console.error('[reservations] traveler_defaults update error', err);
  }
}

async function getStops(routeId, direction = 'tur') {
  const norm = normalizeDirection(direction);

  const result = await db.query(
    `
    SELECT rs.station_id, s.name
    FROM route_stations rs
    JOIN stations s ON s.id = rs.station_id
    WHERE rs.route_id = ?
    ORDER BY rs.sequence
    `,
    [routeId]
  );

  const base = result.rows.map(r => ({ id: r.station_id, name: r.name }));
  const orderedStops = isReturnDirection(norm) ? base.slice().reverse() : base;

  const ordered = orderedStops.map((stop, index) => ({ ...stop, index }));
  const indexById = new Map(ordered.map(stop => [String(stop.id), stop.index]));

  return { ordered, indexById };
}

async function validateSegmentAvailability({
  tripId,
  seatId,
  boardStationId,
  exitStationId,
  excludeReservationId = null,
}) {
  if (!tripId || !seatId || !boardStationId || !exitStationId) {
    return { ok: false, error: 'Date segment incomplete' };
  }

  const stationRes = await db.query(
    `SELECT station_id, sequence
       FROM trip_stations
      WHERE trip_id = ?
        AND station_id IN (?, ?)` ,
    [tripId, boardStationId, exitStationId]
  );

  if (stationRes.rowCount < 2) {
    return { ok: false, error: 'Stațiile nu aparțin cursei selectate' };
  }

  const seqMap = new Map(
    stationRes.rows.map((row) => [Number(row.station_id), Number(row.sequence)])
  );
  const boardSeq = seqMap.get(Number(boardStationId));
  const exitSeq = seqMap.get(Number(exitStationId));

  if (boardSeq === undefined || exitSeq === undefined) {
    return { ok: false, error: 'Stațiile nu aparțin cursei selectate' };
  }

  if (boardSeq >= exitSeq) {
    return { ok: false, error: 'Segment invalid' };
  }

  let overlapSql = `
    SELECT r.id, b.sequence AS board_seq, e.sequence AS exit_seq
      FROM reservations r
      JOIN trip_stations b
        ON b.trip_id = r.trip_id AND b.station_id = r.board_station_id
      JOIN trip_stations e
        ON e.trip_id = r.trip_id AND e.station_id = r.exit_station_id
     WHERE r.trip_id = ?
       AND r.seat_id = ?
       AND r.status = 'active'
  `;
  const params = [tripId, seatId];
  if (excludeReservationId) {
    overlapSql += ' AND r.id <> ?';
    params.push(excludeReservationId);
  }

  const existing = await db.query(overlapSql, params);
  const conflict = existing.rows.find((row) => {
    const existingBoard = Number(row.board_seq);
    const existingExit = Number(row.exit_seq);
    return !(existingExit <= boardSeq || existingBoard >= exitSeq);
  });

  if (conflict) {
    return { ok: false, error: 'Loc ocupat pe segment' };
  }

  return { ok: true, boardSeq, exitSeq };
}

async function resolveSchedule(routeId, { scheduleId, time, directionHint }) {
  const normDirection = directionHint ? normalizeDirection(directionHint) : null;

  if (scheduleId) {
    const { rows } = await db.query(
      `SELECT id, route_id, direction, TIME_FORMAT(departure, '%H:%i') AS departure
         FROM route_schedules
        WHERE id = ?
        LIMIT 1`,
      [scheduleId]
    );
    if (!rows.length) return null;
    const row = rows[0];
    if (routeId && Number(row.route_id) !== Number(routeId)) {
      return { mismatch: true };
    }
    return {
      id: row.id,
      direction: normalizeDirection(row.direction),
      departure: row.departure,
    };
  }

  const timeVal = typeof time === 'string' ? time.slice(0, 5) : time;
  if (!timeVal) return null;

  let sql = `SELECT id, direction, TIME_FORMAT(departure, '%H:%i') AS departure
               FROM route_schedules
              WHERE route_id = ?
                AND TIME(departure) = TIME(?)`;
  const params = [routeId, timeVal];
  if (normDirection) {
    sql += ' AND direction = ?';
    params.push(normDirection);
  }
  sql += ' LIMIT 1';

  const { rows } = await db.query(sql, params);
  if (!rows.length) return null;
  return {
    id: rows[0].id,
    direction: normalizeDirection(rows[0].direction),
    departure: rows[0].departure,
  };
}

const parseStationId = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
};

const ensureStationId = (stopsInfo, value) => {
  const parsed = parseStationId(value);
  if (parsed === null) return null;
  return stopsInfo.indexById.has(String(parsed)) ? parsed : null;
};

const getStationIndex = (stopsInfo, stationId) => {
  if (stationId === null || stationId === undefined) return -1;
  const idx = stopsInfo.indexById.get(String(stationId));
  return idx === undefined ? -1 : idx;
};

function isPassengerValid(passenger) {
  const { name, phone } = passenger;
  const nameValid = !name || /^[a-zA-Z0-9ăîâșțĂÎÂȘȚ \-]+$/.test(name.trim());
  const cleanedPhone = phone?.replace(/\s+/g, '') || '';
  const phoneValid = !phone || /^(\+)?\d{10,}$/.test(cleanedPhone);
  const hasAtLeastOne = (name && name.trim()) || (phone && phone.trim());
  return hasAtLeastOne && nameValid && phoneValid;
}

/* ----------------------------- CREATE ----------------------------- */
/**
 * POST /api/reservations
 * Body: { date, time, route_id, vehicle_id, price_list_id, booking_channel, passengers: [...] }
 */
// POST /api/reservations
router.post('/', async (req, res) => {
  console.log('Primit payload:', req.body);

  const {
    date,
    time,
    route_id,
    route_schedule_id,
    direction,
    vehicle_id,
    price_list_id,
    booking_channel,
    pay_cash_now = false,
    cash_description,
    passengers,
  } = req.body;

  const idempotencyKey = req.get('Idempotency-Key');
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Missing Idempotency-Key' });
  }

  const scheduleId = route_schedule_id ? Number(route_schedule_id) : null;
  const directionHint = direction || null;
  const timeValue = typeof time === 'string' ? time.slice(0, 5) : time;

  if (
    !date ||
    !route_id ||
    !vehicle_id ||
    (!scheduleId && !timeValue) ||
    !Array.isArray(passengers) ||
    passengers.length === 0
  ) {
    return res
      .status(400)
      .json({ error: 'date/time sau schedule_id/route_id/vehicle_id/passengers lipsă sau invalide' });
  }

  const userIdCandidate = Number(req.user?.id);
  const rawUserId = Number.isInteger(userIdCandidate) ? userIdCandidate : null;
  const idempotencyUserId = rawUserId ?? 0;

  const fetchIdempotencyRow = async () => {
    if (idempotencyUserId === 0) {
      const result = await db.query(
        `SELECT id, reservation_id
           FROM idempotency_keys
          WHERE idem_key = ? AND (user_id IS NULL OR user_id = 0)
          LIMIT 1`,
        [idempotencyKey]
      );
      return result.rows[0] || null;
    }

    const result = await db.query(
      `SELECT id, reservation_id
         FROM idempotency_keys
        WHERE user_id = ? AND idem_key = ?
        LIMIT 1`,
      [idempotencyUserId, idempotencyKey]
    );
    return result.rows[0] || null;
  };

  let existingIdempotency = await fetchIdempotencyRow();
  if (existingIdempotency) {
    return res.status(200).json({
      id: existingIdempotency.reservation_id !== null
        ? Number(existingIdempotency.reservation_id)
        : null,
      idempotent: true,
    });
  }

  let idempotencyRowId = null;
  let recordedReservationId = null;

  try {
    const insert = await db.query(
      `INSERT INTO idempotency_keys (user_id, idem_key) VALUES (?, ?)`,
      [idempotencyUserId, idempotencyKey]
    );
    idempotencyRowId = insert.insertId;
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      existingIdempotency = await fetchIdempotencyRow();
      if (!existingIdempotency) {
        console.warn('[Idempotency] ER_DUP_ENTRY dar nu găsesc rând pentru cheia asta');
      }
      const recordedId = existingIdempotency?.reservation_id;
      return res.status(200).json({
        id: recordedId != null ? Number(recordedId) : null,
        idempotent: true,
      });
    }

    console.error('[POST /api/reservations] idempotency insert failed', err);
    return res.status(500).json({ error: 'Eroare la inițializarea Idempotency-Key' });
  }

  const cleanupIdempotency = async () => {
    if (idempotencyRowId && recordedReservationId === null) {
      try {
        await db.query('DELETE FROM idempotency_keys WHERE id = ?', [idempotencyRowId]);
      } catch (cleanupErr) {
        console.warn('[POST /api/reservations] cleanup idempotency failed', cleanupErr);
      } finally {
        idempotencyRowId = null;
      }
    }
  };

  // ID-urile rezervărilor NOI create în acest request (pt. tipărire fiscală imediată)
  const createdReservationIds = [];
  const updatedReservations = [];

  // ─────────────────────────────────────────────────────────────────────
  // 0) PREP PROMO: O singură tranzacție dedicată promo-ului pe tot request-ul
  // ─────────────────────────────────────────────────────────────────────
  const promoPayload = req.body?.promo_apply || null;
  let promoConn = null;     // conexiune tranzacțională pt. lock
  let promoMeta = null;     // { id, code, value_off, max_total_uses }
  let promoRemaining = 0;   // cât mai e de împărțit din reducerea totală

  const abortWithError = async (status, payload) => {
    if (promoConn) {
      try { await promoConn.rollback(); } catch (_) { /* ignore */ }
      try { promoConn.release(); } catch (_) { /* ignore */ }
      promoConn = null;
    }
    await cleanupIdempotency();
    return res.status(status).json(payload);
  };

  // validare pasageri (minim: nume/telefon conform utilitarului tău)
  for (const p of passengers) {
    if (!isPassengerValid(p)) {
      return abortWithError(400, { error: 'Datele pasagerului nu sunt valide (nume sau telefon).' });
    }
  }

  if (promoPayload && promoPayload.code && Number(promoPayload.discount_amount) > 0) {
    try {
      promoConn = await db.getConnection();
      await promoConn.beginTransaction();

      const lockRes = await promoConn.query(
        `SELECT id, code, max_total_uses, value_off
           FROM promo_codes
          WHERE id = ? AND UPPER(code) = UPPER(?) AND active = 1
          FOR UPDATE`,
        [promoPayload.promo_code_id || 0, promoPayload.code]
      );
      const row = lockRes?.rows?.[0] || null;
      if (!row) {
        // cod inactiv/invalid → nu blocăm salvarea
        await promoConn.rollback();
        promoConn.release();
        promoConn = null;
      } else {
        const usedRes = await promoConn.query(
          `SELECT COUNT(*) AS c FROM promo_code_usages WHERE promo_code_id = ?`,
          [row.id]
        );
        const usedCount = Number(usedRes?.rows?.[0]?.c || 0);
        if (row.max_total_uses && usedCount >= row.max_total_uses) {
          // limită atinsă
          await promoConn.rollback();
          promoConn.release();
          promoConn = null;
        } else {
          promoMeta = row;
          promoRemaining = Number(promoPayload.discount_amount || 0);
        }
      }
    } catch (e) {
      // orice eroare pe promo nu trebuie să oprească rezervarea
      try { if (promoConn) { await promoConn.rollback(); promoConn.release(); } } catch { }
      promoConn = null;
      promoMeta = null;
      promoRemaining = 0;
      console.warn('Promo init skipped:', e.message);
    }
  }

  try {
    const scheduleInfo = await resolveSchedule(route_id, {
      scheduleId,
      time: timeValue,
      directionHint,
    });

    if (!scheduleInfo) {
      return abortWithError(404, { error: 'Programare inexistentă pentru rută/oră' });
    }
    if (scheduleInfo.mismatch) {
      return abortWithError(400, { error: 'Programarea nu aparține rutei selectate' });
    }

    const resolvedScheduleId = scheduleInfo.id;
    const resolvedDirection = scheduleInfo.direction;
    const canonicalTime = timeValue || scheduleInfo.departure;

    if (!canonicalTime) {
      return abortWithError(400, { error: 'Ora plecării nu a putut fi determinată' });
    }

    // 1) stațiile rutei
    const stopsInfo = await getStops(route_id, resolvedDirection);
    if (!stopsInfo.ordered.length) {
      return abortWithError(400, { error: 'Ruta nu are stații definite' });
    }

    // 2) trip existent sau îl creăm
    let trip_id;
    const tripRes = await db.query(
      `SELECT id FROM trips
        WHERE route_schedule_id = ?
          AND vehicle_id = ?
          AND date = DATE(?)
          AND TIME(time) = TIME(?)
        LIMIT 1`,
      [resolvedScheduleId, vehicle_id, date, canonicalTime]
    );
    if (tripRes.rows.length > 0) {
      trip_id = tripRes.rows[0].id;
    } else {
      const ins = await db.query(
        `INSERT INTO trips (route_schedule_id, route_id, vehicle_id, date, time)
         VALUES (?, ?, ?, ?, TIME(?))`,
        [resolvedScheduleId, route_id, vehicle_id, date, canonicalTime]
      );
      trip_id = ins.insertId;
    }

    // 3) pasageri (creăm/actualizăm rezervări, calcule, plăți)
    for (const p of passengers) {
      const boardStationId = ensureStationId(stopsInfo, p.board_station_id);
      const exitStationId = ensureStationId(stopsInfo, p.exit_station_id);
      if (boardStationId === null || exitStationId === null) {
        return abortWithError(400, { error: 'Stație de urcare/coborâre invalidă pentru pasager.' });
      }

      // 3.1) persoana (UPSERȚ + realocare după telefon, dacă aparține altcuiva)
      const name = (p.name || '').trim();
      const phone = p.phone ? p.phone.replace(/\D/g, '') : null;

      const seatId = Number(p.seat_id);
      if (!Number.isInteger(seatId)) {
        return abortWithError(400, { error: 'seat_id invalid' });
      }

      let existingReservation = null;
      if (p.reservation_id) {
        const existingRes = await db.query(
          `SELECT id, person_id, trip_id, seat_id, board_station_id, exit_station_id, version
             FROM reservations
            WHERE id = ?
            LIMIT 1`,
          [p.reservation_id]
        );
        existingReservation = existingRes.rows[0] || null;
        if (!existingReservation) {
          return abortWithError(404, { error: 'Rezervarea nu a fost găsită' });
        }
      }

      // persoana curentă, dacă e editare (din payload sau din rezervarea existentă)
      let currentPersonId = null;
      if (p.person_id && Number.isInteger(Number(p.person_id))) {
        currentPersonId = Number(p.person_id);
      } else if (existingReservation) {
        currentPersonId = existingReservation.person_id || null;
      }

      // folosim helper-ul deja definit în fișier
      const { personId: resolvedPersonId } = await upsertPersonForReservation({
        name,
        phone,
        currentPersonId
      });
      const person_id = resolvedPersonId || currentPersonId || null;

      const targetTripId = existingReservation ? Number(existingReservation.trip_id) : Number(trip_id);

      const segmentCheck = await validateSegmentAvailability({
        tripId: targetTripId,
        seatId,
        boardStationId,
        exitStationId,
        excludeReservationId: existingReservation ? Number(existingReservation.id) : null,
      });

      if (!segmentCheck.ok) {
        const statusCode = segmentCheck.error === 'Loc ocupat pe segment' ? 409 : 400;
        return abortWithError(statusCode, { error: segmentCheck.error });
      }

      // 3.2) rezervare: update sau insert nou
      if (existingReservation) {
        const expectedVersion = Number(p.version);
        if (!Number.isInteger(expectedVersion)) {
          return abortWithError(400, { error: 'Lipsește câmpul version' });
        }

        const updateRes = await db.query(
          `
          UPDATE reservations
             SET person_id        = ?,
                 seat_id          = ?,
                 board_station_id = ?,
                 exit_station_id  = ?,
                 observations     = ?,
                 version          = version + 1
          WHERE id = ? AND version = ?
          `,
          [person_id, seatId, boardStationId, exitStationId, p.observations || null, p.reservation_id, expectedVersion]
        );

        if (updateRes.rowCount === 0) {
          return abortWithError(409, { error: 'Versiune depășită' });
        }

        const newVersion = expectedVersion + 1;
        updatedReservations.push({ id: Number(p.reservation_id), version: newVersion });

        await touchTravelerDefault(phone, Number(route_id), boardStationId, exitStationId, resolvedDirection);
        await logEvent(p.reservation_id, 'update', Number(req.user?.id) || null, {
          person_id,
          seat_id: seatId,
          board_station_id: boardStationId,
          exit_station_id: exitStationId,
          version: newVersion,
        });

        await db.query(
          `DELETE FROM reservation_intents WHERE trip_id = ? AND seat_id = ?`,
          [targetTripId, seatId]
        );

        // Discount (opțional) — DOAR pentru rezervările NOI aplicăm promo; la update nu refacem istoricul
        // (dacă vrei și la update, se poate adăuga logică separată cu atenție la dublări)

      } else {
        // INSERT rezervare
        const insRes = await db.query(
          `
          INSERT INTO reservations
            (trip_id, seat_id, person_id, board_station_id, exit_station_id, observations, status, created_by)
          VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
          `,
          [trip_id, seatId, person_id, boardStationId, exitStationId, p.observations || null, Number(req.user?.id) || null]
        );
        const newResId = insRes.insertId;
        createdReservationIds.push(newResId);

        await touchTravelerDefault(phone, Number(route_id), boardStationId, exitStationId, resolvedDirection);
        await logEvent(newResId, 'create', Number(req.user?.id) || null, {
          trip_id, seat_id: seatId, person_id, board_station_id: boardStationId, exit_station_id: exitStationId
        });

        await db.query(
          `DELETE FROM reservation_intents WHERE trip_id = ? AND seat_id = ?`,
          [trip_id, seatId]
        );

        // 3.3) Discount (opțional) — tipuri standard (elev/student/etc.)
        let typeDiscountAmount = 0;
        if (p.discount_type_id) {
          const qDisc = await db.query(
            `SELECT id, code, label, value_off, type FROM discount_types WHERE id = ?`,
            [p.discount_type_id]
          );
          if (!qDisc.rows.length) throw new Error('Tip de discount inexistent');
          const disc = qDisc.rows[0];

          const basePrice = Number(p.price ?? 0);
          typeDiscountAmount =
            disc.type === 'percent'
              ? +(basePrice * Number(disc.value_off) / 100).toFixed(2)
              : +Number(disc.value_off);
          if (typeDiscountAmount > basePrice) typeDiscountAmount = basePrice;

          await db.query(
            `
            INSERT INTO reservation_discounts
              (reservation_id, discount_type_id, discount_amount, discount_snapshot)
            VALUES (?, ?, ?, ?)
            `,
            [newResId, disc.id, typeDiscountAmount, Number(disc.value_off)]
          );
        }

        // 3.4) APLICARE PROMO (dacă există și mai avem sumă disponibilă)
        let promoPiece = 0;
        if (promoConn && promoMeta && promoRemaining > 0) {
          // baza după discountul de tip
          const baseAfterType = Math.max(0, Number(p.price ?? 0) - Number(typeDiscountAmount || 0));
          if (baseAfterType > 0) {
            promoPiece = Math.min(promoRemaining, baseAfterType);
            if (promoPiece > 0) {
              // înregistrăm reducerea promo pe rezervare
              await promoConn.query(
                `
                INSERT INTO reservation_discounts
                  (reservation_id, discount_type_id, promo_code_id, discount_amount, discount_snapshot)
                VALUES (?, NULL, ?, ?, ?)
                `,
                [newResId, promoMeta.id, promoPiece, Number(promoMeta.value_off)]
              );
              // log folosire (pentru limitări/statistici)
              await promoConn.query(
                `
                INSERT INTO promo_code_usages (promo_code_id, reservation_id, phone, discount_amount)
                VALUES (?, ?, ?, ?)
                `,
                [promoMeta.id, newResId, phone || null, promoPiece]
              );
              promoRemaining = +(promoRemaining - promoPiece).toFixed(2);
            }
          }
        }

        // 3.5) Pricing (după discount de tip + promo)
        const netPrice = Math.max(
          0,
          Number(p.price ?? 0) - Number(typeDiscountAmount || 0) - Number(promoPiece || 0)
        );
        const listId = p.price_list_id || price_list_id;
        if (!listId) throw new Error('price_list_id lipsă în payload');


        // booking_channel corect + employee_id real la pricing
        const effChannel = deriveBookingChannel(req.user?.role, booking_channel);
        await db.query(
          `
          INSERT INTO reservation_pricing
            (reservation_id, price_value, price_list_id, pricing_category_id, booking_channel, employee_id)
          VALUES (?, ?, ?, ?, ?, ?)
          `,
          [newResId, netPrice, listId, p.category_id, effChannel, Number(req.user?.id) || null]
        );

        // 3.6) Plată (opțional) – DOAR CARD aici.
        // CASH se face ulterior prin POST /api/reservations/:id/payments/cash (tipărește și marchează paid)
        if (p.payment_method === 'card' && p.transaction_id) {
          await db.query(
            `
            INSERT INTO payments
              (reservation_id, amount, status, payment_method, transaction_id, timestamp)
            VALUES (?, ?, 'paid', 'card', ?, NOW())
            `,
            [newResId, netPrice, p.transaction_id]
          );
          await logEvent(newResId, 'pay', Number(req.user?.id) || null, { method: 'card', amount: netPrice });
        }
        // Pentru cash: frontend va apela ulterior
        //   POST /api/reservations/:id/payments/cash
        // care tipărește și DOAR apoi marchează plata în DB.
      }
    } // end for passengers

    // finalizează tranzacția promo (dacă a existat)
    if (promoConn) {
      await promoConn.commit();
      promoConn.release();
      promoConn = null;
    }

    recordedReservationId = createdReservationIds[0] ?? updatedReservations[0]?.id ?? null;
    if (idempotencyRowId) {
      await db.query(
        'UPDATE idempotency_keys SET reservation_id = ? WHERE id = ?',
        [recordedReservationId, idempotencyRowId]
      );
      idempotencyRowId = null;
    }

    const responsePayload = {
      ok: true,
      message: 'Rezervare salvată',
      createdReservationIds,
    };

    if (updatedReservations.length) {
      responsePayload.updatedReservations = updatedReservations;
    }

    if (recordedReservationId !== null) {
      responsePayload.id = Number(recordedReservationId);
    }

    return res.status(201).json(responsePayload);
  } catch (err) {
    console.error('Eroare la salvarea rezervării:', err);
    // dacă a existat promoConn, asigură-te că nu rămâne deschisă
    try { if (promoConn) { await promoConn.rollback(); promoConn.release(); promoConn = null; } } catch { }
    await cleanupIdempotency();
    return res.status(500).json({ error: 'Eroare internă la salvare' });
  }
});








/* ----------------------------- PAYMENT SUMMARY ----------------------------- */
/**
 * GET /api/reservations/:id/summary
 * Returnează price_value din reservation_pricing și statusul plăților existente.
 */
router.get('/:id/summary', async (req, res) => {
  try {
    const reservationId = Number(req.params.id);
    if (!reservationId) return res.status(400).json({ error: 'reservationId invalid' });

    // --- normalizează răspunsul la SELECT (merge cu mysql2 [rows,fields], cu rows simple sau cu .rows) ---
    const pricingRes = await db.query(
      `SELECT price_value FROM reservation_pricing WHERE reservation_id = ? LIMIT 1`,
      [reservationId]
    );
    const pricingRows = Array.isArray(pricingRes)
      ? (Array.isArray(pricingRes[0]) ? pricingRes[0] : pricingRes)
      : pricingRes?.rows;
    const price_value = pricingRows?.[0]?.price_value ?? null;

    const paidRes = await db.query(
      `SELECT IFNULL(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) AS paid_amount
       FROM payments WHERE reservation_id = ?`,
      [reservationId]
    );
    const paidRows = Array.isArray(paidRes)
      ? (Array.isArray(paidRes[0]) ? paidRes[0] : paidRes)
      : paidRes?.rows;
    const paid_amount = paidRows?.[0]?.paid_amount ?? 0;

    res.json({
      reservationId,
      price: Number(price_value || 0),
      amountPaid: Number(paid_amount || 0),
      paid: Number(price_value || 0) > 0 ? Number(paid_amount) >= Number(price_value) : paid_amount > 0
    });
  } catch (err) {
    console.error('[GET /api/reservations/:id/summary]', err);
    res.status(500).json({ error: 'Eroare la summary' });
  }
});

// ---------------------- CASH INTENT (no DB write) ----------------------
router.post('/:id/payments/cash-intent', async (req, res) => {
  try {
    const reservationId = Number(req.params.id);
    if (!reservationId) return res.status(400).json({ error: 'reservationId invalid' });

    const employeeId = Number(req.body?.employeeId || req.user?.id || 0) || null;

    // 1) suma rămasă = price_value - SUM(paid)
    const pricingRes = await db.query(
      `SELECT price_value FROM reservation_pricing WHERE reservation_id = ? LIMIT 1`,
      [reservationId]
    );
    const pricingRows = Array.isArray(pricingRes)
      ? (Array.isArray(pricingRes[0]) ? pricingRes[0] : pricingRes)
      : pricingRes?.rows;
    const price_value = Number(pricingRows?.[0]?.price_value || 0);

    const paidRes = await db.query(
      `SELECT IFNULL(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) AS paid_amount
         FROM payments WHERE reservation_id = ?`,
      [reservationId]
    );
    const paidRows = Array.isArray(paidRes)
      ? (Array.isArray(paidRes[0]) ? paidRes[0] : paidRes)
      : paidRes?.rows;
    const alreadyPaid = Number(paidRows?.[0]?.paid_amount || 0);

    const amount = +(price_value - alreadyPaid).toFixed(2);
    if (!(amount > 0)) return res.status(409).json({ error: 'Rezervare deja achitată' });

    // 2) operatorul din cursă (rezervare -> trip -> route_schedule -> operator_id)
    const opRow = await db.query(
      `SELECT rs.operator_id
         FROM reservations r
         JOIN trips t ON t.id = r.trip_id
         JOIN route_schedules rs ON rs.id = t.route_schedule_id
        WHERE r.id = ?
        LIMIT 1`,
      [reservationId]
    );
    const opId = Number(
      (Array.isArray(opRow) ? (Array.isArray(opRow[0]) ? opRow[0] : opRow) : opRow?.rows)?.[0]?.operator_id || 0
    );
    if (!opId) return res.status(409).json({ error: 'Nu am putut determina operatorul cursei' });

    const dev = devForOperatorId(opId);     // 'A' | 'B'
    const base = 'http://127.0.0.1:9000';
    const desc = (req.body?.description || `Rezervare #${reservationId}`).toString();
    const priceStr = toMoneyDot(amount, 2);  // "0.10"

    // 3) NU scriem în payments aici. Frontendul va confirma după CLOSE reușit.
    return res.json({
      ok: true,
      status: 'pending',
      print_in_browser: true,
      reservationId,
      amount,
      dev,
      fiscal: {
        open: { url: `${base}/fiscal/open?dev=${dev}`, body: { operator: '30', password: '0030', till: '1' } },
        sale: { url: `${base}/fiscal/sale?dev=${dev}`, body: { name: desc.slice(0, 48), tax: '1', price: priceStr, quantity: '1.000', department: '1', unit: 'BUC' } },
        pay: { url: `${base}/fiscal/pay?dev=${dev}`, body: { mode: 'cash', amount: priceStr } },
        close: { url: `${base}/fiscal/close?dev=${dev}`, body: {} }
      }
    });
  } catch (err) {
    console.error('[POST /api/reservations/:id/payments/cash-intent]', err);
    return res.status(500).json({ error: 'Eroare la inițierea plății cash' });
  }
});





/* ---------------------- CASH CONFIRM (writes DB) ---------------------- */
/* POST /api/reservations/:id/payments/confirm */
router.post('/:id/payments/confirm', async (req, res) => {
  try {
    const reservationId = Number(req.params.id);
    const employeeId = Number(req.body?.employeeId || req.user?.id || 0) || null;
    const amount = Number(req.body?.amount || 0);
    if (!reservationId || !(amount > 0)) {
      return res.status(400).json({ error: 'invalid data' });
    }
    await db.query(
      `INSERT INTO payments (reservation_id, amount, status, payment_method, transaction_id, timestamp, collected_by)
       VALUES (?, ?, 'paid', 'cash', NULL, NOW(), ?)`,
      [reservationId, amount, employeeId]
    );
    await logEvent(reservationId, 'pay', employeeId, { method: 'cash', amount });
    return res.json({ ok: true, reservationId, status: 'paid' });
  } catch (err) {
    console.error('[POST /api/reservations/:id/payments/confirm]', err);
    return res.status(500).json({ error: 'confirm failed' });
  }
});




/* ----------------------------- BACKUP LIST ----------------------------- */

router.get('/backup', async (req, res) => {
  try {
    const { trip_id } = req.query;
    const query = `
      SELECT b.id AS backup_id, b.reservation_id, b.seat_id, s.label, b.trip_id, b.backup_time,
             p.name AS passenger_name, p.phone
      FROM reservations_backup b
      LEFT JOIN people p ON b.person_id = p.id
      LEFT JOIN seats s ON b.seat_id = s.id
      ${trip_id ? 'WHERE b.trip_id = ?' : ''}
      ORDER BY b.backup_time DESC
    `;
    const result = await db.query(query, trip_id ? [trip_id] : []);
    res.json(result.rows);
  } catch (err) {
    console.error('Eroare la interogarea backupurilor:', err);
    res.status(500).json({ error: 'Eroare la interogarea backupurilor' });
  }
});

/* ----------------------------- DELETE by composite ----------------------------- */

router.post('/delete', async (req, res) => {
  const { seat_id, trip_id } = req.body;
  const boardStationId = parseStationId(req.body.board_station_id);
  const exitStationId = parseStationId(req.body.exit_station_id);

  if (!seat_id || !trip_id || boardStationId === null || exitStationId === null) {
    return res.status(400).json({ error: 'Parametri lipsă' });
  }

  try {
    // 1) determină ID-urile (pentru backup + audit)
    const { rows } = await db.query(
      `
      SELECT id, trip_id, seat_id, person_id
      FROM reservations
      WHERE seat_id = ? AND trip_id = ? AND board_station_id = ? AND exit_station_id = ?
      `,
      [seat_id, trip_id, boardStationId, exitStationId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Rezervarea nu a fost găsită' });
    }

    // 2) backup pentru toate
    for (const r of rows) {
      await db.query(
        `
        INSERT INTO reservations_backup (reservation_id, trip_id, seat_id, label, person_id)
        VALUES (?, ?, ?, '', ?)
        `,
        [r.id, r.trip_id, r.seat_id, r.person_id]
      );
    }

    // 3) soft delete pentru toate
    await db.query(
      `
      UPDATE reservations
         SET status = 'cancelled'
       WHERE seat_id = ? AND trip_id = ? AND board_station_id = ? AND exit_station_id = ? AND status <> 'cancelled'
      `,
      [seat_id, trip_id, boardStationId, exitStationId]
    );

    // 4) audit pentru fiecare — etichetă clară
    const single = rows.length === 1;
    const details = single
      ? {
        by: 'ui_delete_passenger',               // ȘTERGERE UNICĂ din meniul din UI
        route: 'POST /api/reservations/delete',
        seat_id,
        trip_id,
        board_station_id: boardStationId,
        exit_station_id: exitStationId,
      }
      : {
        by: 'ui_delete_seat_bulk',               // caz rar: dacă ar nimeri mai multe rânduri
        route: 'POST /api/reservations/delete',
        seat_id,
        trip_id,
        exit_station_id: exitStationId,
        count: rows.length,
      };

    for (const r of rows) {
      await logEvent(r.id, 'cancel', Number(req.user?.id) || null, details);
    }


    return res.json({ success: true, cancelled: rows.map(r => r.id) });
  } catch (err) {
    console.error('Eroare la soft delete (compozit):', err);
    return res.status(500).json({ error: 'Eroare la anulare' });
  }
});


/* ----------------------------- DELETE by id ----------------------------- */

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // 1) backup (include și seat + label, dacă vrei extinde SELECT)
    await db.query(
      `
      INSERT INTO reservations_backup (reservation_id, trip_id, seat_id, label, person_id)
      SELECT r.id, r.trip_id, r.seat_id, '' AS label, r.person_id
      FROM reservations r
      WHERE r.id = ?
      `,
      [id]
    );

    // 2) soft delete (idempotent)
    const upd = await db.query(
      `UPDATE reservations SET status = 'cancelled' WHERE id = ? AND status <> 'cancelled'`,
      [id]
    );
    if (upd.rowCount === 0) {
      return res.status(404).json({ error: 'Rezervarea nu a fost găsită sau era deja anulată' });
    }

    // 3) audit
    await logEvent(Number(id), 'cancel', Number(req.user?.id) || null, {
      by: 'ui_delete_passenger',
      route: 'DELETE /api/reservations/:id'
    });


    return res.json({ success: true });
  } catch (err) {
    console.error('Eroare la DELETE (soft) /reservations/:id', err);
    return res.status(500).json({ error: 'Eroare internă la anulare' });
  }
});


/* ----------------------------- MOVE TO OTHER TRIP ----------------------------- */

router.post('/moveToOtherTrip', async (req, res) => {
  console.log('[moveToOtherTrip] payload primit:', req.body);

  const {
    old_reservation_id,
    new_trip_id,
    new_seat_id,
    board_station_id,
    exit_station_id,
    phone,
    name,
    booking_channel = 'online',
    observations, // opțional
  } = req.body;

  const parsedBoardId = parseStationId(board_station_id);
  const parsedExitId = parseStationId(exit_station_id);

  if (!old_reservation_id || !new_trip_id || !new_seat_id || parsedBoardId === null || parsedExitId === null) {
    return res.status(400).json({ error: 'Missing required data' });
  }

  try {
    const cid = randomUUID();
    // info trip nou + stații
    const tripInfoRes = await db.query(
      `SELECT t.route_id, rs.direction
         FROM trips t
         JOIN route_schedules rs ON rs.id = t.route_schedule_id
        WHERE t.id = ?`,
      [new_trip_id]
    );
    if (!tripInfoRes.rowCount) {
      return res.status(400).json({ error: 'Cursa selectată nu există' });
    }

    const stopsInfo = await getStops(
      tripInfoRes.rows[0].route_id,
      tripInfoRes.rows[0].direction
    );
    if (!stopsInfo.ordered.length) {
      return res.status(400).json({ error: 'Ruta nu are stații definite' });
    }

    const boardStationId = ensureStationId(stopsInfo, parsedBoardId);
    const exitStationId = ensureStationId(stopsInfo, parsedExitId);
    if (boardStationId === null || exitStationId === null) {
      return res.status(400).json({ error: 'Stații invalide pentru mutare' });
    }

    const newBoardIndex = getStationIndex(stopsInfo, boardStationId);
    const newExitIndex = getStationIndex(stopsInfo, exitStationId);
    if (newBoardIndex === -1 || newExitIndex === -1 || newBoardIndex >= newExitIndex) {
      return res.status(400).json({ error: 'Segment invalid pentru mutare' });
    }

    // 1. backup rezervare veche
    await db.query(
      `
      INSERT INTO reservations_backup (reservation_id, trip_id, seat_id, label, person_id)
      SELECT id, trip_id, seat_id, '', person_id FROM reservations WHERE id = ?
      `,
      [old_reservation_id]
    );

    // 2. anulare rezervare veche
    const updateRes = await db.query(
      `UPDATE reservations SET status = 'cancelled' WHERE id = ?`,
      [old_reservation_id]
    );
    if (updateRes.rowCount === 0) {
      return res.status(404).json({ error: 'Rezervarea veche nu a fost găsită' });
    }
    await logEvent(old_reservation_id, 'cancel', Number(req.user?.id) || null, {
      reason: 'moveToOtherTrip',
      correlation_id: cid
    });


    // 3. persoana
    let person_id;
    if (phone) {
      const personRes = await db.query(`SELECT id FROM people WHERE phone = ?`, [phone]);
      if (personRes.rows.length) {
        person_id = personRes.rows[0].id;
      } else {
        const ins = await db.query(`INSERT INTO people (name, phone) VALUES (?, ?)`, [name || '', phone]);
        person_id = ins.insertId;
      }
    } else {
      const oldRes = await db.query(`SELECT person_id FROM reservations WHERE id = ?`, [old_reservation_id]);
      person_id = oldRes.rows[0]?.person_id;
    }

    // 4. verifică coliziune pe noul loc/segment
    const overlapRes = await db.query(
      `
      SELECT board_station_id, exit_station_id
      FROM reservations
      WHERE trip_id = ? AND seat_id = ? AND status = 'active'
      `,
      [new_trip_id, new_seat_id]
    );

    const hasOverlap = overlapRes.rows.some((r) => {
      const rBoard = getStationIndex(stopsInfo, r.board_station_id);
      const rExit = getStationIndex(stopsInfo, r.exit_station_id);
      return Math.max(newBoardIndex, rBoard) < Math.min(newExitIndex, rExit);
    });

    if (hasOverlap) {
      return res.status(400).json({ error: 'Loc deja ocupat pe segmentul respectiv!' });
    }

    // 5. rezervare nouă
    const insRes = await db.query(
      `
      INSERT INTO reservations
        (trip_id, seat_id, person_id, board_station_id, exit_station_id, observations, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
      `,
      [new_trip_id, new_seat_id, person_id, boardStationId, exitStationId, observations || null, Number(req.user?.id) || null]
    );
    const newReservationId = insRes.insertId;
    await logEvent(newReservationId, 'create', Number(req.user?.id) || null, {
      source: 'moveToOtherTrip',
      from_reservation_id: old_reservation_id,
      correlation_id: cid
    });
    // 6. copiere pricing din vechea rezervare (booking_channel actualizat)
    const effChannel = deriveBookingChannel(req.user?.role, booking_channel);
    await db.query(
      `
      INSERT INTO reservation_pricing
        (reservation_id, price_value, price_list_id, pricing_category_id, booking_channel, employee_id)
      SELECT ?, price_value, price_list_id, pricing_category_id, ?, employee_id
      FROM reservation_pricing
      WHERE reservation_id = ?
      `,
      [newReservationId, effChannel, old_reservation_id]
    );


    // 6.bis) copiere reduceri (tip + promo) din rezervarea veche
    await db.query(
      `
      INSERT INTO reservation_discounts
        (reservation_id, discount_type_id, promo_code_id, discount_amount, discount_snapshot)
      SELECT
        ?, discount_type_id, promo_code_id, discount_amount, discount_snapshot
      FROM reservation_discounts
      WHERE reservation_id = ?
      `,
      [newReservationId, old_reservation_id]
    );


    // 6. log de sinteză "reservation.move" (from -> to)
    await logEvent(newReservationId, 'move', Number(req.user?.id) || null, {
      from_reservation_id: old_reservation_id,
      to_trip_id: new_trip_id,
      to_seat_id: new_seat_id,
      board_station_id: boardStationId,
      exit_station_id: exitStationId,
      channel: effChannel,
      correlation_id: cid
    });

    res.json({ success: true, new_reservation_id: newReservationId });

  } catch (err) {
    console.error('Eroare la mutare pe alt trip:', err);
    res.status(500).json({ error: 'Eroare la mutare pe altă cursă' });
  }
});

/* ----------------------------- CONFLICT CHECK ----------------------------- */
/**
 * GET /api/reservations/conflict?person_id=..&date=YYYY-MM-DD&time=HH:MM&board_station_id=..&exit_station_id=..
 */
router.get('/conflict', async (req, res) => {
  const { person_id: qPersonId, date, time } = req.query;
  const boardStationId = parseStationId(req.query.board_station_id);
  const exitStationId = parseStationId(req.query.exit_station_id);

  if (!date || !time || boardStationId === null || exitStationId === null) {
    return res.status(400).json({ error: 'Lipsește date/stații/time' });
  }

  try {
    const pid = Number(qPersonId);
    if (!Number.isInteger(pid) || pid <= 0) {
      return res.status(400).json({ error: 'person_id lipsă sau invalid' });
    }
    const person_id = pid;

    const sql = `
      SELECT
        r.id               AS reservation_id,
        ro.id              AS route_id,
        ro.name            AS route_name,
        t.time             AS time,
        s.label            AS seat_label,
        r.board_station_id AS board_station_id,
        r.exit_station_id  AS exit_station_id,
        rs.direction       AS trip_direction
      FROM reservations r
      JOIN trips   t  ON t.id  = r.trip_id
      JOIN route_schedules rs ON rs.id = t.route_schedule_id
      JOIN routes  ro ON ro.id = t.route_id
      JOIN seats   s  ON s.id  = r.seat_id
      WHERE r.person_id = ?
        AND t.date      = ?
        AND r.status    = 'active'
        AND TIME_FORMAT(t.time, '%H:%i') <> ?
    `;

    const result = await db.query(sql, [person_id, date, time]);

    const conflictInfos = [];
    for (const r of result.rows) {
      const stopsInfo = await getStops(r.route_id, r.trip_direction);
      const iOldBoard = getStationIndex(stopsInfo, r.board_station_id);
      const iOldExit = getStationIndex(stopsInfo, r.exit_station_id);
      const iNewBoard = getStationIndex(stopsInfo, boardStationId);
      const iNewExit = getStationIndex(stopsInfo, exitStationId);

      if ([iOldBoard, iOldExit, iNewBoard, iNewExit].includes(-1)) continue;

      const overlap =
        iOldBoard < iOldExit &&
        iNewBoard < iNewExit &&
        Math.max(iOldBoard, iNewBoard) <= Math.min(iOldExit, iNewExit);

      if (overlap) conflictInfos.push(r);
    }

    res.json({
      conflict: conflictInfos.length > 0,
      infos: conflictInfos.map((r) => ({
        id: r.reservation_id,
        route: r.route_name,
        time: r.time,
        seatLabel: r.seat_label,
        board_station_id: r.board_station_id,
        exit_station_id: r.exit_station_id,
      })),
    });
  } catch (err) {
    console.error('Eroare la /reservations/conflict:', err);
    res.status(500).json({ error: 'server error' });
  }
});




// POST /api/reservations/move
router.post('/move', async (req, res) => {
  try {
    const {
      reservation_id,     // dacă muți o rezervare existentă
      from_seat_id,
      to_seat_id,
      trip_id,
      trip_vehicle_id,    // dacă îl știi; altfel îl obții din seats/trip_seats
      board_station_id,
      exit_station_id
    } = req.body;

    if (!reservation_id || !to_seat_id || !trip_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // exemplu simplu; adaptează la schema ta (poți folosi și tranzacție)
    const boardId = Number(board_station_id);
    const exitId = Number(exit_station_id);
    const boardValue = Number.isInteger(boardId) && boardId > 0 ? boardId : null;
    const exitValue = Number.isInteger(exitId) && exitId > 0 ? exitId : null;

    // 0) citește înainte valorile vechi (pt. audit)
    const beforeQ = await db.query(
      `SELECT trip_id, seat_id, board_station_id, exit_station_id
         FROM reservations
        WHERE id = ?
        LIMIT 1`,
      [reservation_id]
    );
    const before = beforeQ.rows?.[0] || null;



    await db.query(
      `UPDATE reservations
         SET seat_id = ?, trip_id = ?, board_station_id = ?, exit_station_id = ?
       WHERE id = ?`,
      [to_seat_id, trip_id, boardValue, exitValue, reservation_id]
    );

    if (boardValue && exitValue) {
      try {
        const { rows } = await db.query(
          `
            SELECT
              p.phone,
              t.route_id,
              rs.direction
            FROM reservations r
            LEFT JOIN people p ON p.id = r.person_id
            LEFT JOIN trips t ON t.id = r.trip_id
            LEFT JOIN route_schedules rs ON rs.id = t.route_schedule_id
            WHERE r.id = ?
            LIMIT 1
          `,
          [reservation_id],
        );

        if (rows.length) {
          const row = rows[0];
          const routeId = Number(row.route_id);
          const direction = row.direction ? normalizeDirection(row.direction) : null;
          if (Number.isInteger(routeId) && routeId > 0) {
            await touchTravelerDefault(row.phone, routeId, boardValue, exitValue, direction);
          }
        }
      } catch (err) {
        console.warn('[reservations/move] traveler default update failed', err);
      }
    }

    // 3) audit: reservation.move (same trip / same vehicle)
    try {
      await logEvent(reservation_id, 'move', Number(req.user?.id) || null, {
        // îl legăm de aceeași rezervare (from_reservation_id = self)
        from_reservation_id: reservation_id,
        // „to” = valorile noi
        to_trip_id: trip_id,
        to_seat_id: to_seat_id,
        board_station_id: boardValue,
        exit_station_id: exitValue,
        // notă cu valorile „from” (dacă au fost găsite)
        note: before
          ? `from_trip_id=${before.trip_id};from_seat_id=${before.seat_id};from_board=${before.board_station_id};from_exit=${before.exit_station_id}`
          : null,
      });
    } catch (e) {
      console.warn('[reservations/move] audit failed', e.message);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/reservations/move] error:', err);
    return res.status(500).json({ error: 'internal' });
  }
});

// ✅ Rută publică pentru site-ul clienților (fără autentificare)
// - primește doar rezervări noi (nu permite modificări/ștergeri)
router.post('/public_reservation', async (req, res) => {
  try {
    const { route_id, date, name, phone, board_at, exit_at } = req.body;
    if (!route_id || !date || !name || !board_at || !exit_at) {
      return res.status(400).json({ error: 'Date incomplete pentru rezervare.' });
    }

    // TODO: verificare antiflood / blacklist etc. ulterior
    const result = await db.query(
      `INSERT INTO reservations (route_id, date, name, phone, board_at, exit_at, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'public') RETURNING id`,
      [route_id, date, name, phone || null, board_at, exit_at]
    );

    res.status(201).json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('Eroare la rezervare publică:', err);
    res.status(500).json({ error: 'Eroare la salvarea rezervării.' });
  }
});

// GET /api/reservations/:id/details
router.get('/:id/details', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'id invalid' });

    // 1) rez + trip + route + stații + loc
    const { rows: info } = await db.query(
      `
      SELECT
        r.id                 AS reservation_id,
        r.status,
        r.observations,
        r.reservation_time,
        r.created_by,

        t.id                 AS trip_id,
        DATE_FORMAT(t.date, '%d.%m.%Y') AS trip_date,
        DATE_FORMAT(t.time, '%H:%i')    AS trip_time,

        ro.id                AS route_id,
        ro.name              AS route_name,

        s.id                 AS seat_id,
        s.label              AS seat_label,

        sb.id                AS board_station_id,
        sb.name              AS board_name,
        se.id                AS exit_station_id,
        se.name              AS exit_name
      FROM reservations r
      JOIN trips   t  ON t.id  = r.trip_id
      JOIN routes  ro ON ro.id = t.route_id
      JOIN seats   s  ON s.id  = r.seat_id
      LEFT JOIN stations sb ON sb.id = r.board_station_id
      LEFT JOIN stations se ON se.id = r.exit_station_id
      WHERE r.id = ?
      `,
      [id]
    );

    if (info.length === 0) return res.status(404).json({ error: 'Rezervare inexistentă' });

    // 2) pricing curent (dacă există)
    const { rows: pricing } = await db.query(
      `
      SELECT
        rp.price_value,
        rp.price_list_id,
        rp.pricing_category_id,
        rp.booking_channel,
        rp.employee_id,
        DATE_FORMAT(rp.created_at, '%d.%m.%Y %H:%i') AS created_at
      FROM reservation_pricing rp
      WHERE rp.reservation_id = ?
      ORDER BY rp.created_at DESC
      LIMIT 1
      `,
      [id]
    );

    // 3) plăți
    const { rows: payments } = await db.query(
      `
      SELECT
        id, amount, status, payment_method, transaction_id,
        DATE_FORMAT(timestamp, '%d.%m.%Y %H:%i') AS ts,
        collected_by
      FROM payments
      WHERE reservation_id = ?
      ORDER BY id DESC
      `,
      [id]
    );

    // 4) timeline (evenimente) din audit_logs
    const evRes = await db.query(
      `
      SELECT
        id                        AS event_id,
        DATE_FORMAT(created_at, '%d.%m.%Y %H:%i') AS at,
        action,
        actor_id,
        entity,
        entity_id,
        related_id,
        channel,
        amount,
        payment_method,
        transaction_id
      FROM audit_logs
      WHERE
        (entity = 'reservation' AND entity_id = ?)
        OR
        (entity = 'payment'     AND related_id = ?)
      ORDER BY created_at ASC, id ASC
      `,
      [id, id]
    );

    res.json({
      reservation: info[0],
      pricing: pricing[0] || null,
      payments,
      events: (evRes.rows || evRes) || []
    });
  } catch (err) {
    console.error('[GET /reservations/:id/details]', err);
    res.status(500).json({ error: 'Eroare la detalii rezervare' });
  }
});



module.exports = router;
