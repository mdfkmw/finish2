// backend/routes/routes.js — MariaDB 10.6
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { normalizeDirection, isReturnDirection } = require('../utils/direction');

// ✅ Acces: admin, operator_admin, agent
router.use(requireAuth, requireRole('admin', 'operator_admin', 'agent'));

// ✅ Pentru operator_admin: impunem operator_id-ul propriu în query/body
router.use((req, _res, next) => {
  if (req.user?.role === 'operator_admin') {
    const opId = String(req.user.operator_id || '');
    if (req.query && typeof req.query === 'object') {
      req.query.operator_id = opId;
    }
    if (req.body && typeof req.body === 'object') {
      req.body.operator_id = Number(opId);
    }
  }
  next();
});

/*────────────────────────────── 1) LISTĂ RUTE ──────────────────────────────
  GET /api/routes?date=YYYY-MM-DD[&operator_id=ID]
  Notă: în PG foloseai JSON_AGG + FILTER. În MariaDB agregăm în JS pentru stabilitate. */
router.get('/', async (req, res) => {
  // normalizăm data la 'YYYY-MM-DD'
  const dateStr = (req.query.date && String(req.query.date).slice(0, 10)) || new Date().toISOString().slice(0, 10);
  const operatorId = req.query.operator_id ?? null;
  // folosim mereu LEFT JOIN, iar filtrarea după operator o punem în WHERE
  const joinSchedules = `LEFT JOIN route_schedules rs ON rs.route_id = r.id`;

  // optional: ?fe=1      -> doar rutele care apar în rezervări (visible_in_reservations = 1)
  //           ?driver=1  -> doar rutele care apar la șofer (visible_for_drivers = 1)
  const onlyFe = String(req.query.fe || '') === '1';
  const onlyDriver = String(req.query.driver || '') === '1';
  const onlyOnline = String(req.query.online || '') === '1';

  const where = [];
  if (onlyFe) where.push('r.visible_in_reservations = 1');
  if (onlyDriver) where.push('r.visible_for_drivers = 1');
  if (onlyOnline) where.push('r.visible_online = 1');

  const sql = `
  SELECT
    r.id    AS r_id,
    r.name  AS r_name,
    r.visible_in_reservations,
    r.visible_for_drivers,
    r.visible_online,
    rs.id   AS schedule_id,
    TIME_FORMAT(rs.departure, '%H:%i') AS departure,
    rs.operator_id,
    rs.direction AS schedule_direction,
    op.theme_color,

    /* disabled_run dacă există vreo regulă ce oprește cursa în ziua respectivă
       (permanentă, pe weekday sau pe data exactă) */
    EXISTS (
      SELECT 1
        FROM schedule_exceptions se
       WHERE se.schedule_id = rs.id
         AND se.disable_run = 1
         AND (
               se.exception_date IS NULL
            OR se.exception_date = DATE(?)
            OR se.weekday = DAYOFWEEK(DATE(?)) - 1
        )
    ) AS disabled_run,

    /* disabled_online după aceeași logică */
    EXISTS (
      SELECT 1
        FROM schedule_exceptions se
       WHERE se.schedule_id = rs.id
         AND se.disable_online = 1
         AND (
               se.exception_date IS NULL
            OR se.exception_date = DATE(?)
            OR se.weekday = DAYOFWEEK(DATE(?)) - 1
        )
    ) AS disabled_online,

    t.disabled AS trip_disabled
  FROM routes r
  ${joinSchedules}
  LEFT JOIN operators op ON op.id = rs.operator_id
  LEFT JOIN trips t ON t.route_schedule_id = rs.id AND t.date = DATE(?)
    ${operatorId ? `WHERE rs.operator_id = ?` : ``}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
  ORDER BY r.name, rs.departure
  `;
  try {
    // parametrii în ordinea apariției în SQL
    // 4x dateStr pentru EXISTS (disabled_*), 1x pentru LEFT JOIN trips, iar la final (opțional) operatorId în WHERE
    const execParams = operatorId
      ? [dateStr, dateStr, dateStr, dateStr, dateStr, operatorId]
      : [dateStr, dateStr, dateStr, dateStr, dateStr];
    const { rows } = await db.query(sql, execParams);

    const byRoute = new Map();
    for (const r of rows) {
      if (!byRoute.has(r.r_id)) {
        byRoute.set(r.r_id, {
          id: r.r_id,
          name: r.r_name,
          visible_in_reservations: !!r.visible_in_reservations,
          visible_for_drivers: !!r.visible_for_drivers,
          visible_online: !!r.visible_online,
          schedules: [],
        });
      }

      if (r.schedule_id) {
        const routeObj = byRoute.get(r.r_id);
        let sched = routeObj.schedules.find((s) => s.scheduleId === r.schedule_id);
        if (!sched) {
          sched = {
            scheduleId: r.schedule_id,
            departure: r.departure,
            operatorId: r.operator_id,
            direction: normalizeDirection(r.schedule_direction),
            themeColor: r.theme_color,
            disabledRun: !!r.disabled_run,
            disabledOnline: !!r.disabled_online,
            tripDisabled: !!r.trip_disabled,
          };
          routeObj.schedules.push(sched);
        } else {
          sched.disabledRun = sched.disabledRun || !!r.disabled_run;
          sched.disabledOnline = sched.disabledOnline || !!r.disabled_online;
          sched.tripDisabled = sched.tripDisabled || !!r.trip_disabled;
        }
      }
    }

    if (rows.length === 0) {
      if (operatorId) {
        return res.json([]);
      }
      const { rows: routesOnly } = await db.query(
        `SELECT id, name, visible_in_reservations, visible_for_drivers, visible_online FROM routes ORDER BY name`
      );
      return res.json(routesOnly.map((r) => ({
        id: r.id,
        name: r.name,
        visible_in_reservations: !!r.visible_in_reservations,
        visible_for_drivers: !!r.visible_for_drivers,
        visible_online: !!r.visible_online,
        schedules: [],
      })));
    }

    const out = Array.from(byRoute.values()).map((rt) => {
      rt.schedules.sort((a, b) => (a.departure || '').localeCompare(b.departure || ''));
      return rt;
    });

    res.json(out);
  } catch (err) {
    console.error('GET /api/routes', err);
    res.status(500).json({ error: 'Eroare internă' });
  }
});



