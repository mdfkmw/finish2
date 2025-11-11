const express = require('express');
const db = require('../db');
const router = express.Router();

const { requireAuth, requireRole } = require('../middleware/auth');
const { normalizeDirection } = require('../utils/direction');

// ✅ Acces: toți utilizatorii autentificați (agent/driver pot CITI; write doar admin/op_admin)
router.use(requireAuth);

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



function normalizeTime(value) {
  if (!value) return null;
  const str = String(value);
  return str.length >= 5 ? str.slice(0, 5) : str;
}

async function resolveScheduleId(routeId, { scheduleId, time, direction }) {
  if (scheduleId) {
    const { rows } = await db.query(
      `SELECT id, direction FROM route_schedules WHERE id = ? AND route_id = ? LIMIT 1`,
      [scheduleId, routeId]
    );
    if (rows.length) {
      return { id: rows[0].id, direction: normalizeDirection(rows[0].direction) };
    }
    return null;
  }

  const hhmm = normalizeTime(time);
  if (!hhmm) return null;

  const params = [routeId, hhmm];
  let sql = `SELECT id, direction FROM route_schedules WHERE route_id = ? AND TIME_FORMAT(departure, '%H:%i') = ?`;
  if (direction) {
    sql += ' AND direction = ?';
    params.push(normalizeDirection(direction));
  }
  sql += ' ORDER BY id LIMIT 1';

  const { rows } = await db.query(sql, params);
  if (!rows.length) return null;
  return { id: rows[0].id, direction: normalizeDirection(rows[0].direction) };
}

/**
 * GET /api/routes/:routeId/discounts?route_schedule_id=&time=HH:MM&direction=
 * Returnează lista de tipuri de discount (id, code, label, value_off, type)
 * pentru programarea specificată. Dacă nu se trimite schedule_id, se folosește
 * combinația (routeId + time [+ direction]).
 */
router.get('/routes/:routeId/discounts', requireRole('admin','operator_admin','agent','driver'), async (req, res) => {
  const { routeId } = req.params;
  const scheduleId = req.query.route_schedule_id ? Number(req.query.route_schedule_id) : null;
  const time = req.query.time ? normalizeTime(req.query.time) : null;
  const direction = req.query.direction ? normalizeDirection(req.query.direction) : null;

  try {
    const schedule = await resolveScheduleId(routeId, { scheduleId, time, direction });
    if (!schedule) {
      return res.status(404).json({ error: 'Programarea nu a fost găsită pentru rută/ora indicate' });
    }

    const { rows } = await db.query(
      `
      SELECT
        dt.id,
        dt.code,
        dt.label,
        dt.value_off AS discount_value,
        dt.type      AS discount_type
      FROM route_schedule_discounts rsd
      JOIN discount_types dt ON dt.id = rsd.discount_type_id
      WHERE rsd.route_schedule_id = ?
        AND rsd.visible_agents = 1
      ORDER BY dt.label
      `,
      [schedule.id]
    );

    res.json(rows);
  } catch (err) {
    console.error('GET /api/routes/:routeId/discounts error:', err);
    res.status(500).json({ error: 'Eroare la extragerea reducerilor' });
  }
});

/**
 * PUT /api/routes/:routeId/discounts
 * Body: { route_schedule_id?: number, time?: 'HH:MM', direction?: 'tur'|'retur', discountTypeIds: [] }
 * Actualizează setul de discount-uri aplicabile pentru programarea specificată.
 */
