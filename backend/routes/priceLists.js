const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// --- PUBLIC INTERN (doar autentificat): pricing categories pentru calcule
//     (agent are nevoie să poată citi)
router.get('/pricing-categories', requireAuth, async (_req, res) => {
  try {
    const sql = `
      SELECT id, name
        FROM pricing_categories
       WHERE active = 1
       ORDER BY id
    `;
    const result = await db.query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /api/pricing-categories]', err);
    res.status(500).json({ error: 'Eroare server' });
  }
});


// 🔓 Citire: agent & driver (și evident admin / operator_admin)
// ✍️ Scriere: doar admin & operator_admin




// ✅ Dacă e operator_admin, impunem operator_id-ul lui pe toate operațiile
router.use((req, _res, next) => {
  if (req.user?.role === 'operator_admin') {
    const opId = String(req.user.operator_id || '');
    // Forțăm operator_id în query
    if (req.query && typeof req.query === 'object') {
      req.query.operator_id = opId;
    }
    // Forțăm operator_id și în body (create/update)
    if (req.body && typeof req.body === 'object') {
      req.body.operator_id = Number(opId);
    }
  }
  next();
});


// ✅ Asocieri categorie de preț ↔ orare (administrare)
router.get(
  '/pricing-categories/schedules/all',
  requireAuth,
  requireRole('admin', 'operator_admin'),
  async (_req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT rs.id, r.name AS route_name, rs.departure, rs.direction
          FROM route_schedules rs
          JOIN routes r ON r.id = rs.route_id
         ORDER BY r.name, rs.departure
      `);
      res.json(rows);
    } catch (err) {
      console.error('[GET /api/pricing-categories/schedules/all]', err);
      res.status(500).json({ error: 'Eroare la interogarea DB' });
    }
  }
);

router.get(
  '/pricing-categories/:categoryId/schedules',
  requireAuth,
  requireRole('admin', 'operator_admin'),
  async (req, res) => {
    const categoryId = Number(req.params.categoryId);
    if (!categoryId) {
      return res.status(400).json({ error: 'ID categorie invalid' });
    }

    try {
      const { rows } = await db.query(
        `SELECT route_schedule_id FROM route_schedule_pricing_categories WHERE pricing_category_id = ?`,
        [categoryId]
      );
      res.json(rows.map(r => r.route_schedule_id));
    } catch (err) {
      console.error('[GET /api/pricing-categories/:id/schedules]', err);
      res.status(500).json({ error: 'Eroare la interogarea DB' });
    }
  }
);

router.put(
  '/pricing-categories/:categoryId/schedules',
  requireAuth,
  requireRole('admin', 'operator_admin'),
  async (req, res) => {
    const categoryId = Number(req.params.categoryId);
    const { scheduleIds } = req.body;

    if (!categoryId || !Array.isArray(scheduleIds)) {
      return res.status(400).json({ error: 'Date invalide' });
    }

    const uniqueIds = Array.from(new Set(scheduleIds.map(id => Number(id)).filter(Boolean)));

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      await conn.execute(
        'DELETE FROM route_schedule_pricing_categories WHERE pricing_category_id = ?',
        [categoryId]
      );

      for (const schedId of uniqueIds) {
        await conn.execute(
          `INSERT INTO route_schedule_pricing_categories (route_schedule_id, pricing_category_id)
           VALUES (?, ?)`,
          [schedId, categoryId]
        );
      }

      await conn.commit();
      conn.release();
      res.sendStatus(204);
    } catch (err) {
      await conn.rollback();
      conn.release();
      console.error('[PUT /api/pricing-categories/:id/schedules]', err);
      res.status(500).json({ error: 'Nu s-au putut salva asocierile' });
    }
  }
);



// ✅ GET /api/price-lists
// ✅ GET /api/price-lists — CITIRE pentru admin/op_admin/agent/driver
router.get('/price-lists', requireAuth, requireRole('admin', 'operator_admin', 'agent', 'driver'), async (req, res) => {
  const { route, category, date } = req.query;

  try {
    if (route && category && date) {
      const sql = `
  SELECT id, name, version,
         DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from
    FROM price_lists
   WHERE route_id = ?
     AND category_id = ?
     AND effective_from <= DATE(?)
   ORDER BY effective_from DESC
`;
      const { rows } = await db.query(sql, [route, category, date]);
      return res.json(rows);            // ← IMPORTANT: return
    }

    const sqlAll = `
  SELECT id, name, version,
         DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from,
         route_id, category_id, created_by, created_at
    FROM price_lists
   ORDER BY effective_from DESC
`;
    const { rows: allRows } = await db.query(sqlAll);
    return res.json(allRows);           // ← și aici return (opțional, dar curat)
  } catch (err) {
    console.error('[GET /api/price-lists]', err);
    res.status(500).json({ error: 'Eroare server' });
  }
});



// ✅ GET /api/price-lists/:id/items — CITIRE pentru admin/op_admin/agent/driver
router.get('/price-lists/:id/items', requireAuth, requireRole('admin', 'operator_admin', 'agent', 'driver'), async (req, res) => {
  const listId = Number(req.params.id);
  try {
    const routeRes = await db.query('SELECT route_id FROM price_lists WHERE id = ?', [listId]);
    const routeId = routeRes.rows?.[0]?.route_id ?? null;

    const sql = `
  SELECT
    pli.id,
    pli.price_list_id,
    pl.route_id,
    pli.from_station_id,
    s1.name AS from_stop,
    pli.to_station_id,
    s2.name AS to_stop,
    pli.price,
    pli.price_return,
    pli.currency
  FROM price_list_items pli
  JOIN price_lists pl ON pl.id = pli.price_list_id
  LEFT JOIN stations s1 ON s1.id = pli.from_station_id
  LEFT JOIN stations s2 ON s2.id = pli.to_station_id
  WHERE pli.price_list_id = ?
  ORDER BY s1.name, s2.name, pli.id
`;
    const { rows } = await db.query(sql, [listId]);
    res.json(rows);
  } catch (err) {
    console.error('[GET /api/price-lists/:id/items]', err);
    res.status(500).json({ error: 'Eroare server' });
  }
});

// ✅ POST /api/price-lists — SCRIERE doar admin/op_admin
router.post('/price-lists', requireAuth, requireRole('admin', 'operator_admin'), async (req, res) => {
  const { route, category, effective_from, name, version, items, created_by } = req.body;

  if (!route || !category || !created_by) {
    return res.status(400).json({ error: 'route, category și created_by sunt obligatorii' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [exist] = await conn.execute(
      `SELECT id FROM price_lists
    WHERE route_id=? AND category_id=? AND effective_from=DATE(?)
    LIMIT 1`,
      [route, category, effective_from]
    );

    let listId;
    if (exist.length) {
      listId = exist[0].id;
      await conn.execute('UPDATE price_lists SET name=?, version=? WHERE id=?', [name, version, listId]);
      await conn.execute('DELETE FROM price_list_items WHERE price_list_id=?', [listId]);
    } else {
      const [insert] = await conn.execute(
        `INSERT INTO price_lists
     (name, version, effective_from, route_id, category_id, created_by)
   VALUES (?, ?, DATE(?), ?, ?, ?)`,
        [name, version, effective_from, route, category, created_by]
      );
      listId = insert.insertId;
    }

    // mapare stații
    const [stations] = await conn.execute(`
      SELECT s.id AS station_id, s.name
        FROM route_stations rs
        JOIN stations s ON s.id = rs.station_id
       WHERE rs.route_id = ?`,
      [route]
    );
    const map = new Map();
    stations.forEach(r => map.set(r.name, r.station_id));

    for (const it of items) {
      const from_station_id = it.from_station_id ?? map.get(it.from_stop ?? '') ?? null;
      const to_station_id = it.to_station_id ?? map.get(it.to_stop ?? '') ?? null;
      const price = it.price ?? null;
      const priceReturn = it.price_return ?? null;
      await conn.execute(
        `INSERT INTO price_list_items
           (price_list_id, from_station_id, to_station_id, price, price_return, currency)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [listId, from_station_id, to_station_id, price, priceReturn ?? null, it.currency ?? 'RON']
      );
    }

    await conn.commit();
    res.json({ id: listId });
  } catch (err) {
    await conn.rollback();
    console.error('[POST /api/price-lists]', err);
    res.status(500).json({ error: 'Eroare server' });
  } finally {
    conn.release();
  }
});