/*────────────────────────  PATCH /api/routes/:id  ─────────────────────────
   Actualizează câmpuri individuale: visible_in_reservations, visible_for_drivers, etc.
   Exemplu payload: { visible_in_reservations: true }  */
router.patch('/:id', async (req, res) => {
  try {
    const routeId = Number(req.params.id);
    if (!routeId) return res.status(400).json({ error: 'invalid route id' });

    const allowed = ['visible_in_reservations', 'visible_for_drivers', 'visible_online'];
    const fields = [];
    const values = [];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(req.body[key] ? 1 : 0);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'no valid fields provided' });
    }

    const sql = `UPDATE routes SET ${fields.join(', ')} WHERE id = ?`;
    values.push(routeId);

    await db.query(sql, values);
    res.sendStatus(204);
  } catch (err) {
    console.error('PATCH /api/routes/:id', err);
    res.status(500).json({ error: 'Eroare internă la actualizare rută' });
  }
});


/*──────────────────────  /api/routes/:id/schedules  ────────────────────────
   GET   -> listează orele pentru ruta :id
   POST  -> adaugă o oră (body: { departure:'HH:MM', direction:'tur'|'retur' })
   DELETE /api/routes/:id/schedules/:scheduleId -> șterge o oră
*/
router.get('/:id/schedules', async (req, res) => {
  try {
    const routeId = Number(req.params.id);
    if (!routeId) return res.status(400).json({ error: 'invalid route id' });
    const { rows } = await db.query(
      `SELECT 
         rs.id,
         TIME_FORMAT(rs.departure, '%H:%i') AS departure,
         rs.direction,
         rs.operator_id,
         o.name AS operator_name
       FROM route_schedules rs
       LEFT JOIN operators o ON o.id = rs.operator_id
       WHERE rs.route_id = ?
       ORDER BY rs.departure`,
      [routeId]
    );
    res.json(rows.map(r => ({
      id: r.id,
      departure: r.departure,
      direction: r.direction,
      operator_id: r.operator_id,
      operator_name: r.operator_name || null
    })));
  } catch (err) {
    console.error('GET /api/routes/:id/schedules', err);
    res.status(500).json({ error: 'Eroare internă' });
  }
});

