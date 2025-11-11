const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('admin', 'operator_admin', 'agent', 'driver'));

function parseDeparture(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  const candidate = new Date(value);
  if (!Number.isNaN(candidate.getTime())) {
    return candidate;
  }
  return null;
}

router.patch('/:tripId', async (req, res) => {
  const tripId = Number(req.params.tripId);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return res.status(400).json({ error: 'tripId invalid.' });
  }

  let shouldStart;
  const desiredRaw = req.body?.boarding_started;
  if (typeof desiredRaw === 'boolean') {
    shouldStart = desiredRaw;
  } else if (desiredRaw === 1 || desiredRaw === '1') {
    shouldStart = true;
  } else if (desiredRaw === 0 || desiredRaw === '0') {
    shouldStart = false;
  } else if (typeof req.body?.action === 'string') {
    const action = req.body.action.toLowerCase();
    if (action === 'start' || action === 'begin') {
      shouldStart = true;
    } else if (action === 'stop' || action === 'reset' || action === 'cancel') {
      shouldStart = false;
    }
  }

  if (typeof shouldStart !== 'boolean') {
    return res.status(400).json({ error: 'Specifică boarding_started=true/false sau action=start/stop.' });
  }

  try {
    if (req.user.role === 'driver') {
      const driverId = Number(req.user.id);
      const assignment = await db.query(
        `SELECT 1
           FROM trip_vehicle_employees tve
           JOIN trip_vehicles tv ON tv.id = tve.trip_vehicle_id
          WHERE tv.trip_id = ?
            AND tve.employee_id = ?
          LIMIT 1`,
        [tripId, driverId]
      );
      if (!assignment.rows?.length) {
        return res.status(403).json({ error: 'Nu ești asignat acestei curse.' });
      }
    }

    const { rows } = await db.query(
      `SELECT id, boarding_started, TIMESTAMP(date, time) AS departure_at FROM trips WHERE id = ? LIMIT 1`,
      [tripId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Cursa nu a fost găsită.' });
    }
    const trip = rows[0];
    const current = Number(trip.boarding_started) === 1;
    if (current === shouldStart) {
      return res.json({ boarding_started: current });
    }

    if (!shouldStart) {
      if (req.user.role === 'driver') {
        return res.status(403).json({ error: 'Șoferii nu pot dezactiva starea de îmbarcare.' });
      }
      await db.query(`UPDATE trips SET boarding_started = 0 WHERE id = ?`, [tripId]);
      return res.json({ boarding_started: false });
    }

    const departure = parseDeparture(trip.departure_at);
    if (departure && departure.getTime() <= Date.now()) {
      // chiar dacă ora a trecut, permitem activarea pentru a bloca rezervările rămase
    }

    await db.query(`UPDATE trips SET boarding_started = 1 WHERE id = ?`, [tripId]);
    return res.json({ boarding_started: true });
  } catch (err) {
    console.error('PATCH /api/trip-boarding/:tripId error', err);
    return res.status(500).json({ error: 'Eroare internă la actualizarea stării de îmbarcare.' });
  }
});

module.exports = router;
