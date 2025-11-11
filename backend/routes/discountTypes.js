const express = require('express');
const db = require('../db');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');


// ✅ Dacă e operator_admin, impunem operator_id-ul lui pe toate operațiile
router.use((req, _res, next) => {
  if (req.user?.role === 'operator_admin') {
    const opId = String(req.user.operator_id || '');
    // Forțăm operator_id în query (liste/filtrări)
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


// 1️⃣ GET lista tuturor discount-urilor
router.get('/', async (_req, res) => {
  try {
    const result = await db.query(
      'SELECT id, code, label, value_off, type FROM discount_types ORDER BY label'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Eroare la GET /discountTypes:', err);
    res.status(500).json({ error: 'Eroare la interogarea DB' });
  }
});

// 2️⃣ GET toate schedule-urile (route + departure)
router.get('/schedules/all', async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT rs.id, r.name AS route_name, rs.departure, rs.direction
      FROM route_schedules rs
      JOIN routes r ON r.id = rs.route_id
      ORDER BY r.name, rs.departure
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Eroare la GET /schedules/all:', err);
    res.status(500).json({ error: 'Eroare la interogarea DB' });
  }
});

// 3️⃣ GET schedule-urile la care se aplică un discount
router.get('/:discountId/schedules', async (req, res) => {
  const { discountId } = req.params;
  try {
    const result = await db.query(
      `
      SELECT route_schedule_id, visible_agents, visible_online
        FROM route_schedule_discounts
       WHERE discount_type_id = ?
      `,
      [discountId]
    );

    const payload = result.rows.map(row => ({
      route_schedule_id: Number(row.route_schedule_id),
      visible_agents: Number(row.visible_agents) === 1,
      visible_online: Number(row.visible_online) === 1
    }));

    res.json(payload);
  } catch (err) {
    console.error('Eroare la GET /:discountId/schedules:', err);
    res.status(500).json({ error: 'Eroare DB' });
  }
});

// 4️⃣ PUT update asocieri
router.put('/:discountId/schedules', async (req, res) => {
  const { discountId } = req.params;
  const { schedules, scheduleIds } = req.body || {};

  const normalized = [];

  if (Array.isArray(schedules)) {
    for (const entry of schedules) {
      if (!entry) continue;
      const schedId = Number(entry.scheduleId ?? entry.route_schedule_id ?? entry.id);
      if (!Number.isFinite(schedId) || schedId <= 0) continue;
      const visibleAgents = entry.visibleAgents ?? entry.visible_agents ?? entry.agents ?? entry.apply ?? false;
      const visibleOnline = entry.visibleOnline ?? entry.visible_online ?? entry.online ?? false;
      normalized.push({
        id: schedId,
        agents: !!visibleAgents,
        online: !!visibleOnline
      });
    }
  } else if (Array.isArray(scheduleIds)) {
    for (const rawId of scheduleIds) {
      const schedId = Number(rawId);
      if (!Number.isFinite(schedId) || schedId <= 0) continue;
      normalized.push({ id: schedId, agents: true, online: false });
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      'DELETE FROM route_schedule_discounts WHERE discount_type_id = ?',
      [discountId]
    );

    for (const entry of normalized) {
      if (!entry.agents && !entry.online) continue;
      await conn.execute(
        `
        INSERT INTO route_schedule_discounts
          (discount_type_id, route_schedule_id, visible_agents, visible_online)
        VALUES (?, ?, ?, ?)
        `,
        [discountId, entry.id, entry.agents ? 1 : 0, entry.online ? 1 : 0]
      );
    }

    await conn.commit();
    conn.release();
    res.sendStatus(204);
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Eroare la PUT /:discountId/schedules:', err);
    res.status(500).json({ error: 'Nu am putut salva asocierile' });
  }
});

// 5️⃣ POST — adaugă un discount nou
router.post('/', async (req, res) => {
  const { code, label, value_off, type } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO discount_types (code, label, value_off, type) VALUES (?, ?, ?, ?)',
      [code, label, value_off, type]
    );

    // Extragem înregistrarea nouă
    const inserted = await db.query(
      'SELECT * FROM discount_types WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json(inserted.rows[0]);
  } catch (err) {
    console.error('Eroare la INSERT discount_types:', err);
    res.status(500).json({ error: 'Eroare la inserare în DB' });
  }
});

// 6️⃣ PUT — actualizează un discount existent
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { code, label, value_off, type } = req.body;

  try {
    const result = await db.query(
      'UPDATE discount_types SET code=?, label=?, value_off=?, type=? WHERE id=?',
      [code, label, value_off, type, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Discount inexistent' });
    }

    res.sendStatus(204);
  } catch (err) {
    console.error('Eroare la actualizarea discountului:', err);
    res.status(500).json({ error: 'Eroare la salvare în DB' });
  }
});

// 7️⃣ DELETE — ștergere discount
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM discount_types WHERE id = ?', [id]);
    res.sendStatus(204);
  } catch (err) {
    console.error('Eroare la ștergere discount:', err);

    // codul pentru foreign key în MariaDB e ER_ROW_IS_REFERENCED_2 (1451)
    if (err.errno === 1451) {
      return res.status(400).json({
        message: 'Nu poți șterge acest tip de reducere deoarece este folosit într-un traseu.'
      });
    }

    res.status(500).send('Eroare la ștergere');
  }
});

module.exports = router;