router.post('/:id/schedules', async (req, res) => {
  try {
    const routeId = Number(req.params.id);
    // acceptăm H:MM sau HH:MM și normalizăm la HH:MM
    const rawDep = String(req.body?.departure || '').trim();
    const m = rawDep.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!routeId || !m) {
      return res.status(400).json({ error: 'invalid params: departure (H:MM/HH:MM)' });
    }
    const departure = `${String(m[1]).padStart(2, '0')}:${m[2]}`;
    const direction = (req.body?.direction || 'tur').toLowerCase() === 'retur' ? 'retur' : 'tur';
    // operator_id: pentru operator_admin îl impunem deja în middleware
    const operatorId = req.body?.operator_id || null;
    const sql = `INSERT INTO route_schedules (route_id, departure, direction, operator_id)
                 VALUES (?, ?, ?, ?)`;
    await db.query(sql, [routeId, departure, direction, operatorId]);
    res.sendStatus(201);
  } catch (err) {
    console.error('POST /api/routes/:id/schedules', err);
    // Duplicat: aceeași (route_id, departure, direction, operator_id)
    if (err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062) {
      return res.status(409).json({
        error: 'Acea oră există deja pentru ruta, sensul și operatorul selectate.'
      });
    }
    res.status(500).json({ error: 'Eroare internă' });
  }
});

router.delete('/:id/schedules/:scheduleId', async (req, res) => {
  let conn;
  let txStarted = false;
  try {
    const routeId = Number(req.params.id);
    const scheduleId = Number(req.params.scheduleId);
    if (!routeId || !scheduleId) return res.status(400).json({ error: 'invalid params' });

    conn = await db.getConnection();

    const [scheduleRows] = await conn.execute(
      `SELECT id FROM route_schedules WHERE id = ? AND route_id = ? LIMIT 1`,
      [scheduleId, routeId]
    );
    if (!scheduleRows.length) {
      return res.status(404).json({ error: 'Programarea nu există pentru această rută.' });
    }

    const [reservationRows] = await conn.execute(
      `SELECT COUNT(*) AS cnt
         FROM reservations r
         JOIN trips t ON t.id = r.trip_id
        WHERE t.route_schedule_id = ?`,
      [scheduleId]
    );
    if (Number(reservationRows?.[0]?.cnt || 0) > 0) {
      return res.status(400).json({ error: 'Nu poți șterge ora deoarece există rezervări active.' });
    }

    await conn.beginTransaction();
    txStarted = true;

    await conn.execute(
      `DELETE tve FROM trip_vehicle_employees tve
        JOIN trip_vehicles tv ON tv.id = tve.trip_vehicle_id
        JOIN trips t ON t.id = tv.trip_id
       WHERE t.route_schedule_id = ?`,
      [scheduleId]
    );

    await conn.execute(
      `DELETE tv FROM trip_vehicles tv
        JOIN trips t ON t.id = tv.trip_id
       WHERE t.route_schedule_id = ?`,
      [scheduleId]
    );

    await conn.execute(`DELETE FROM trips WHERE route_schedule_id = ?`, [scheduleId]);
    await conn.execute(`DELETE FROM route_schedules WHERE id = ? AND route_id = ?`, [scheduleId, routeId]);

    await conn.commit();
    txStarted = false;
    res.sendStatus(204);
  } catch (err) {
    if (conn && txStarted) {
      try {
        await conn.rollback();
      } catch (_) {
        // ignore rollback errors
      }
    }
    console.error('DELETE /api/routes/:id/schedules/:scheduleId', err);
    res.status(500).json({ error: 'Eroare internă' });
  } finally {
    if (conn) conn.release();
  }
});




