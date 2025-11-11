const express = require('express');
const db = require('../db');
const router = express.Router();

const { requireAuth, requireRole } = require('../middleware/auth');

// ✅ Acces pentru admin, operator_admin și agent
router.use(requireAuth, requireRole('admin', 'operator_admin', 'agent'));

// ✅ Pentru operator_admin: impunem operator_id-ul propriu în query/body
router.use((req, _res, next) => {
  if (req.user?.role === 'operator_admin') {
    const opId = String(req.user.operator_id || '');
    // Forțăm operator_id în query (listări/filtrări)
    if (req.query && typeof req.query === 'object') {
      req.query.operator_id = opId;
    }
    // Forțăm operator_id în body (create/update/alocări)
    if (req.body && typeof req.body === 'object') {
      req.body.operator_id = Number(opId);
    }
  }
  next();
});





// ==================== GET /api/trip_assignments?date=YYYY-MM-DD&operator_id=ID ====================
router.get('/', async (req, res) => {
  const { date, operator_id } = req.query;
  try {
    if (!date) {
      return res.status(400).json({ error: 'Parametrul date este obligatoriu' });
    }

    const whereClauses = ['t.date = ?'];
    const params = [date];

    if (operator_id) {
      whereClauses.push('rs.operator_id = ?');
      params.push(operator_id);
    }

    const query = `
      SELECT
        tv.id              AS trip_vehicle_id,
        tv.trip_id,
        tv.is_primary,
        t.time             AS trip_time,
        t.disabled         AS disabled,
        t.route_id,
        r.name             AS route_name,
        rs.id              AS route_schedule_id,
        TIME_FORMAT(rs.departure, '%H:%i') AS schedule_departure,
        rs.direction,
        v.id               AS vehicle_id,
        v.name             AS vehicle_name,
        v.plate_number,
        tve.employee_id,
        e.name             AS employee_name
      FROM trip_vehicles tv
      JOIN trips t                ON t.id = tv.trip_id
      JOIN routes r               ON r.id = t.route_id
      JOIN vehicles v             ON v.id = tv.vehicle_id
      JOIN route_schedules rs     ON rs.id = t.route_schedule_id
      LEFT JOIN trip_vehicle_employees tve ON tve.trip_vehicle_id = tv.id
      LEFT JOIN employees e       ON e.id = tve.employee_id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY rs.direction, rs.departure, t.time, tv.is_primary DESC, tv.id;
    `;
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/trip_assignments error:', err);
    res.status(500).json({ error: 'Eroare internă la citirea asignărilor' });
  }
});

// ==================== POST /api/trip_assignments ====================
// Body: { trip_vehicle_id: number, employee_id: number | null }
router.post('/', async (req, res) => {
  console.log('[POST /trip_assignments] body =', req.body);
  const { trip_vehicle_id, employee_id } = req.body;

  if (!trip_vehicle_id) {
    return res.status(400).json({ error: 'trip_vehicle_id lipsă' });
  }

  try {
    if (employee_id === null || employee_id === '' || employee_id === undefined) {
      // ───────────────  UNASSIGN  ───────────────
      await db.query(
        'DELETE FROM trip_vehicle_employees WHERE trip_vehicle_id = ?',
        [trip_vehicle_id]
      );
      console.log('▶ Asignare ștearsă');
      return res.json({ success: true, unassigned: true });
    }

    // ───────────────  ASSIGN / UPDATE  ───────────────
    // În MariaDB nu există ON CONFLICT, deci verificăm manual
    const { rows: existing } = await db.query(
      'SELECT id FROM trip_vehicle_employees WHERE trip_vehicle_id = ?',
      [trip_vehicle_id]
    );

    if (existing.length) {
      await db.query(
        'UPDATE trip_vehicle_employees SET employee_id = ? WHERE trip_vehicle_id = ?',
        [employee_id, trip_vehicle_id]
      );
      console.log('▶ Actualizare existentă');
    } else {
      await db.query(
        'INSERT INTO trip_vehicle_employees (trip_vehicle_id, employee_id) VALUES (?, ?)',
        [trip_vehicle_id, employee_id]
      );
      console.log('▶ Inserare nouă');
    }

    res.json({ success: true, assigned: true });
  } catch (err) {
    console.error('POST /api/trip_assignments error:', err);
    res.status(500).json({ error: 'Eroare internă la salvarea asignării' });
  }
});

module.exports = router;
