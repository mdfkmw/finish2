// backend/routes/userPrefs.js — preferințe per utilizator/agent (MariaDB)
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// toate rutele de aici cer autentificare
router.use(requireAuth);

/* GET /api/user/route-order
   -> [{ route_id, position_idx }, ...] */
router.get('/route-order', async (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  const { rows } = await db.query(
    'SELECT route_id, position_idx FROM user_route_order WHERE user_id = ? ORDER BY position_idx ASC',
    [userId]
  );
  res.json(rows);
});

/* PUT /api/user/route-order
   body: { order: [{ route_id, position_idx }, ...] } */
router.put('/route-order', async (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  const order = Array.isArray(req.body?.order) ? req.body.order : [];
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM user_route_order WHERE user_id = ?', [userId]);

    for (const item of order) {
      const rId = Number(item.route_id);
      const pos = Number(item.position_idx);
      if (!rId || !pos) continue;
      await conn.execute(
        'INSERT INTO user_route_order (user_id, route_id, position_idx) VALUES (?, ?, ?)',
        [userId, rId, pos]
      );
    }

    await conn.commit();
    conn.release();
    res.sendStatus(204);
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('PUT /api/user/route-order', err);
    res.status(500).json({ error: 'internal error' });
  }
});

/* GET /api/user/preferences
   -> { prefs_json }  (sau {} dacă nu există) */
router.get('/preferences', async (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  const { rows } = await db.query(
    'SELECT prefs_json FROM user_preferences WHERE user_id = ? LIMIT 1',
    [userId]
  );
  res.json(rows[0]?.prefs_json || {});
});

/* PUT /api/user/preferences
   body: { ... orice … }  => stocat ca JSON complet */
router.put('/preferences', async (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  const json = req.body && typeof req.body === 'object' ? req.body : {};
  await db.query(
    `INSERT INTO user_preferences (user_id, prefs_json)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE prefs_json = VALUES(prefs_json)`,
    [userId, JSON.stringify(json)]
  );
  res.sendStatus(204);
});

module.exports = router;