router.put('/routes/:routeId/discounts', requireRole('admin','operator_admin'), async (req, res) => {
  const { routeId } = req.params;
  const scheduleId = req.body.route_schedule_id ? Number(req.body.route_schedule_id) : null;
  const time = req.body.time ? normalizeTime(req.body.time) : null;
  const direction = req.body.direction ? normalizeDirection(req.body.direction) : null;
  const { discountTypeIds } = req.body;

  if ((!scheduleId && !time) || !Array.isArray(discountTypeIds)) {
    return res.status(400).json({ error: 'Trebuie să trimiți route_schedule_id sau time și lista discountTypeIds' });
  }

  const schedule = await resolveScheduleId(routeId, { scheduleId, time, direction });
  if (!schedule) {
    return res.status(404).json({ error: 'Programarea nu a fost găsită pentru rută/ora indicate' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `DELETE FROM route_schedule_discounts WHERE route_schedule_id = ?`,
      [schedule.id]
    );

    for (const dtId of discountTypeIds) {
      await conn.execute(
        `INSERT IGNORE INTO route_schedule_discounts (route_schedule_id, discount_type_id, visible_agents, visible_online)
         VALUES (?, ?, 1, 0)`,
        [schedule.id, dtId]
      );
    }

    await conn.commit();
    conn.release();
    res.sendStatus(204);
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('PUT /api/routes/:routeId/discounts error:', err);
    res.status(500).json({ error: 'Eroare la salvarea reducerilor pentru programare' });
  }
});

/**
 * GET /api/routes/:routeId/pricing-categories
 * Returnează categoriile de preț active pentru programarea dată.
 */
router.get('/routes/:routeId/pricing-categories', requireRole('admin','operator_admin','agent','driver'), async (req, res) => {
  const { routeId } = req.params;
  const scheduleId = req.query.route_schedule_id ? Number(req.query.route_schedule_id) : null;
  const time = req.query.time ? normalizeTime(req.query.time) : null;
  const direction = req.query.direction ? normalizeDirection(req.query.direction) : null;

  try {
    const schedule = await resolveScheduleId(routeId, { scheduleId, time, direction });
    if (!schedule) {
      return res.status(404).json({ error: 'Programarea nu a fost găsită pentru rută/ora indicate' });
    }

    const { rows } = await db.query(
      `
      SELECT pc.id, pc.name
        FROM route_schedule_pricing_categories rspc
        JOIN pricing_categories pc ON pc.id = rspc.pricing_category_id
       WHERE rspc.route_schedule_id = ?
       ORDER BY pc.name
      `,
      [schedule.id]
    );

    res.json(rows);
  } catch (err) {
    console.error('GET /api/routes/:routeId/pricing-categories error:', err);
    res.status(500).json({ error: 'Eroare la extragerea categoriilor de preț' });
  }
});

/**
 * PUT /api/routes/:routeId/pricing-categories
 * Body: { route_schedule_id?: number, time?: 'HH:MM', direction?: 'tur'|'retur', categoryIds: [] }
 */
router.put('/routes/:routeId/pricing-categories', requireRole('admin','operator_admin'), async (req, res) => {
  const { routeId } = req.params;
  const scheduleId = req.body.route_schedule_id ? Number(req.body.route_schedule_id) : null;
  const time = req.body.time ? normalizeTime(req.body.time) : null;
  const direction = req.body.direction ? normalizeDirection(req.body.direction) : null;
  const { categoryIds } = req.body;

  if ((!scheduleId && !time) || !Array.isArray(categoryIds)) {
    return res.status(400).json({ error: 'Trebuie să trimiți route_schedule_id sau time și lista categoryIds' });
  }

  const schedule = await resolveScheduleId(routeId, { scheduleId, time, direction });
  if (!schedule) {
    return res.status(404).json({ error: 'Programarea nu a fost găsită pentru rută/ora indicate' });
  }

  const uniqueCategoryIds = Array.from(new Set(categoryIds.map(id => Number(id)).filter(Boolean)));

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `DELETE FROM route_schedule_pricing_categories WHERE route_schedule_id = ?`,
      [schedule.id]
    );

    for (const catId of uniqueCategoryIds) {
      await conn.execute(
        `INSERT IGNORE INTO route_schedule_pricing_categories (route_schedule_id, pricing_category_id)
         VALUES (?, ?)`,
        [schedule.id, catId]
      );
    }

    await conn.commit();
    conn.release();
    res.sendStatus(204);
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('PUT /api/routes/:routeId/pricing-categories error:', err);
    res.status(500).json({ error: 'Eroare la salvarea categoriilor pentru programare' });
  }
});

module.exports = router;