// PATCH /api/routes/:id/schedules/:scheduleId  — editează o oră
router.patch('/:id/schedules/:scheduleId', async (req, res) => {
  let conn;
  let txStarted = false;
  try {
    const routeId = Number(req.params.id);
    const scheduleId = Number(req.params.scheduleId);
    if (!routeId || !scheduleId) return res.status(400).json({ error: 'invalid params' });

    const fields = [];
    const values = [];
    let newDeparture = null;

    if (typeof req.body?.departure === 'string') {
      const rawDep = req.body.departure.trim();
      const m = rawDep.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
      if (!m) return res.status(400).json({ error: 'invalid departure (H:MM/HH:MM)' });
      const dep = `${String(m[1]).padStart(2, '0')}:${m[2]}`;
      fields.push('departure = ?');
      values.push(dep);
      newDeparture = dep;
    }
    if (typeof req.body?.direction === 'string') {
      const dir = req.body.direction.toLowerCase() === 'retur' ? 'retur' : 'tur';
      fields.push('direction = ?');
      values.push(dir);
    }
    if (req.body?.operator_id !== undefined) {
      const op = Number(req.body.operator_id) || null;
      fields.push('operator_id = ?');
      values.push(op);
    }

    if (!fields.length) return res.status(400).json({ error: 'no fields' });

    conn = await db.getConnection();

    const [scheduleRows] = await conn.execute(
      `SELECT id FROM route_schedules WHERE id = ? AND route_id = ? LIMIT 1`,
      [scheduleId, routeId]
    );
    if (!scheduleRows.length) {
      return res.status(404).json({ error: 'Programarea nu există pentru această rută.' });
    }

    await conn.beginTransaction();
    txStarted = true;

    const sql = `UPDATE route_schedules SET ${fields.join(', ')} WHERE id = ? AND route_id = ?`;
    values.push(scheduleId, routeId);
    await conn.execute(sql, values);

    if (newDeparture !== null) {
      await conn.execute(`UPDATE trips SET time = ? WHERE route_schedule_id = ?`, [newDeparture, scheduleId]);
    }

    await conn.commit();
    txStarted = false;
    res.sendStatus(204);
  } catch (err) {
    if (conn && txStarted) {
      try {
        await conn.rollback();
      } catch (_) {
        // ignore rollback errors
      }
    }
    if (err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062) {
      return res.status(409).json({
        error: 'Acea oră există deja pentru ruta, sensul și operatorul selectate.'
      });
    }
    console.error('PATCH /api/routes/:id/schedules/:scheduleId', err);
    res.status(500).json({ error: 'Eroare internă' });
  } finally {
    if (conn) conn.release();
  }
});

// POST /api/routes  — creează o rută nouă
router.post('/', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Numele rutei este obligatoriu' });

    // opțional: acceptăm și vizibilitățile; altfel merg pe default din DB
    const visFE = req.body?.visible_in_reservations;
    const visDrv = req.body?.visible_for_drivers;
    const visOnline = req.body?.visible_online;

    const fields = ['name'];
    const vals = [name];
    const marks = ['?'];
    if (visFE !== undefined) { fields.push('visible_in_reservations'); marks.push('?'); vals.push(visFE ? 1 : 0); }
    if (visDrv !== undefined) { fields.push('visible_for_drivers'); marks.push('?'); vals.push(visDrv ? 1 : 0); }
    if (visOnline !== undefined) { fields.push('visible_online'); marks.push('?'); vals.push(visOnline ? 1 : 0); }

    const sql = `INSERT INTO routes (${fields.join(',')}) VALUES (${marks.join(',')})`;
    const result = await db.query(sql, vals);
    const id = result?.insertId || result?.[0]?.insertId; // compat client

    // întoarcem obiectul creat (minim necesar)
    res.status(201).json({
      id,
      name,
      visible_in_reservations: visFE !== undefined ? !!visFE : true,
      visible_for_drivers: visDrv !== undefined ? !!visDrv : true,
      visible_online: visOnline !== undefined ? !!visOnline : true,
    });
  } catch (err) {
    console.error('POST /api/routes', err);
    res.status(500).json({ error: 'Eroare internă la crearea rutei' });
  }
});


