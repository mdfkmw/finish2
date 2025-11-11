const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// ✅ Acces doar pentru admin și operator_admin
router.use(requireAuth, requireRole('admin', 'operator_admin'));

// ✅ Scoping automat pentru operator_admin
router.use((req, _res, next) => {
  if (req.user?.role === 'operator_admin') {
    const opId = String(req.user.operator_id || '');
    // Forțăm operator_id în query
    if (req.query && typeof req.query === 'object') {
      if (!req.query.operator_id || String(req.query.operator_id) !== opId) {
        req.query.operator_id = opId;
      }
    }
    // Forțăm operator_id și în body, dacă există
    if (req.body && typeof req.body === 'object') {
      if (req.body.operator_id && String(req.body.operator_id) !== opId) {
        req.body.operator_id = Number(opId);
      }
    }
  }
  next();
});


/*  
  GET /api/reports/trips
  Params obligatorii:
    operator_id – id din operators
  Params opționale:
    start (YYYY-MM-DD) – default = azi
    end   (YYYY-MM-DD) – default = start
    route_id, agency_id, agent_id, hour
*/
router.get('/trips', async (req, res) => {
  try {
    const {
      operator_id,
      start = new Date().toISOString().slice(0, 10),
      end = start,
      route_id,
      agency_id,
      agent_id,
      hour
    } = req.query;

    if (!operator_id) {
      return res.status(400).json({ error: 'operator_id este obligatoriu' });
    }

    const params = [operator_id, start, end];
    const whereExtra = [];

    if (route_id) {
      params.push(route_id);
      whereExtra.push(`AND rs.route_id = ?`);
    }
    if (agency_id) {
      params.push(agency_id);
      whereExtra.push(`AND e.agency_id = ?`);
    }
    if (agent_id) {
      params.push(agent_id);
      whereExtra.push(`AND res.created_by = ?`);
    }
    if (hour) {
      params.push(hour);
      whereExtra.push(`AND TIME_FORMAT(t.time, '%H:%i') = ?`);
    }

    const extraSql = whereExtra.join(' ');

    // 1️⃣ trips
    const tripsSql = `
      SELECT
        t.id AS trip_id,
        t.date AS trip_date,
        DATE_FORMAT(t.time, '%H:%i') AS trip_time,
        r.name AS route_name,
        v.name AS vehicle_name,
        v.plate_number AS vehicle_plate,
        v.seat_count AS seats_total,
        SUM(CASE WHEN res.id IS NOT NULL AND res.status <> 'cancelled' THEN 1 ELSE 0 END) AS seats_booked,
        COALESCE(SUM(CASE WHEN res.id IS NOT NULL AND res.status <> 'cancelled' THEN COALESCE(rd.discount_total, 0) ELSE 0 END), 0) AS discount_total,
        COALESCE(SUM(CASE WHEN res.id IS NOT NULL AND res.status <> 'cancelled' THEN COALESCE(rd.discount_count, 0) ELSE 0 END), 0) AS discount_count,
        COALESCE(SUM(CASE WHEN res.id IS NOT NULL AND res.status <> 'cancelled' THEN COALESCE(pay.paid_amount, 0) ELSE 0 END), 0) AS paid_total,
        COALESCE(SUM(CASE WHEN res.id IS NOT NULL AND res.status <> 'cancelled' AND (pay.payments_count IS NULL OR pay.payments_count = 0) THEN COALESCE(rp.price_value, 0) ELSE 0 END), 0) AS due_total,
        CASE WHEN rp.booking_channel = 'online' THEN 'online' ELSE 'agent' END AS channel
      FROM trips t
      JOIN route_schedules rs ON rs.id = t.route_schedule_id
      JOIN routes r ON r.id = rs.route_id
      JOIN vehicles v ON v.id = t.vehicle_id
      LEFT JOIN reservations res ON res.trip_id = t.id
      LEFT JOIN reservation_pricing rp ON rp.reservation_id = res.id
      LEFT JOIN (
        SELECT reservation_id, COUNT(*) AS discount_count, SUM(discount_amount) AS discount_total
          FROM reservation_discounts
         GROUP BY reservation_id
      ) rd ON rd.reservation_id = res.id
      LEFT JOIN (
        SELECT reservation_id, COUNT(*) AS payments_count, SUM(amount) AS paid_amount
          FROM payments
         WHERE status = 'paid'
         GROUP BY reservation_id
      ) pay ON pay.reservation_id = res.id
      LEFT JOIN employees e ON e.id = res.created_by
      LEFT JOIN agencies a ON a.id = e.agency_id
      WHERE rs.operator_id = ?
        AND t.date BETWEEN ? AND ?
        ${extraSql}
      GROUP BY t.id, t.date, trip_time, r.name, v.name, v.plate_number, v.seat_count, channel
      ORDER BY trip_time, r.name;
    `;
    const trips = (await db.query(tripsSql, params)).rows;

    // 2️⃣ summary
    const summarySql = `
      SELECT
        SUM(CASE WHEN res.id IS NOT NULL AND res.status <> 'cancelled' THEN 1 ELSE 0 END) AS total_seats_booked,
        SUM(CASE WHEN res.id IS NOT NULL AND res.status = 'cancelled' THEN 1 ELSE 0 END) AS total_cancels_noshow,
        SUM(CASE WHEN res.id IS NOT NULL AND res.status <> 'cancelled' AND pay.payments_count > 0 THEN 1 ELSE 0 END) AS paid_seats,
        COALESCE(SUM(CASE WHEN res.id IS NOT NULL AND res.status <> 'cancelled' THEN COALESCE(pay.paid_amount, 0) ELSE 0 END), 0) AS paid_total,
        COALESCE(SUM(CASE WHEN res.id IS NOT NULL AND res.status <> 'cancelled' AND pay.payments_count > 0 THEN COALESCE(rd.discount_total, 0) ELSE 0 END), 0) AS paid_discounts,
        SUM(CASE WHEN res.id IS NOT NULL AND res.status <> 'cancelled' AND (pay.payments_count IS NULL OR pay.payments_count = 0) THEN 1 ELSE 0 END) AS reserved_seats,
        COALESCE(SUM(CASE WHEN res.id IS NOT NULL AND res.status <> 'cancelled' AND (pay.payments_count IS NULL OR pay.payments_count = 0) THEN COALESCE(rp.price_value, 0) ELSE 0 END), 0) AS reserved_total,
        COALESCE(SUM(CASE WHEN res.id IS NOT NULL AND res.status <> 'cancelled' AND (pay.payments_count IS NULL OR pay.payments_count = 0) THEN COALESCE(rd.discount_total, 0) ELSE 0 END), 0) AS reserved_discounts
      FROM trips t
      JOIN route_schedules rs ON rs.id = t.route_schedule_id
      LEFT JOIN reservations res ON res.trip_id = t.id
      LEFT JOIN reservation_pricing rp ON rp.reservation_id = res.id
      LEFT JOIN (
        SELECT reservation_id, COUNT(*) AS discount_count, SUM(discount_amount) AS discount_total
          FROM reservation_discounts
         GROUP BY reservation_id
      ) rd ON rd.reservation_id = res.id
      LEFT JOIN (
        SELECT reservation_id, COUNT(*) AS payments_count, SUM(amount) AS paid_amount
          FROM payments
         WHERE status = 'paid'
         GROUP BY reservation_id
      ) pay ON pay.reservation_id = res.id
      LEFT JOIN employees e ON e.id = res.created_by
      LEFT JOIN agencies a ON a.id = e.agency_id
      WHERE rs.operator_id = ?
        AND t.date BETWEEN ? AND ?
        ${extraSql};
    `;
    const [summary] = (await db.query(summarySql, params)).rows;

    // 3️⃣ total cash nepredat
    const handSql = `
      SELECT COALESCE(SUM(p.amount), 0) AS to_hand_over
      FROM payments p
      JOIN reservations res ON res.id = p.reservation_id
      JOIN trips t ON t.id = res.trip_id
      JOIN route_schedules rs ON rs.id = t.route_schedule_id
      LEFT JOIN employees e ON e.id = res.created_by
      WHERE rs.operator_id = ?
        AND p.status = 'paid'
        AND p.payment_method = 'cash'
        AND p.deposited_at IS NULL
        AND DATE(p.timestamp) BETWEEN ? AND ?
        ${extraSql};
    `;
    const [hand] = (await db.query(handSql, params)).rows;

    // 4️⃣ discounts by type
    const discountsByTypeSql = `
      SELECT
        dt.id AS discount_type_id,
        dt.label AS discount_label,
        SUM(CASE WHEN pay.payments_count > 0 THEN 1 ELSE 0 END) AS paid_count,
        COALESCE(SUM(CASE WHEN pay.payments_count > 0 THEN COALESCE(rd.discount_amount, 0) ELSE 0 END), 0) AS paid_total,
        SUM(CASE WHEN pay.payments_count IS NULL OR pay.payments_count = 0 THEN 1 ELSE 0 END) AS reserved_count,
        COALESCE(SUM(CASE WHEN pay.payments_count IS NULL OR pay.payments_count = 0 THEN COALESCE(rd.discount_amount, 0) ELSE 0 END), 0) AS reserved_total
      FROM trips t
      JOIN route_schedules rs ON rs.id = t.route_schedule_id
      LEFT JOIN reservations res ON res.trip_id = t.id
      LEFT JOIN reservation_discounts rd ON rd.reservation_id = res.id
      LEFT JOIN discount_types dt ON dt.id = rd.discount_type_id
      LEFT JOIN (
        SELECT reservation_id, COUNT(*) AS payments_count
          FROM payments
         WHERE status = 'paid'
         GROUP BY reservation_id
      ) pay ON pay.reservation_id = res.id
      LEFT JOIN employees e ON e.id = res.created_by
      WHERE rs.operator_id = ?
        AND t.date BETWEEN ? AND ?
        ${extraSql}
        AND rd.discount_type_id IS NOT NULL
        AND res.status <> 'cancelled'
      GROUP BY dt.id, dt.label
      ORDER BY dt.label;
    `;
    const discountsByType = (await db.query(discountsByTypeSql, params)).rows;

    res.json({
      trips,
      summary,
      discountsByType,
      toHandOver: hand?.to_hand_over || 0
    });
  } catch (err) {
    console.error('[GET /api/reports/trips]', err);
    res.status(500).json({ error: 'Eroare internă reports' });
  }
});

