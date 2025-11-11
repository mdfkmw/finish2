const express = require('express');
const db = require('../db');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
// Dacă ai utilitarul, folosește-l; altfel, păstrează fallback-ul de mai jos.
let normalizeDirection = (d) => (d === 'retur' ? 'retur' : 'tur');
try {
  const dirUtil = require('../utils/direction');
  if (typeof dirUtil.normalizeDirection === 'function') {
    normalizeDirection = dirUtil.normalizeDirection;
  }
} catch (_) { /* ok, folosim fallback-ul local */ }

// ✅ doar utilizatori autentificați
router.use(requireAuth);

const sanitizePhone = (raw = '') => raw.replace(/\D/g, '');

// GET /api/traveler-defaults?phone=...&route_id=...&direction=tur|retur
router.get('/', async (req, res) => {
  try {
    const phone = sanitizePhone(req.query.phone || '');
    const routeId = Number(req.query.route_id);
    const direction = normalizeDirection(req.query.direction); // 'tur' | 'retur'

    if (!phone || !Number.isInteger(routeId)) {
      return res.json({ found: false });
    }

    /**
     * Single-query cu 3 nivele:
     *  rk=1: phone + route + direction   (strict)
     *  rk=2: phone + route               (ignorăm direction)
     *  rk=3: phone                       (ignorăm route & direction)
     *
     * În toate, reordonăm (board/exit) pe baza secvenței stațiilor de pe ruta curentă și a
     * direcției CERUTE ACUM (parametrul `direction`), nu a celei din preferință.
     *
     * Observă IF(...) cu un CASE care testează o singură dată direcția cerută acum.
     */
    const sql = `
      SELECT
        x.final_board_id,
        x.final_exit_id,
        sb.name AS board_name,
        se.name AS exit_name
      FROM (
        /* rk=1: STRICT (phone+route+direction) */
        SELECT
          IF(
            (CASE WHEN ? = 'tur' THEN rsb.sequence <= rse.sequence ELSE rsb.sequence >= rse.sequence END),
            td.board_station_id, td.exit_station_id
          ) AS final_board_id,
          IF(
            (CASE WHEN ? = 'tur' THEN rsb.sequence <= rse.sequence ELSE rsb.sequence >= rse.sequence END),
            td.exit_station_id, td.board_station_id
          ) AS final_exit_id,
          1 AS rk,
          td.use_count,
          td.last_used_at
        FROM traveler_defaults td
        LEFT JOIN route_stations rsb ON rsb.route_id = ? AND rsb.station_id = td.board_station_id
        LEFT JOIN route_stations rse ON rse.route_id = ? AND rse.station_id = td.exit_station_id
        WHERE td.phone = ? AND td.route_id = ? AND td.direction = ?
          AND rsb.sequence IS NOT NULL AND rse.sequence IS NOT NULL

        UNION ALL

        /* rk=2: FALLBACK (phone+route) — ignorăm direction salvat */
        SELECT
          IF(
            (CASE WHEN ? = 'tur' THEN rsb.sequence <= rse.sequence ELSE rsb.sequence >= rse.sequence END),
            td.board_station_id, td.exit_station_id
          ) AS final_board_id,
          IF(
            (CASE WHEN ? = 'tur' THEN rsb.sequence <= rse.sequence ELSE rsb.sequence >= rse.sequence END),
            td.exit_station_id, td.board_station_id
          ) AS final_exit_id,
          2 AS rk,
          td.use_count,
          td.last_used_at
        FROM traveler_defaults td
        LEFT JOIN route_stations rsb ON rsb.route_id = ? AND rsb.station_id = td.board_station_id
        LEFT JOIN route_stations rse ON rse.route_id = ? AND rse.station_id = td.exit_station_id
        WHERE td.phone = ? AND td.route_id = ?
          AND rsb.sequence IS NOT NULL AND rse.sequence IS NOT NULL

        UNION ALL

        /* rk=3: FALLBACK (phone) — ignorăm route & direction salvate */
        SELECT
          IF(
            (CASE WHEN ? = 'tur' THEN rsb.sequence <= rse.sequence ELSE rsb.sequence >= rse.sequence END),
            td.board_station_id, td.exit_station_id
          ) AS final_board_id,
          IF(
            (CASE WHEN ? = 'tur' THEN rsb.sequence <= rse.sequence ELSE rsb.sequence >= rse.sequence END),
            td.exit_station_id, td.board_station_id
          ) AS final_exit_id,
          3 AS rk,
          td.use_count,
          td.last_used_at
        FROM traveler_defaults td
        LEFT JOIN route_stations rsb ON rsb.route_id = ? AND rsb.station_id = td.board_station_id
        LEFT JOIN route_stations rse ON rse.route_id = ? AND rse.station_id = td.exit_station_id
        WHERE td.phone = ?
          AND rsb.sequence IS NOT NULL AND rse.sequence IS NOT NULL
      ) AS x
      JOIN stations sb ON sb.id = x.final_board_id
      JOIN stations se ON se.id = x.final_exit_id
      ORDER BY x.rk ASC, x.use_count DESC, x.last_used_at DESC
      LIMIT 1
    `;

    // EXACT 18 parametri pentru 18 '?'
    const params = [
      // rk=1 (2 pentru IF/CASE)
      direction, direction,
      // joins + where
      routeId, routeId, phone, routeId, direction,

      // rk=2 (2 pentru IF/CASE)
      direction, direction,
      // joins + where (fără direction în WHERE)
      routeId, routeId, phone, routeId,

      // rk=3 (2 pentru IF/CASE)
      direction, direction,
      // joins + where (fără route/direction)
      routeId, routeId, phone,
    ];

    const { rows } = await db.query(sql, params);

    if (!rows.length) {
      return res.json({ found: false });
    }

    const r = rows[0];
    return res.json({
      found: true,
      board_station_id: r.final_board_id,
      exit_station_id:  r.final_exit_id,
      board_name:       r.board_name || null,
      exit_name:        r.exit_name  || null,
    });
  } catch (err) {
    console.error('[traveler-defaults] error', err);
    return res.status(500).json({ error: 'Eroare la citirea preferințelor de traseu' });
  }
});

module.exports = router;