// DELETE /api/routes/:id — șterge o rută
// DELETE /api/routes/:id — șterge o rută (permite trips/orare dacă NU există rezervări)
router.delete('/:id', async (req, res) => {
  const conn = await db.getConnection(); // dacă ai helper, folosește-l; altfel db.query('START TRANSACTION')
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalid' });

    // 1) Permitem ștergerea dacă NU există rezervări pe trips ale rutei
    const { rows: resvRows } = await db.query(
      `SELECT COUNT(*) AS cnt
         FROM reservations r
         JOIN trips t ON t.id = r.trip_id
        WHERE t.route_id = ?`,
      [id]
    );
    if (Number(resvRows[0]?.cnt || 0) > 0) {
      return res.status(400).json({ error: 'Ruta are rezervări și nu poate fi ștearsă.' });
    }

    // 2) Tranzacție: ștergem elegant tot ce ține de rută
    await db.query('START TRANSACTION');

    // 2a) Cleanup promo legate de orare & rută
    await db.query(
      `DELETE pcs FROM promo_code_schedules pcs
       JOIN route_schedules rs ON rs.id = pcs.route_schedule_id
      WHERE rs.route_id = ?`,
      [id]
    );
    await db.query(
      `DELETE rsd FROM route_schedule_discounts rsd
       JOIN route_schedules rs ON rs.id = rsd.route_schedule_id
      WHERE rs.route_id = ?`,
      [id]
    );
    await db.query(`DELETE FROM promo_code_routes WHERE route_id = ?`, [id]);

    // 2b) Excepții de program pentru orare
    await db.query(
      `DELETE se FROM schedule_exceptions se
       JOIN route_schedules rs ON rs.id = se.schedule_id
      WHERE rs.route_id = ?`,
      [id]
    );

    // 2c) Trip-urile rutei (nu mai au rezervări; ok de șters)
    //   - întâi legăturile cu vehicule/angajați
    await db.query(
      `DELETE tve FROM trip_vehicle_employees tve
       JOIN trip_vehicles tv ON tv.id = tve.trip_vehicle_id
       JOIN trips t ON t.id = tv.trip_id
      WHERE t.route_id = ?`,
      [id]
    );
    await db.query(
      `DELETE tv FROM trip_vehicles tv
       JOIN trips t ON t.id = tv.trip_id
      WHERE t.route_id = ?`,
      [id]
    );
    // trip_stations are FK ON DELETE CASCADE către trips, deci se șterg automat când ștergi trips. :contentReference[oaicite:1]{index=1}
    await db.query(`DELETE FROM trips WHERE route_id = ?`, [id]);

    // 2d) Orarele și stațiile rutei
    await db.query(`DELETE FROM route_schedules WHERE route_id = ?`, [id]);
    await db.query(`DELETE FROM route_stations  WHERE route_id = ?`, [id]);

    // 2e) Preferințe utilizator (ordonare rute) — opțional, dar util
    await db.query(`DELETE FROM user_route_order WHERE route_id = ?`, [id]);

    // 2f) În final, ruta
    await db.query(`DELETE FROM routes WHERE id = ?`, [id]);

    await db.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('DELETE /api/routes/:id', err);
    res.status(500).json({ error: 'Eroare internă la ștergerea rutei.' });
  }
});




/*──────────────────────── 2) STAȚIILE UNEI RUTE ────────────────────────────
  GET /api/routes/:id/stations
  Notă: în PG foloseai ST_AsGeoJSON(... )::json; aici returnăm geofence_polygon ca JSON/text. */
router.get('/:id/stations', async (req, res, next) => {
  try {
    const routeId = Number(req.params.id);
    const scheduleId = req.query.route_schedule_id ? Number(req.query.route_schedule_id) : null;
    const queryDirection = req.query.direction ? normalizeDirection(req.query.direction) : null;

    let effectiveDirection = queryDirection;
    if (scheduleId) {
      const { rows: schedRows } = await db.query(
        `SELECT direction FROM route_schedules WHERE id = ? AND route_id = ? LIMIT 1`,
        [scheduleId, routeId]
      );
      if (!schedRows.length) {
        return res.status(404).json({ error: 'Programare inexistentă pentru această rută' });
      }
      effectiveDirection = normalizeDirection(schedRows[0].direction);
    }
    const finalDirection = effectiveDirection || 'tur';

    const { rows } = await db.query(
      `SELECT
         rs.id,
         rs.sequence,
         s.id          AS station_id,
         s.name,
         s.latitude,
         s.longitude,
         rs.geofence_type,
         rs.geofence_radius_m,
         ST_AsText(rs.geofence_polygon) AS geofence_polygon,
         rs.distance_from_previous_km    AS distance_km,
         rs.travel_time_from_previous_minutes AS duration_min,
         rs.public_note_tur,
         rs.public_note_retur,
         rs.public_latitude_tur,
         rs.public_longitude_tur,
         rs.public_latitude_retur,
         rs.public_longitude_retur
       FROM route_stations rs
       JOIN stations s ON s.id = rs.station_id
       WHERE rs.route_id = ?
       ORDER BY rs.sequence`,
      [routeId]
    );

    const normalized = rows.map((row) => ({
      ...row,
      public_note_tur: row.public_note_tur ?? null,
      public_note_retur: row.public_note_retur ?? null,
      public_latitude_tur: row.public_latitude_tur != null ? Number(row.public_latitude_tur) : null,
      public_longitude_tur: row.public_longitude_tur != null ? Number(row.public_longitude_tur) : null,
      public_latitude_retur: row.public_latitude_retur != null ? Number(row.public_latitude_retur) : null,
      public_longitude_retur: row.public_longitude_retur != null ? Number(row.public_longitude_retur) : null,
    }));

    const reordered = isReturnDirection(finalDirection)
      ? normalized.slice().reverse().map((row, idx) => ({ ...row, sequence: idx + 1 }))
      : normalized;

    const withDirection = reordered.map((row) => {
      const noteTur = row.public_note_tur ? String(row.public_note_tur).trim() : null;
      const noteRet = row.public_note_retur ? String(row.public_note_retur).trim() : null;
      const directionNote = finalDirection === 'retur' ? noteRet : noteTur;
      const directionLat = finalDirection === 'retur' ? row.public_latitude_retur : row.public_latitude_tur;
      const directionLng = finalDirection === 'retur' ? row.public_longitude_retur : row.public_longitude_tur;

      return {
        ...row,
        public_note_tur: noteTur,
        public_note_retur: noteRet,
        public_latitude_tur: row.public_latitude_tur,
        public_longitude_tur: row.public_longitude_tur,
        public_latitude_retur: row.public_latitude_retur,
        public_longitude_retur: row.public_longitude_retur,
        public_note: directionNote || null,
        public_latitude: directionLat != null ? Number(directionLat) : null,
        public_longitude: directionLng != null ? Number(directionLng) : null,
        direction: finalDirection,
      };
    });

    res.json(withDirection);
  } catch (err) { next(err); }
});

