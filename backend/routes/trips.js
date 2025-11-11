// routes/trips_mariadb.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // așteptat să fie mysql2/promise pool


const { requireAuth, requireRole } = require('../middleware/auth');

// ✅ Acces: admin, operator_admin, agent
router.use(requireAuth, requireRole('admin', 'operator_admin', 'agent'));

// ✅ Pentru operator_admin: impunem operator_id-ul propriu în query/body
router.use((req, _res, next) => {
  if (req.user?.role === 'operator_admin') {
    const opId = String(req.user.operator_id || '');
    // Forțăm operator_id în query (listări/filtrări)
    if (req.query && typeof req.query === 'object') {
      req.query.operator_id = opId;
    }
    // Forțăm operator_id în body (create/update)
    if (req.body && typeof req.body === 'object') {
      req.body.operator_id = Number(opId);
    }
  }
  next();
});


console.log('[ROUTER LOADED] routes/trips.js');

// GET /api/trips/:trip_id/vehicles — returnează mereu [] sau listă; niciodată 400
router.get('/:trip_id/vehicles', async (req, res) => {
  const tripId = Number(req.params.trip_id);
  if (!Number.isFinite(tripId) || tripId <= 0) {
    return res.json([]); // nu dăm 400
  }

  try {
    const { rows } = await db.query(
      `SELECT
         tv.id AS trip_vehicle_id,
         tv.trip_id,
         tv.vehicle_id,
         tv.is_primary,
         v.name,
         v.plate_number,
         NULL AS seat_map_id            -- <— NU există în DB, dăm null
       FROM trip_vehicles tv
       JOIN vehicles v ON v.id = tv.vehicle_id
       WHERE tv.trip_id = ?
       ORDER BY tv.is_primary DESC, tv.id`,
      [tripId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('[GET /api/trips/:trip_id/vehicles] error:', err);
    return res.status(500).json({ error: 'internal' });
  }
});






// ================================================================
// GET /api/trips?date=YYYY-MM-DD
// ================================================================
router.get('/', async (req, res) => {
  const { date } = req.query;
  try {
    let where = '';
    const params = [];
    if (date) {
      where = 'WHERE t.date = ?';
      params.push(date);
    }

    const query = `
      SELECT
        t.id            AS trip_id,
        t.date,
        t.time,
        t.boarding_started,
        t.route_id,
        t.vehicle_id,
        rs.operator_id  AS trip_operator_id,
        r.name          AS route_name,
        v.name          AS vehicle_name,
        v.plate_number,
        v.operator_id   AS vehicle_operator_id,
        rs.direction    AS direction
      FROM trips t
      JOIN routes r ON t.route_id = r.id
      JOIN route_schedules rs ON rs.id = t.route_schedule_id
      JOIN vehicles v ON t.vehicle_id = v.id
      ${where}
      ORDER BY t.time ASC
    `;
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Eroare la GET /api/trips:', err);
    res.status(500).json({ error: 'Eroare internă trips' });
  }
});

// ================================================================
// GET /api/trips/summary
// ================================================================
router.get('/summary', async (_req, res) => {
  try {
    const query = `
      SELECT
        t.id AS trip_id,
        t.date,
        t.time,
        t.boarding_started,
        r.name AS route_name,
        v.plate_number
      FROM trips t
      JOIN routes r ON t.route_id = r.id
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      ORDER BY t.date DESC, t.time ASC
    `;
    const { rows } = await db.query(query);
    res.json(rows);
  } catch (err) {
    console.error('Eroare la /summary:', err);
    res.status(500).json({ error: 'Eroare la încărcarea tripurilor' });
  }
});

// ================================================================
// GET /api/trips/find
// Găsește sau creează automat o cursă (trip)
// ================================================================
router.get('/find', async (req, res) => {
  let { schedule_id, route_id, date, time } = req.query;
  console.log('[GET /api/trips/find] IN:', { schedule_id, route_id, date, time });
  const time5 = typeof time === 'string' ? time.slice(0, 5) : time;
  try {
    let operator_id;

    // dacă nu e furnizat schedule_id, îl determinăm din route_id + time
    if (!schedule_id) {
      console.log('[trips/find] looking up schedule by route_id+time');
      const { rows: schedRes } = await db.query(
        `SELECT id, operator_id, departure
           FROM route_schedules
          WHERE route_id = ?
            AND TIME(departure) = TIME(?)
          LIMIT 1`,
        [route_id, time5]
      );
      if (!schedRes.length) {
        console.log('[trips/find] NO schedule for', { route_id, time });
        return res.status(404).json({ error: 'Programare inexistentă' });
      }
      schedule_id = schedRes[0].id;
      time = schedRes[0].departure;
      operator_id = schedRes[0].operator_id;
      route_id = Number(route_id);
      console.log('[trips/find] schedule found:', { schedule_id, operator_id, time });
    } else {
      const { rows: schedRes } = await db.query(
        `SELECT operator_id, departure
           FROM route_schedules
          WHERE id = ?
          LIMIT 1`,
        [schedule_id]
      );
      if (!schedRes.length) {
        console.log('[trips/find] schedule_id not found:', schedule_id);
        return res.status(404).json({ error: 'Programare inexistentă' });
      }
      operator_id = schedRes[0].operator_id;
      time = schedRes[0].departure;
      console.log('[trips/find] schedule by id:', { schedule_id, operator_id, time });
    }

    // verifică dacă există deja cursa
    const { rows: findRes } = await db.query(
      `SELECT id, route_id, vehicle_id, date, TIME_FORMAT(time, '%H:%i') AS time, disabled
         FROM trips
        WHERE route_schedule_id = ?
          AND date = DATE(?)
          AND TIME(time) = TIME(?)
          AND disabled = 0
        LIMIT 1`,
      [schedule_id, date, time5]
    );
    console.log('[trips/find] existing trip count =', findRes.length, 'for', { schedule_id, date });
    if (findRes.length) {
      console.log('[trips/find] return existing trip id=', findRes[0]?.id);
      return res.json(findRes[0]);
    }

    // vehicul implicit
    const { rows: veh} = await db.query(
      `SELECT id FROM vehicles WHERE operator_id = ? LIMIT 1`,
      [operator_id]
    );
    if (!veh.length) {
      console.log('[trips/find] NO default vehicle for operator', operator_id);
      return res.status(404).json({ error: 'Vehicul default inexistent' });
    }
    const defaultVehicleId = veh[0].id;
console.log('[trips/find] default vehicle:', defaultVehicleId);
    // inserăm noul trip
    const ins = await db.query(
      `INSERT INTO trips
         (route_schedule_id, route_id, vehicle_id, date, time)
       VALUES (?, ?, ?, ?, TIME(?))`,
      [schedule_id, route_id, defaultVehicleId, date, time5]
    );
    const insertId = ins.insertId;
console.log('[trips/find] inserted trip id=', insertId);

    // citim trip-ul inserat după ID (safe în concurență)
    const { rows: tripRows} = await db.query(
      `SELECT id, route_id, vehicle_id, date, TIME_FORMAT(time, '%H:%i') AS time, disabled, boarding_started
         FROM trips
        WHERE id = ?`,
      [insertId]
    );
    const trip = tripRows[0];

    // populăm trip_vehicles
    await db.query(
      `INSERT INTO trip_vehicles (trip_id, vehicle_id, is_primary)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE is_primary = VALUES(is_primary)`,
      [trip.id, defaultVehicleId]
    );
console.log('[trips/find] ensured trip_vehicles pair:', { trip_id: trip.id, vehicle_id: defaultVehicleId });
    res.json(trip);
  } catch (err) {
    console.error('Eroare la găsire/creare trip:', err);
    res.status(500).json({ error: 'Eroare internă' });
  }
});

// ================================================================
// PATCH /api/trips/:id/vehicle
// Migrare rezervări pe același label în vehiculul nou
// ================================================================
router.patch('/:id/vehicle', async (req, res) => {
  const tripId = req.params.id;
  const { newVehicleId } = req.body;

  try {
    // 1. Preia vechiul vehicle_id din trips
    const { rows: tripRows } = await db.query(
      'SELECT vehicle_id FROM trips WHERE id = ?',
      [tripId]
    );
    if (!tripRows.length) {
      return res.status(404).json({ error: 'Cursa nu există.' });
    }
    const oldVehicleId = tripRows[0].vehicle_id;

    // 2. Ia rezervările active pe cursa asta și vehiculul vechi
    const { rows: reservations } = await db.query(
      `SELECT r.id, s.label
         FROM reservations r
         JOIN seats s ON r.seat_id = s.id
        WHERE r.trip_id    = ?
          AND s.vehicle_id = ?
          AND r.status     = 'active'`,
      [tripId, oldVehicleId]
    );

    // 3. Verifică dacă toate label-urile există pe vehiculul nou
    const missing = [];
    for (let { label } of reservations) {
      const { rows: seatRows } = await db.query(
        'SELECT 1 FROM seats WHERE vehicle_id = ? AND label = ? LIMIT 1',
        [newVehicleId, label]
      );
      if (!seatRows.length) missing.push(label);
    }
    if (missing.length) {
      return res.status(400).json({
        error: `Vehiculul nou nu are locurile: ${missing.join(', ')}.`
      });
    }

    // 4. Tranzacție: migrează rezervările + update trips + trip_vehicles
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      for (let { id, label } of reservations) {
        // mysql2/promise -> conn.query() returnează [rows, fields], nu { rows }
        const [seat] = await conn.query(
          'SELECT id FROM seats WHERE vehicle_id = ? AND label = ? LIMIT 1',
          [newVehicleId, label]
        );
        // plasă de siguranță (în mod normal e acoperit de verificarea "missing")
        if (!seat || !seat.length) {
          throw new Error(`Seat with label ${label} not found on vehicle ${newVehicleId}`);
        }
        await conn.query(
          'UPDATE reservations SET seat_id = ? WHERE id = ?',
          [seat[0].id, id]
        );
      }

      await conn.query(
        'UPDATE trips SET vehicle_id = ? WHERE id = ?',
        [newVehicleId, tripId]
      );

      await conn.query(
        `UPDATE trip_vehicles
            SET vehicle_id = ?
          WHERE trip_id    = ?
            AND is_primary = 1`,
        [newVehicleId, tripId]
      );

      await conn.commit();
      conn.release();
      return res.json({ success: true });
    } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('[PATCH /api/trips/:id/vehicle] TX error:', err);
    const status = err?.code === 'ER_DUP_ENTRY' ? 409 : 500;
    return res.status(status).json({
      error: 'Eroare la migrarea rezervărilor.',
      code: err?.code || null,
      sqlState: err?.sqlState || null,
      sqlMessage: err?.sqlMessage || err?.message || null,
      sql: err?.sql || null
    });
    }
  } catch (err) {
  console.error('[PATCH /api/trips/:id/vehicle] error:', err);
  const status = err?.code === 'ER_DUP_ENTRY' ? 409 : 500;
  res.status(status).json({
    error: 'Eroare internă',
    code: err?.code || null,
    sqlState: err?.sqlState || null,
    sqlMessage: err?.sqlMessage || err?.message || null,
    sql: err?.sql || null
  });
  }
});