// ✅ PUT /api/price-lists/:id — SCRIERE doar admin/op_admin
router.put('/price-lists/:id', requireAuth, requireRole('admin', 'operator_admin'), async (req, res) => {
  const listId = req.params.id;
  const { effective_from, name, version, items } = req.body;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE price_lists
      SET name=?,
          version=?,
          effective_from=DATE(?)
    WHERE id=?`,
      [name, version, effective_from, listId]
    );

    await conn.execute('DELETE FROM price_list_items WHERE price_list_id=?', [listId]);

    const [rRoute] = await conn.execute('SELECT route_id FROM price_lists WHERE id=?', [listId]);
    const routeId = rRoute[0]?.route_id;

    const [stations] = await conn.execute(`
      SELECT s.id AS station_id, s.name
        FROM route_stations rs
        JOIN stations s ON s.id = rs.station_id
       WHERE rs.route_id = ?`,
      [routeId]
    );
    const map = new Map();
    stations.forEach(r => map.set(r.name, r.station_id));

    for (const it of items) {
      const from_station_id = it.from_station_id ?? map.get(it.from_stop ?? '') ?? null;
      const to_station_id = it.to_station_id ?? map.get(it.to_stop ?? '') ?? null;
      const price = it.price ?? null;
      const priceReturn = it.price_return ?? null;
      await conn.execute(
        `INSERT INTO price_list_items
           (price_list_id, from_station_id, to_station_id, price, price_return, currency)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [listId, from_station_id, to_station_id, price, priceReturn ?? null, it.currency ?? 'RON']
      );
    }

    await conn.commit();
    res.sendStatus(204);
  } catch (err) {
    await conn.rollback();
    console.error('[PUT /api/price-lists/:id]', err);
    res.status(500).json({ error: 'Eroare server' });
  } finally {
    conn.release();
  }
});