/*────────────────────── 3) RESCRIE LISTA STAȚIILOR ────────────────────────
  PUT /api/routes/:id/stations (array de stații)
  Notă: în PG construiai geometrii. În MariaDB salvăm JSON-ul polygon ca TEXT/JSON nativ. */
router.put('/:id/stations', async (req, res, next) => {
  const routeId = Number(req.params.id);
  if (!routeId) {
    return res.status(400).json({ error: 'invalid route id' });
  }
  const stops = req.body;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute('DELETE FROM route_stations WHERE route_id = ?', [routeId]);

    for (const s of stops) {
      const type = ['circle', 'polygon'].includes(s.geofence_type) ? s.geofence_type : 'circle';
      const radius = type === 'circle' ? (s.geofence_radius_m || 200) : null;
      const noteTur = typeof s.public_note_tur === 'string' ? s.public_note_tur.trim() || null : null;
      const noteRet = typeof s.public_note_retur === 'string' ? s.public_note_retur.trim() || null : null;
      const latTur = s.public_latitude_tur != null && s.public_latitude_tur !== ''
        ? Number(s.public_latitude_tur)
        : null;
      const lngTur = s.public_longitude_tur != null && s.public_longitude_tur !== ''
        ? Number(s.public_longitude_tur)
        : null;
      const latRet = s.public_latitude_retur != null && s.public_latitude_retur !== ''
        ? Number(s.public_latitude_retur)
        : null;
      const lngRet = s.public_longitude_retur != null && s.public_longitude_retur !== ''
        ? Number(s.public_longitude_retur)
        : null;
      // Acceptăm: 1) array [{lat,lng}], 2) WKT "POLYGON(...)", 3) GeoJSON string
      let poly = null;
      if (type === 'polygon') {
        if (Array.isArray(s.geofence_polygon) && s.geofence_polygon.length >= 3) {
          const ring = s.geofence_polygon.map(p => [Number(p.lng), Number(p.lat)]);
          // închidem inelul dacă nu e închis
          const [fLng, fLat] = ring[0], [lLng, lLat] = ring[ring.length - 1];
          if (Math.abs(fLng - lLng) > 1e-9 || Math.abs(fLat - lLat) > 1e-9) ring.push([fLng, fLat]);
          const coords = ring.map(([lng, lat]) => `${lng} ${lat}`).join(', ');
          poly = `POLYGON((${coords}))`;
        } else if (typeof s.geofence_polygon === 'string' && s.geofence_polygon.trim()) {
          poly = s.geofence_polygon.trim(); // WKT sau GeoJSON
        }
      }
      // pregătim SQL în funcție de tipul stringului 'poly'
      let polySql = 'NULL';
      let polyParam = null;
      if (poly) {
        if (/^POLYGON\s*\(/i.test(poly)) {         // WKT
          polySql = 'ST_GeomFromText(?, 4326)';
          polyParam = poly;
        } else if (/^\s*\{/.test(poly)) {          // GeoJSON text
          polySql = 'ST_GeomFromGeoJSON(?)';
          polyParam = poly;
        }
      }

      const sql = `
        INSERT INTO route_stations
          (route_id, station_id, sequence,
           distance_from_previous_km, travel_time_from_previous_minutes,
           geofence_type, geofence_radius_m, geofence_polygon,
           public_note_tur, public_note_retur,
           public_latitude_tur, public_longitude_tur,
           public_latitude_retur, public_longitude_retur)
        VALUES (?, ?, ?, ?, ?, ?, ?, ${polySql}, ?, ?, ?, ?, ?, ?)
      `;
      const params = [
        routeId,
        s.station_id,
        s.sequence,
        s.distance_km ?? null,
        s.duration_min ?? null,
        type,
        radius,
        noteTur,
        noteRet,
        Number.isFinite(latTur) ? latTur : null,
        Number.isFinite(lngTur) ? lngTur : null,
        Number.isFinite(latRet) ? latRet : null,
        Number.isFinite(lngRet) ? lngRet : null,
      ];
      if (polyParam) params.push(polyParam);
      await conn.execute(sql, params);
    }

    const [tripRows] = await conn.execute(
      'SELECT id FROM trips WHERE route_id = ?',
      [routeId]
    );

    for (const trip of tripRows) {
      await conn.query('CALL sp_fill_trip_stations(?)', [trip.id]);
    }

    await conn.commit();
    conn.release();
    res.sendStatus(204);
  } catch (err) {
    await conn.rollback();
    conn.release();
    next(err);
  }
});

/*──────────────────── 4) ȘTERGE O STAȚIE DIN TRASEU ────────────────────────
  DELETE /api/route-stations/:id */
router.delete('/route-stations/:id', async (req, res, next) => {
  try {
    await db.query('DELETE FROM route_stations WHERE id = ?', [req.params.id]);
    res.sendStatus(204);
  } catch (err) { next(err); }
});

/*──────────────────────────── 5) GET PREȚ SEGMENT ──────────────────────────␊
  GET /api/routes/price?route_id=&from_station_id=&to_station_id=&category=&date=YYYY-MM-DD */
router.get('/price', async (req, res) => {
  const {
    route_id,
    from_station_id,
    to_station_id,
    category,
    date,
    route_schedule_id,
  } = req.query;

  const rId = Number(route_id);
  const fromId = Number(from_station_id);
  const toId = Number(to_station_id);
  const catId = Number(category);
  const scheduleId = route_schedule_id ? Number(route_schedule_id) : null;
  const rawDate = typeof date === 'string' ? date.slice(0, 10) : null;

  if (!rId || !fromId || !toId || !catId || !rawDate) {
    return res.status(400).json({ error: 'params missing' });
  }

  if (scheduleId && req.user?.role === 'agent') {
    try {
      const { rows: scheduleRows } = await db.query(
        'SELECT id FROM route_schedules WHERE id = ? AND route_id = ? LIMIT 1',
        [scheduleId, rId]
      );
      if (!scheduleRows.length) {
        return res.status(404).json({ error: 'Programarea nu aparține rutei' });
      }

      const { rows: allowedRows } = await db.query(
        'SELECT pricing_category_id FROM route_schedule_pricing_categories WHERE route_schedule_id = ?',
        [scheduleId]
      );
      if (allowedRows.length) {
        const allowed = new Set(allowedRows.map(r => Number(r.pricing_category_id)));
        if (!allowed.has(catId)) {
          return res.status(403).json({ error: 'Categoria nu este disponibilă pentru această cursă' });
        }
      }
    } catch (err) {
      console.error('GET /api/routes/price restriction check', err);
      return res.status(500).json({ error: 'Eroare la validarea categoriei' });
    }
  }

  const sql = `
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
               AND effective_from <= LEAST(DATE(?), CURDATE())
      )
    LIMIT 1
  `;
  const params = [rId, fromId, toId, catId, rId, catId, rawDate];

  try {
    const { rows } = await db.query(sql, params);
    if (!rows.length) return res.status(404).json({ error: 'Preț inexistent' });

    res.json({
      price: rows[0].price,
      price_list_id: rows[0].price_list_id,
      pricing_category_id: rows[0].pricing_category_id
    });
  } catch (err) {
    console.error('GET /api/routes/price', err);
    res.status(500).json({ error: 'Eroare internă' });
  }
});



module.exports = router;