/* 🔹 POST /api/reports/cash-handover */
router.post('/cash-handover', async (req, res) => {
  const { operator_id, employee_id } = req.body;
  if (!operator_id || !employee_id) {
    return res.status(400).json({ error: 'Lipsește operator_id sau employee_id' });
  }

  try {
    const [totalRow] = (await db.query(`
      SELECT COALESCE(SUM(p.amount), 0) AS total
      FROM payments p
      JOIN reservations r ON r.id = p.reservation_id
      JOIN trips t ON t.id = r.trip_id
      JOIN route_schedules rs ON rs.id = t.route_schedule_id
      WHERE rs.operator_id = ?
        AND p.status = 'paid'
        AND p.payment_method = 'cash'
        AND p.deposited_at IS NULL
    `, [operator_id])).rows;

    const total = Number(totalRow?.total || 0);
    if (total <= 0) {
      return res.status(400).json({ error: 'Nu există sume de predat.' });
    }

    await db.query(`
      UPDATE payments
         SET deposited_at = NOW()
       WHERE id IN (
         SELECT p.id FROM payments p
         JOIN reservations r ON r.id = p.reservation_id
         JOIN trips t ON t.id = r.trip_id
         JOIN route_schedules rs ON rs.id = t.route_schedule_id
         WHERE rs.operator_id = ?
           AND p.status = 'paid'
           AND p.payment_method = 'cash'
           AND p.deposited_at IS NULL
       )
    `, [operator_id]);

    await db.query(`
      INSERT INTO cash_handovers (employee_id, operator_id, amount)
      VALUES (?, ?, ?)
    `, [employee_id, operator_id, total]);

    res.json({ success: true, amount: total });
  } catch (err) {
    console.error('[POST /api/reports/cash-handover]', err);
    res.status(500).json({ error: 'Eroare internă la predare totală.' });
  }
});

module.exports = router;
