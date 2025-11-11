const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
+// toți utilizatorii AUTENTIFICAȚI cu aceste roluri au voie aici
router.use(requireAuth, requireRole('admin','operator_admin','agent'));
/* ================================================================
   GET /api/trip-vehicles?trip_id=...
   Returnează toate vehiculele asociate unei curse (trip)
   ================================================================ */
router.get('/', async (req, res) => {
  const { trip_id } = req.query;
  if (!trip_id) return res.status(400).json({ error: 'trip_id este obligatoriu' });

  try {
    const sql = `
      SELECT 
        tv.id AS trip_vehicle_id,
        tv.trip_id,
        tv.vehicle_id,
        v.name AS vehicle_name,
        v.plate_number,
        v.operator_id,
        tv.is_primary,
        tv.notes
      FROM trip_vehicles tv
      JOIN vehicles v ON v.id = tv.vehicle_id
      WHERE tv.trip_id = ?
      ORDER BY tv.is_primary DESC, v.id
    `;
    const { rows } = await db.query(sql, [trip_id]);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/trip-vehicles error:', err);
    res.status(500).json({ error: 'Eroare la încărcarea vehiculelor cursei' });
  }
});

/* ================================================================
   POST /api/trip-vehicles
   Body: { trip_id, vehicle_id, is_primary }
   Adaugă un vehicul (dublură) la o cursă.
   ================================================================ */
router.post('/', async (req, res) => {
  const { trip_id, vehicle_id, is_primary } = req.body;
  if (!trip_id || !vehicle_id)
    return res.status(400).json({ error: 'trip_id și vehicle_id sunt obligatorii' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // verificăm dacă există deja combinația
    const [existing] = await conn.execute(
      `SELECT id FROM trip_vehicles WHERE trip_id = ? AND vehicle_id = ?`,
      [trip_id, vehicle_id]
    );
    if (existing.length) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ error: 'Vehiculul este deja asociat acestei curse.' });
    }

    // inserăm vehiculul
    const [insertRes] = await conn.execute(
      `INSERT INTO trip_vehicles (trip_id, vehicle_id, is_primary) VALUES (?, ?, ?)`,
      [trip_id, vehicle_id, is_primary ? 1 : 0]
    );
    const insertedId = insertRes.insertId;

    // dacă e primary, actualizăm trip-ul
    if (is_primary) {
      await conn.execute(`UPDATE trips SET vehicle_id = ? WHERE id = ?`, [vehicle_id, trip_id]);
    }

    await conn.commit();
    conn.release();

    const { rows } = await db.query(
      `SELECT tv.*, v.name AS vehicle_name, v.plate_number
       FROM trip_vehicles tv
       JOIN vehicles v ON v.id = tv.vehicle_id
       WHERE tv.id = ?`,
      [insertedId]
    );

    res.json(rows[0]);
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('POST /api/trip-vehicles error:', err);
    res.status(500).json({ error: 'Eroare la adăugarea vehiculului la cursă' });
  }
});

/* ================================================================
   PATCH /api/trip-vehicles/:tvId
   Body: { is_primary?, notes? }
   Actualizează informații despre vehiculul asociat cursei
   ================================================================ */
router.patch('/:tvId', async (req, res) => {
  const tvId = req.params.tvId;
  const { is_primary, notes } = req.body;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [tv] = await conn.execute(
      `SELECT trip_id, vehicle_id FROM trip_vehicles WHERE id = ?`,
      [tvId]
    );
    if (!tv.length) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ error: 'trip_vehicle inexistent' });
    }
    const { trip_id, vehicle_id } = tv[0];

    if (is_primary !== undefined) {
      // Resetăm toate celelalte vehicule la non-primary
      await conn.execute(
        `UPDATE trip_vehicles SET is_primary = 0 WHERE trip_id = ?`,
        [trip_id]
      );
      await conn.execute(`UPDATE trip_vehicles SET is_primary = 1 WHERE id = ?`, [tvId]);

      // Actualizăm câmpul vehicle_id din trips
      await conn.execute(`UPDATE trips SET vehicle_id = ? WHERE id = ?`, [vehicle_id, trip_id]);
    }

    if (notes !== undefined) {
      await conn.execute(`UPDATE trip_vehicles SET notes = ? WHERE id = ?`, [notes, tvId]);
    }

    await conn.commit();
    conn.release();

    const { rows } = await db.query(
      `SELECT tv.*, v.name AS vehicle_name, v.plate_number
       FROM trip_vehicles tv
       JOIN vehicles v ON v.id = tv.vehicle_id
       WHERE tv.id = ?`,
      [tvId]
    );

    res.json(rows[0]);
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('PATCH /api/trip-vehicles/:tvId error:', err);
    res.status(500).json({ error: 'Eroare la actualizarea vehiculului' });
  }
});

/* ================================================================
   DELETE /api/trip-vehicles/:tvId
   Șterge vehiculul dintr-o cursă (doar dacă nu are rezervări).
   ================================================================ */
router.delete('/:tvId', async (req, res) => {
  const tvId = req.params.tvId;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [tv] = await conn.execute(
      `SELECT trip_id, vehicle_id, is_primary FROM trip_vehicles WHERE id = ?`,
      [tvId]
    );
    if (!tv.length) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ error: 'trip_vehicle inexistent' });
    }

    const { trip_id, vehicle_id, is_primary } = tv[0];

    // verificăm rezervările pe acest vehicul
    const [rez] = await conn.execute(
      `SELECT COUNT(*) AS count
       FROM reservations r
       JOIN seats s ON s.id = r.seat_id
       WHERE r.trip_id = ? AND s.vehicle_id = ?`,
      [trip_id, vehicle_id]
    );
    if (rez[0].count > 0) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ error: 'Nu se poate șterge, există rezervări pe acest vehicul.' });
    }

    // ștergere efectivă
    await conn.execute(`DELETE FROM trip_vehicles WHERE id = ?`, [tvId]);

    // dacă era primary, actualizăm câmpul vehicle_id din trips la NULL
    if (is_primary) {
      await conn.execute(`UPDATE trips SET vehicle_id = NULL WHERE id = ?`, [trip_id]);
    }

    await conn.commit();
    conn.release();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('DELETE /api/trip-vehicles/:tvId error:', err);
    res.status(500).json({ error: 'Eroare la ștergerea vehiculului din cursă' });
  }
});

module.exports = router;