// ================================================================
// POST /api/trips/autogenerate?date=YYYY-MM-DD (opțional)
// Generează/actualizează trips + trip_vehicles pentru 7 zile
// ================================================================
router.post('/autogenerate', async (req, res) => {
  const { date } = req.query;
  const startDate = date ? new Date(date) : new Date();

  try {
    let insertedTrips = 0;
    let insertedTV    = 0;

    for (let d = 0; d < 7; d++) {
      const curr = new Date(startDate);
      curr.setDate(startDate.getDate() + d);
      const dateStr = curr.toISOString().slice(0, 10);

      // 1️⃣ toate programele + flag should_disable
      const { rows: schedules } = await db.query(
        `SELECT
           rs.id          AS schedule_id,
           rs.route_id,
           rs.departure,
           rs.operator_id,
           EXISTS(
             SELECT 1
               FROM schedule_exceptions se
              WHERE se.schedule_id = rs.id
                AND se.disable_run = 1
                AND (
                     se.exception_date IS NULL
                  OR se.exception_date = ?
                  OR se.weekday        = DAYOFWEEK(?)-1
                )
           ) AS should_disable
         FROM route_schedules rs`,
        [dateStr, dateStr]
      );

      // 2️⃣ pentru fiecare program – creează / sincronizează trip + vehicul
      for (const s of schedules) {
        const { rows: veh } = await db.query(
          'SELECT id FROM vehicles WHERE operator_id = ? ORDER BY id ASC LIMIT 1',
          [s.operator_id]
        );
        if (!veh.length) continue;
        const defaultVehicleId = veh[0].id;

        // cheie „logică”: route_id + date + time + vehicle_id
        const disabled = s.should_disable ? 1 : 0;
        // NU crea al doilea trip la aceeași (schedule, date, time) — ignorăm vehicle_id
        const { rows: existsAny } = await db.query(
          `SELECT id FROM trips
             WHERE route_schedule_id = ?
               AND date = ?
               AND TIME(time) = TIME(?)
             LIMIT 1`,
          [s.schedule_id, dateStr, s.departure]
        );
        if (existsAny.length) {
          // există deja un trip la ora respectivă → skip INSERT
          continue;
        }
        // Două apeluri /autogenerate pot rula în paralel (manual sau prin CRON).
        // Dacă am face doar INSERT simplu, am păstra fereastra "SELECT → INSERT"
        // în care o altă instanță ar putea insersa același trip și am primi eroarea
        // "duplicate entry" doar uneori. "INSERT IGNORE" închide cursa: dacă o
        // altă instanță a inserat deja rândul, MySQL îl ignoră în liniște fără să
        // suprascrie vehiculul ales manual.
        const insRes = await db.query(
          `INSERT IGNORE INTO trips
             (route_schedule_id, route_id, vehicle_id, date, time, disabled)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [s.schedule_id, s.route_id, defaultVehicleId, dateStr, s.departure, disabled]
        );
        // affectedRows = 1 ⇒ INSERT efectuat, 0 ⇒ rând existent (ignorăm)
        const affected = insRes.raw?.affectedRows ?? 0;
        if (affected === 1) insertedTrips++;

        let tripId = insRes.raw?.insertId;
        if (!tripId) {
          const { rows: trip } = await db.query(
            `SELECT id FROM trips
               WHERE route_schedule_id = ?
                 AND date = ?
                 AND TIME(time) = TIME(?)
               LIMIT 1`,
            [s.schedule_id, dateStr, s.departure]
          );

          if (!trip.length) {
            console.warn(
              '[POST /api/trips/autogenerate] Trip not found after insert',
              {
                scheduleId: s.schedule_id,
                date: dateStr,
                time: s.departure
              }
            );
            continue;
          }

          tripId = trip[0].id;
        }
        // UPSERT atomic pentru trip_vehicles (cheie unică: trip_id + vehicle_id)
        const tvRes = await db.query(
          `INSERT INTO trip_vehicles (trip_id, vehicle_id, is_primary)
           VALUES (?, ?, 1)
           ON DUPLICATE KEY UPDATE is_primary = VALUES(is_primary)`,
          [tripId, defaultVehicleId]
        );
        const tvAffected = tvRes.raw?.affectedRows ?? 0;
        if (tvAffected === 1) insertedTV++; // 1 = insert, 2 = update
      }
    }

    res.json({
      status:   'ok',
      inserted: { trips: insertedTrips, trip_vehicles: insertedTV }
    });
  } catch (err) {
    console.error('POST /api/trips/autogenerate error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ================================================================
// POST /api/trips/exceptions/cleanup
// Setează disabled=1 pe trips afectate de excepții la o dată dată
// ================================================================
router.post('/exceptions/cleanup', async (req, res) => {
  const { schedule_id, exception_date } = req.body;
  try {
    // Se propagă disabled=1 pe trips corespunzătoare regulii datei
    // (echivalent cu varianta PG care făcea join și EXTRACT(DOW))
    const result = await db.query(
      `
      UPDATE trips t
         JOIN schedule_exceptions se
           ON se.schedule_id = t.route_schedule_id
        SET t.disabled = 1
       WHERE se.disable_run   = 1
         AND se.schedule_id   = ?
         AND (
              (se.exception_date IS NULL AND t.date >= CURDATE())
           OR (se.exception_date IS NOT NULL AND se.exception_date = ?)
           OR (se.weekday IS NOT NULL 
               AND t.date >= CURDATE() 
               AND (DAYOFWEEK(t.date)-1) = se.weekday)
         )
      `,
      [schedule_id, exception_date]
    );
    res.json({ status: 'ok', tripsUpdated: result.affectedRows ?? undefined });
  } catch (err) {
    console.error('Cleanup failed:', err);
    res.status(500).json({ error: 'cleanup failed' });
  }
});

// ================================================================
// POST /api/trips/exceptions/update
// Creează/actualizează regula și propagă disabled pe trips
// ================================================================
router.post('/exceptions/update', async (req, res) => {
  const {
    schedule_id,
    exception_date = null,   // NULL ⇒ permanent
    weekday = null,          // 0–6   ⇒ recurent pe zi (MariaDB: DOW = DAYOFWEEK()-1)
    disable_run,
    disable_online
  } = req.body;

  const createdBy = req.user?.id || 12;

  // 1️⃣ Validare
  if (!schedule_id) {
    return res.status(400).json({ error: 'schedule_id lipsă' });
  }
  if (typeof disable_run !== 'boolean' && typeof disable_online !== 'boolean') {
    return res.status(400).json({ error: 'Trebuie cel puţin un flag' });
  }

  try {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // 2️⃣ Manual upsert (MariaDB) cu NULL-safe equality <=>
      const [findRes] = await conn.query(
        `SELECT id, disable_run, disable_online
           FROM schedule_exceptions
          WHERE schedule_id   = ?
            AND exception_date <=> ?
            AND weekday        <=> ?`,
        [schedule_id, exception_date, weekday]
      );

      let ruleId;
      if (findRes.length) {
        // UPDATE
        const current = findRes[0];
        const disableRunVal =
          typeof disable_run === 'boolean'
            ? (disable_run ? 1 : 0)
            : current.disable_run ? 1 : 0;
        const disableOnlineVal =
          typeof disable_online === 'boolean'
            ? (disable_online ? 1 : 0)
            : current.disable_online ? 1 : 0;
        await conn.query(
          `UPDATE schedule_exceptions
              SET disable_run = ?, disable_online = ?
            WHERE id = ?`,
          [disableRunVal, disableOnlineVal, findRes[0].id]
        );
        ruleId = findRes[0].id;
      } else {
        // INSERT
        const disableRunVal = typeof disable_run === 'boolean' && disable_run ? 1 : 0;
        const disableOnlineVal = typeof disable_online === 'boolean' && disable_online ? 1 : 0;
        const [ins] = await conn.query(
          `INSERT INTO schedule_exceptions
             (schedule_id, exception_date, weekday,
              disable_run, disable_online, created_by_employee_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [schedule_id, exception_date, weekday,
           disableRunVal, disableOnlineVal, createdBy]
        );
        ruleId = ins.insertId;
      }

      // Citește valorile actualizate
      const [upFlagRes] = await conn.query(
        `SELECT disable_run, disable_online
           FROM schedule_exceptions
          WHERE id = ?`,
        [ruleId]
      );
      const dbRun = upFlagRes[0].disable_run ? 1 : 0;
      const dbOnline = upFlagRes[0].disable_online ? 1 : 0;

      // 4️⃣ Sincronizare trips.disabled
      let whereClause = 't.route_schedule_id = ?';
      const params = [schedule_id];

      if (exception_date) {
        whereClause += ' AND t.date = ?';
        params.push(exception_date);
      } else if (weekday !== null && weekday !== undefined) {
        whereClause += ' AND t.date >= CURDATE() AND (DAYOFWEEK(t.date)-1) = ?';
        params.push(weekday);
      } else {
        // permanent
        whereClause += ' AND t.date >= CURDATE()';
      }

      if (dbRun) {
        const futureWindowClause = `(
          t.date > CURDATE()
          OR (
            t.date = CURDATE()
            AND (t.time IS NULL OR t.time >= CURTIME())
          )
        )`;

        const [reservationCount] = await conn.query(
          `SELECT COUNT(*) AS cnt
             FROM trips t
             JOIN reservations r ON r.trip_id = t.id
            WHERE ${whereClause}
              AND r.status = 'active'
              AND ${futureWindowClause}`,
          params
        );

        const activeReservations = reservationCount?.[0]?.cnt ?? 0;
        if (activeReservations > 0) {
          await conn.rollback();
          return res.status(409).json({
            error: 'Există rezervări active pentru cursele vizate. Anulează sau mută pasagerii înainte de a dezactiva cursa.',
          });
        }
      }

      const [upd] = await conn.query(
        `UPDATE trips t
            SET t.disabled = ?
          WHERE ${whereClause}`,
        [dbRun ? 1 : 0, ...params]
      );

      await conn.commit();

      res.json({
        status: 'ok',
        disable_run: !!dbRun,
        disable_online: !!dbOnline,
        tripsUpdated: upd.affectedRows
      });
    } catch (err) {
      await conn.rollback();
      console.error('Update exception failed:', err);
      res.status(500).json({ error: 'Internal server error' });
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('Cannot get connection:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ================================================================
// GET  /api/admin/trips/exceptions
// Listează TOATE regulile active (de azi încolo sau permanente)
// (compatibil cu AdminScheduleExceptions.jsx)
// ================================================================
router.get('/admin/trips/exceptions', async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        se.id,
        rs.id                                        AS schedule_id,
        r.name                                       AS route_name,
        COALESCE(NULLIF(TRIM(rs.direction), ''), 'tur') AS direction,
        DATE_FORMAT(rs.departure, '%H:%i')           AS departure,
        CASE
          WHEN se.exception_date IS NULL AND se.weekday IS NULL THEN 'permanent'
          WHEN se.exception_date IS NOT NULL                      THEN 'date'
          ELSE 'weekday'
        END                                          AS rule_type,
        DATE_FORMAT(se.exception_date, '%Y-%m-%d')   AS exception_date,
        se.weekday,
        se.disable_run,
        se.disable_online,
        (
          SELECT COUNT(*)
            FROM trips t
           WHERE t.route_schedule_id = rs.id
             AND (
                  (se.exception_date IS NULL AND se.weekday IS NULL AND t.date >= CURDATE())
               OR (se.exception_date IS NULL AND se.weekday IS NOT NULL
                   AND t.date >= CURDATE()
                   AND (DAYOFWEEK(t.date)-1) = se.weekday)
               OR (se.exception_date IS NOT NULL AND t.date = se.exception_date)
                 )
             AND t.disabled = 1
        )                                            AS trips_affected
      FROM schedule_exceptions se
      JOIN route_schedules  rs ON rs.id = se.schedule_id
      JOIN routes           r  ON r.id  = rs.route_id
      WHERE
            (se.exception_date IS NULL OR se.exception_date >= CURDATE())
        AND (se.disable_run = 1 OR se.disable_online = 1)
      ORDER BY route_name, direction, departure
    `);

    res.json(rows);
  } catch (err) {
    console.error('Fetch disabled schedules failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});



// ─────────────────────────────────────────────────────────────
// GET /api/trips/admin/disabled-schedules (compat PG)
// ─────────────────────────────────────────────────────────────
router.get('/admin/disabled-schedules', async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        se.id,
        rs.id                                        AS schedule_id,
        r.name                                       AS route_name,
        COALESCE(NULLIF(TRIM(rs.direction), ''), 'tur') AS direction,
        DATE_FORMAT(rs.departure, '%H:%i')           AS hour,
        CASE
          WHEN se.exception_date IS NULL AND se.weekday IS NULL THEN 'permanent'
          WHEN se.exception_date IS NOT NULL                      THEN 'date'
          ELSE 'weekday'
        END                                          AS rule_type,
        DATE_FORMAT(se.exception_date, '%Y-%m-%d')   AS exception_date,
        se.weekday,
        se.disable_run,
        se.disable_online,
        (
          SELECT COUNT(*)
            FROM trips t
           WHERE t.route_schedule_id = rs.id
             AND (
                  (se.exception_date IS NULL AND se.weekday IS NULL AND t.date >= CURDATE())
               OR (se.exception_date IS NULL AND se.weekday IS NOT NULL
                   AND t.date >= CURDATE()
                   AND (DAYOFWEEK(t.date)-1) = se.weekday)
               OR (se.exception_date IS NOT NULL AND t.date = se.exception_date)
                 )
             AND t.disabled = 1
        )                                            AS trips_affected
      FROM schedule_exceptions se
      JOIN route_schedules  rs ON rs.id = se.schedule_id
      JOIN routes           r  ON r.id  = rs.route_id
      WHERE
            (se.exception_date IS NULL OR se.exception_date >= CURDATE())
        AND (se.disable_run = 1 OR se.disable_online = 1)
      ORDER BY route_name, direction, hour
    `);
    res.json(rows);
  } catch (err) {
    console.error('Fetch disabled schedules (compat) failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});










// ================================================================
// DELETE /api/admin/trips/exceptions
// Body: { id }
// Șterge regula și re-activează cursele afectate (disabled=0)
// (compatibil cu AdminScheduleExceptions.jsx)
// ================================================================
router.delete('/admin/trips/exceptions', async (req, res) => {
  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ error: 'id lipsă' });
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1️⃣ Citește regula
    const [ruleRes] = await conn.query(
      `SELECT schedule_id, exception_date, weekday
         FROM schedule_exceptions
        WHERE id = ?`,
      [id]
    );
    if (!ruleRes.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Regula nu exista' });
    }
    const { schedule_id, exception_date, weekday } = ruleRes[0];

    // 2️⃣ Șterge regula
    await conn.query(
      `DELETE FROM schedule_exceptions WHERE id = ?`,
      [id]
    );

    // 3️⃣ Reactivare trips.disabled = 0 pe intervalul acela
    let whereClause = 't.route_schedule_id = ?';
    const params = [schedule_id];

    if (exception_date) {
      whereClause += ' AND t.date = ?';
      params.push(exception_date);
    } else if (weekday !== null && weekday !== undefined) {
      whereClause += ' AND t.date >= CURDATE() AND (DAYOFWEEK(t.date)-1) = ?';
      params.push(weekday);
    } else {
      whereClause += ' AND t.date >= CURDATE()';
    }

    const [upd] = await conn.query(
      `UPDATE trips t
          SET t.disabled = 0
        WHERE ${whereClause}`,
      params
    );

    await conn.commit();

    res.json({
      status: 'ok',
      tripsUpdated: upd.affectedRows
    });
  } catch (err) {
    await conn.rollback();
    console.error('Delete disabled schedule failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});


// ─────────────────────────────────────────────────────────────
// DELETE /api/trips/admin/disabled-schedules/:id (compat PG)
// ─────────────────────────────────────────────────────────────
router.delete('/admin/disabled-schedules/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'id lipsă' });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1) citește regula
    const [rule] = await conn.query(
      `SELECT schedule_id, exception_date, weekday
         FROM schedule_exceptions
        WHERE id = ?
        LIMIT 1`,
      [id]
    );
    if (!rule.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Regula nu exista' });
    }
    const { schedule_id, exception_date, weekday } = rule[0];

    // 2) șterge regula
    await conn.query(`DELETE FROM schedule_exceptions WHERE id = ?`, [id]);

    // 3) re-activează trips.disabled = 0 pe interval
    let whereClause = 't.route_schedule_id = ?';
    const params = [schedule_id];
    if (exception_date) {
      whereClause += ' AND t.date = ?';
      params.push(exception_date);
    } else if (weekday !== null && weekday !== undefined) {
      whereClause += ' AND t.date >= CURDATE() AND (DAYOFWEEK(t.date)-1) = ?';
      params.push(weekday);
    } else {
      whereClause += ' AND t.date >= CURDATE()';
    }
    await conn.query(
      `UPDATE trips t SET t.disabled = 0 WHERE ${whereClause}`,
      params
    );

    await conn.commit();
    res.json({ status: 'ok' });
  } catch (err) {
    await conn.rollback();
    console.error('Delete disabled schedule (compat) failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});







// POST /api/trips/:trip_id/vehicles — atașează un vehicul (inclusiv dublură) la o cursă
router.post('/:trip_id/vehicles', async (req, res) => {
  const tripId = Number(req.params.trip_id);
  const { vehicle_id, is_primary = false } = req.body || {};

  if (!Number.isFinite(tripId) || tripId <= 0) {
    return res.status(400).json({ error: 'trip_id invalid' });
  }
  if (!Number.isFinite(Number(vehicle_id))) {
    return res.status(400).json({ error: 'vehicle_id invalid' });
  }

  try {
    // 1) verifică existența trip-ului
    const { rows: tripRows } = await db.query(
      'SELECT id FROM trips WHERE id = ? LIMIT 1',
      [tripId]
    );
    if (!tripRows.length) {
      return res.status(404).json({ error: 'Cursa nu există' });
    }

    // 2) verifică existența vehiculului
    const { rows: vehRows } = await db.query(
      'SELECT id, name, plate_number FROM vehicles WHERE id = ? LIMIT 1',
      [vehicle_id]
    );
    if (!vehRows.length) {
      return res.status(404).json({ error: 'Vehiculul nu există' });
    }

    // 3) nu dubla aceeași combinație (trip_id, vehicle_id)
    const { rows: dupRows } = await db.query(
      'SELECT id FROM trip_vehicles WHERE trip_id = ? AND vehicle_id = ? LIMIT 1',
      [tripId, vehicle_id]
    );
    if (dupRows.length) {
      // există deja -> poți ori returna 200 cu rândul existent, ori 409
      return res.status(200).json({
        id: dupRows[0].id,
        trip_id: tripId,
        vehicle_id,
        is_primary: Boolean(is_primary)
      });
    }

    // 4) dacă vine ca primar, scoate primar de pe celelalte
    if (is_primary) {
      await db.query(
        'UPDATE trip_vehicles SET is_primary = 0 WHERE trip_id = ?',
        [tripId]
      );
    }

    // 5) inserează
    const { rows: insRows } = await db.query(
      `INSERT INTO trip_vehicles (trip_id, vehicle_id, is_primary)
       VALUES (?, ?, ?);`,
      [tripId, vehicle_id, is_primary ? 1 : 0]
    );

    // MySQL2 wrapper-ul tău întoarce { rows }, dar pentru INSERT de obicei ai insertId.
    // Dacă wrapper-ul NU pune insertId în rows, mai facem un SELECT pentru ultimul rând.
    const { rows: newRow } = await db.query(
      `SELECT
         tv.id,
         tv.trip_id,
         tv.vehicle_id,
         tv.is_primary,
         v.name,
         v.plate_number
       FROM trip_vehicles tv
       JOIN vehicles v ON v.id = tv.vehicle_id
       WHERE tv.trip_id = ? AND tv.vehicle_id = ?
       ORDER BY tv.id DESC
       LIMIT 1`,
      [tripId, vehicle_id]
    );

    return res.status(201).json(newRow[0] || {
      trip_id: tripId,
      vehicle_id,
      is_primary: Boolean(is_primary)
    });
  } catch (err) {
    console.error('[POST /api/trips/:trip_id/vehicles] error:', err);
    return res.status(500).json({ error: 'internal' });
  }
});




module.exports = router;
