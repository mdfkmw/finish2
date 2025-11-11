// backend/routes/audit.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// acces permis doar admin / operator_admin
function ensureAdmin(req, res, next) {
  const role = req.user?.role;
  if (role === 'admin' || role === 'operator_admin') return next();
  return res.status(403).json({ error: 'forbidden' });
}

/**
 * GET /api/audit-logs
 * Query params:
 *   from (YYYY-MM-DD) optional
 *   to   (YYYY-MM-DD) optional
 *   action (exact match) optional
 *
 * Returnează acțiuni care modifică datele:
 *  - reservation.* / payment.* (ca până acum)
 *  - person.blacklist.* / person.noshow.*  (NOI)
 * Include informații de cursă/loc/segment pentru evenimentele legate de o rezervare.
 */
router.get('/audit-logs', ensureAdmin, async (req, res) => {
  try {
    const { from = '', to = '', action = '', reservation_id = '', person_id = '' } = req.query || {};
    const params = [];
    let where = `
      (
        al.action LIKE 'reservation.%'
        OR al.action LIKE 'payment.%'
        OR al.action LIKE 'person.blacklist.%'
        OR al.action = 'person.noshow.add'
        OR al.action = 'person.noshow.remove'
      )
    `;
    if (from) { where += ` AND DATE(al.created_at) >= ?`; params.push(from); }
    if (to)   { where += ` AND DATE(al.created_at) <= ?`; params.push(to); }
    if (action) { where += ` AND al.action = ?`; params.push(action); }
    if (reservation_id) {
      where += ` AND (
        (al.entity='reservation' AND al.entity_id = ?)
        OR (al.related_entity='reservation' AND al.related_id = ?)
      )`;
      params.push(reservation_id, reservation_id);
    }
    if (person_id) {
      where += ` AND (
        (al.entity='person' AND al.entity_id = ?)
        OR (
          (al.entity IN ('reservation','payment') OR al.related_entity='reservation')
          AND EXISTS (
            SELECT 1
            FROM reservations rr
            WHERE rr.id = CASE
                            WHEN al.entity='reservation' THEN al.entity_id
                            WHEN al.entity='payment'     THEN al.related_id
                            WHEN al.related_entity='reservation' THEN al.related_id
                          END
              AND rr.person_id = ?
          )
        )
      )`;
      params.push(person_id, person_id);
    }

    const sql = `
      WITH move_cids AS (
        SELECT correlation_id
        FROM audit_logs
        WHERE correlation_id IS NOT NULL
          AND action IN ('reservation.move','reservation.cancel','reservation.create')
        GROUP BY correlation_id
        HAVING SUM(action='reservation.move')>0
           AND SUM(action='reservation.cancel')>0
           AND SUM(action='reservation.create')>0
      )
      SELECT
        al.id AS event_id,
        DATE_FORMAT(al.created_at, '%d.%m.%Y %H:%i') AS at,
        CASE
          WHEN al.correlation_id IS NOT NULL
           AND al.correlation_id IN (SELECT correlation_id FROM move_cids)
            THEN 'reservation.moveToOtherTrip'
          ELSE al.action
        END AS action_label,
        al.action,
        al.entity,
        al.entity_id,
        al.related_id,
        al.actor_id,
        e.name AS actor_name,
        al.channel,
        al.amount,
        al.payment_method,
        al.transaction_id,
        r.id                        AS reservation_id,
        rt.name                     AS route_name,
        DATE_FORMAT(t.date, '%d.%m.%Y') AS trip_date,
        DATE_FORMAT(t.time, '%H:%i')    AS hour,
        s.label                     AS seat,
        CONCAT(sb.name, ' → ', se.name) AS segment,
        -- ⬇️ detalii "DE UNDE" (din rezervarea veche)
        r_from.id                   AS from_reservation_id,
        rt_from.name                AS from_route_name,
        DATE_FORMAT(t_from.date, '%d.%m.%Y') AS from_trip_date,
        DATE_FORMAT(t_from.time, '%H:%i')    AS from_hour,
        s_from.label                AS from_seat,
        CONCAT(sb_from.name, ' → ', se_from.name) AS from_segment
      FROM audit_logs al
      LEFT JOIN employees e ON e.id = al.actor_id
    LEFT JOIN reservations r
        ON r.id = CASE
                    WHEN al.entity='reservation' THEN al.entity_id
                    WHEN al.entity='payment'     THEN al.related_id
                    WHEN al.related_entity='reservation' THEN al.related_id
                    ELSE NULL
                  END
      LEFT JOIN trips   t   ON t.id  = r.trip_id
      LEFT JOIN routes  rt  ON rt.id = t.route_id
      LEFT JOIN seats   s   ON s.id  = r.seat_id
      LEFT JOIN stations sb ON sb.id = r.board_station_id
      LEFT JOIN stations se ON se.id = r.exit_station_id
      -- ⬇️ join pe REZERVAREA VECHĂ, prin related_id (setat la move)
      LEFT JOIN reservations r_from
        ON r_from.id = CASE
                         WHEN al.action LIKE 'reservation.move%' AND al.related_id IS NOT NULL
                           THEN al.related_id
                         ELSE NULL
                       END
      LEFT JOIN trips   t_from   ON t_from.id  = r_from.trip_id
      LEFT JOIN routes  rt_from  ON rt_from.id = t_from.route_id
      LEFT JOIN seats   s_from   ON s_from.id  = r_from.seat_id
      LEFT JOIN stations sb_from ON sb_from.id = r_from.board_station_id
      LEFT JOIN stations se_from ON se_from.id = r_from.exit_station_id
      WHERE ${where}
        -- excludem cancel/create când fac parte dintr-o mutare pe altă cursă
        AND NOT (
          al.correlation_id IS NOT NULL
          AND al.correlation_id IN (SELECT correlation_id FROM move_cids)
          AND al.action IN ('reservation.cancel','reservation.create')
        )
      ORDER BY al.created_at DESC, al.id DESC
      LIMIT 1000
    `;
    const qr = await db.query(sql, params);
    res.json(qr.rows || qr);
  } catch (e) {
    console.error('[GET /api/audit-logs]', e);
    res.status(500).json({ error: 'server error' });
  }
});

module.exports = router;