// ✅ DELETE /api/price-lists/:id — SCRIERE doar admin/op_admin
router.delete('/price-lists/:id', requireAuth, requireRole('admin', 'operator_admin'), async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM price_list_items WHERE price_list_id=?', [id]);
    await db.query('DELETE FROM price_lists WHERE id=?', [id]);
    res.sendStatus(204);
  } catch (err) {
    console.error('[DELETE /api/price-lists/:id]', err);
    res.status(500).json({ error: 'Eroare server' });
  }
});

// ✅ POST /api/price-lists/:id/copy-opposite — SCRIERE doar admin/op_admin
router.post('/price-lists/:id/copy-opposite', requireAuth, requireRole('admin','operator_admin'), async (req, res) => {
  const srcId = Number(req.params.id);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [srcRows] = await conn.execute(
      `SELECT id FROM price_lists WHERE id=? LIMIT 1`,
      [srcId]
    );
    if (!srcRows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Lista sursă inexistentă' });
    }

    const [items] = await conn.execute(
      'SELECT id, from_station_id, to_station_id, price, price_return, currency FROM price_list_items WHERE price_list_id=?',
      [srcId]
    );

    const byKey = new Map();
    for (const item of items) {
      const key = `${item.from_station_id}-${item.to_station_id}`;
      byKey.set(key, item);
    }

    let mirrored = 0;

    for (const item of items) {
      // 1) NU mai suprascriem returul existent; completăm doar dacă e NULL
      await conn.execute(
        'UPDATE price_list_items SET price_return = COALESCE(price_return, ?) WHERE id = ?',
        [item.price, item.id]
      );

      // 2) Sărim diagonala (ex: 1→1)
      if (item.from_station_id === item.to_station_id) {
        continue;
      }

      const reverseKey = `${item.to_station_id}-${item.from_station_id}`;
      const reverse = byKey.get(reverseKey);

      if (reverse) {
        // 3) Pe rândul invers completăm DOAR câmpurile NULL (nu rescriem ce ai setat diferit)
        await conn.execute(
          `
          UPDATE price_list_items
             SET price = COALESCE(price, ?),
                 price_return = COALESCE(price_return, ?)
           WHERE id = ?
          `,
          [item.price, item.price, reverse.id]
        );
        reverse.price = reverse.price ?? item.price;
        reverse.price_return = reverse.price_return ?? item.price;
      } else {
        // 4) Dacă nu există inversul, îl creăm fără să forțăm price_return
        const [insert] = await conn.execute(
          `
          INSERT INTO price_list_items
            (price_list_id, from_station_id, to_station_id, price, price_return, currency)
          VALUES (?, ?, ?, ?, ?, ?)
          `,
          [srcId, item.to_station_id, item.from_station_id, item.price, null, item.currency]
        );
        mirrored += 1;
        byKey.set(reverseKey, {
          id: insert.insertId,
          from_station_id: item.to_station_id,
          to_station_id: item.from_station_id,
          price: item.price,
          price_return: null,
          currency: item.currency,
        });
      }
    }

    await conn.commit();
    res.json({ id: srcId, mirrored, normalized: items.length });
  } catch (err) {
    await conn.rollback();
    console.error('[POST /api/price-lists/:id/copy-opposite]', err);

    res.status(500).json({ error: 'Eroare server' });
  } finally {
    conn.release();
  }
});

module.exports = router;
