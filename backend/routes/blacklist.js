const express = require('express');
const router = express.Router();
const db = require('../db');
const { randomUUID } = require('crypto');


const { requireAuth, requireRole } = require('../middleware/auth');

// 🔒 Toate cer autentificare
router.use(requireAuth);


// ── helper audit: person.* (blacklist / no-show)
async function logPersonEvent(personId, action, actorId, details = {}) {
  try {
    const correlation_id = details?.correlation_id || randomUUID();
    const channel = details?.channel || (['admin','operator_admin','agent','driver'].includes(details?.role) ? 'agent' : null);
    const related_entity = details?.related_entity || null;
    const related_id = details?.related_id || null;
    const amount = null, payment_method = null, transaction_id = null;
    const note = details?.note || null;
    await db.query(`
      INSERT INTO audit_logs
        (created_at, actor_id, entity, entity_id, action, related_entity, related_id,
         correlation_id, channel, amount, payment_method, transaction_id, note, before_json, after_json)
      VALUES (NOW(), ?, 'person', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `, [Number(actorId) || null, Number(personId) || null, action, related_entity, related_id, correlation_id, channel, amount, payment_method, transaction_id, note]);
  } catch (e) {
    console.warn('[audit person] failed', e.message);
  }
}



// ✅ Adaugă persoană în blacklist
//   permis: admin, operator_admin, agent (NU driver)
router.post('/blacklist', requireRole('admin','operator_admin','agent'), async (req, res) => {
  const { person_id, reason } = req.body;
  const employee_id = Number(req.user?.id) || null;

  if (!person_id) {
    return res.status(400).json({ error: 'person_id lipsă' });
  }

  try {
    const existing = await db.query(
      'SELECT id FROM blacklist WHERE person_id = ?',
      [person_id]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Persoana este deja în blacklist' });
    }

    await db.query(
      'INSERT INTO blacklist (person_id, reason, added_by_employee_id) VALUES (?, ?, ?)',
      [person_id, reason || '', employee_id]
    );

   // audit: adăugare în blacklist
    await logPersonEvent(person_id, 'person.blacklist.add', employee_id, {
      role: req.user?.role,
      note: reason || ''
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Eroare blacklist:', err);
    res.status(500).json({ error: 'Eroare server' });
  }
});

// ✅ Marchează neprezentare
//   permis: admin, operator_admin, agent, driver (inclusiv șofer)
router.post('/no-shows', requireRole('admin','operator_admin','agent','driver'), async (req, res) => {
  const { reservation_id } = req.body;
  const employee_id = Number(req.user?.id) || null;

  if (!reservation_id) {
    return res.status(400).json({ error: 'reservation_id missing' });
  }

  try {
    const rRes = await db.query(
      `SELECT person_id, trip_id, seat_id, board_station_id, exit_station_id
         FROM reservations
        WHERE id = ?`,
      [reservation_id]
    );
    if (rRes.rowCount !== 1) {
      return res.status(404).json({ error: 'reservation not found' });
    }

    const { person_id, trip_id, seat_id, board_station_id, exit_station_id } = rRes.rows[0];

    // INSERT IGNORE — echivalent cu "ON CONFLICT DO NOTHING"
    await db.query(
      `INSERT IGNORE INTO no_shows
       (reservation_id, person_id, trip_id, seat_id, board_station_id, exit_station_id, added_by_employee_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [reservation_id, person_id, trip_id, seat_id, board_station_id, exit_station_id, employee_id]
    );

    // audit: no-show adăugat (legat de rezervare)
    await logPersonEvent(person_id, 'person.noshow.add', employee_id, {
      role: req.user?.role,
      related_entity: 'reservation',
      related_id: reservation_id,
      note: `trip_id=${trip_id};seat_id=${seat_id};board_station_id=${board_station_id};exit_station_id=${exit_station_id}`
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Eroare la /no-shows:', err);
    res.status(500).json({ error: 'Eroare server' });
  }
});

// ─── Verifică blacklist + ultimele 5 neprezentări pentru un telefon ───
router.get('/blacklist/check', async (req, res) => {
  const rawPhone = req.query.phone || '';
  const digits = rawPhone.replace(/\D/g, '');

  if (digits.length < 10) {
    return res.json({ blacklisted: false, reason: null, blacklist_history: [], no_shows: [] });
  }

  try {
    // 🔁 nou: găsește deținătorul ACTIV direct în people (telefonul e deja normalizat în backend)
    const ownerRes = await db.query(
      `SELECT id
         FROM people
        WHERE phone = ? AND owner_status = 'active'
        LIMIT 1`,
      [digits]
    );
    const person_id = (ownerRes.rows || ownerRes)?.[0]?.id;

    // ✅ MODIFICAT: dacă nu există owner ACTIV, căutăm deținătorii PENDING ai aceluiași număr
    if (!person_id) {
      const [pendingPeople] = await db.query(
        `SELECT id, name, blacklist
           FROM people
          WHERE phone = ? AND owner_status = 'pending'
          ORDER BY updated_at DESC`,
        [digits]
      );
      if (Array.isArray(pendingPeople) && pendingPeople.length > 0) {
        const pendingIds = pendingPeople.map(p => p.id);
        const [pendingNoShows] = await db.query(
          `SELECT COUNT(*) AS cnt
             FROM no_shows
            WHERE person_id IN (?)`,
          [pendingIds]
        );
        const totalNoShows = Number(pendingNoShows?.[0]?.cnt || 0);
        const anyBlacklist = pendingPeople.some(p => Number(p.blacklist) === 1);
        return res.json({
          phone: digits,
          // nu există person_id activ aici
          blacklisted: anyBlacklist,
          is_blacklisted: anyBlacklist,
          reason: null,
          blacklist_history: [],
          no_shows: [],
          noShows: [],
          no_shows_count: totalNoShows,
          // semnale pentru UI din pending
          pendingHasBlacklist: anyBlacklist,
          pendingNoShowsCount: totalNoShows
        });
      }
      // nici activ, nici pending → răspuns curat
      return res.json({
        phone: digits,
        blacklisted: false,
        is_blacklisted: false,
        reason: null,
        blacklist_history: [],
        no_shows: [],
        noShows: [],
        no_shows_count: 0
      });
    }

    const blRes = await db.query(
      'SELECT created_at, reason FROM blacklist WHERE person_id = ? ORDER BY created_at DESC LIMIT 1',
      [person_id]
    );

    const blHistoryRes = await db.query(
      'SELECT created_at, reason FROM blacklist WHERE person_id = ? ORDER BY created_at DESC LIMIT 5',
      [person_id]
    );

    const showsRes = await db.query(
      `SELECT
         DATE_FORMAT(ns.created_at, '%d.%m.%Y') AS date,
         DATE_FORMAT(t.time, '%H:%i')           AS hour,
         r.name                                 AS route_name,
         ns.board_station_id,
         ns.exit_station_id,
         bs.name                                AS board_name,
         es.name                                AS exit_name,
         ns.trip_id,
         ns.seat_id,
         s.label                                AS seat_label
       FROM no_shows ns
       JOIN trips     t  ON t.id = ns.trip_id
       JOIN routes    r  ON r.id = t.route_id
       LEFT JOIN seats     s  ON s.id  = ns.seat_id
       LEFT JOIN stations  bs ON bs.id = ns.board_station_id
       LEFT JOIN stations  es ON es.id = ns.exit_station_id
      WHERE ns.person_id = ?
      ORDER BY ns.created_at DESC
      LIMIT 10`,
      [person_id]
    );

    const blacklisted = (blRes.rows?.length || 0) > 0;
    const noShowsArr  = Array.isArray(showsRes.rows) ? showsRes.rows : [];
    res.json({
      person_id,
      // denumiri compatibile cu UI-ul vechi și nou:
      blacklisted,                 // bool
      is_blacklisted: blacklisted, // alias
      reason: blRes.rows?.[0]?.reason || null,
      blacklist_history: blHistoryRes.rows || [],
      no_shows: noShowsArr,        // array
      noShows: noShowsArr,         // alias
      no_shows_count: noShowsArr.length
    });
  } catch (err) {
    console.error('Eroare la blacklist/check:', err);
    res.status(500).json({ error: 'server error' });
  }
});

// ─── Listare combinate: blacklist + cei marcați neprezentări ───
router.get('/blacklist', async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT bl.id AS blacklist_id,
             p.id  AS person_id,
             p.name AS person_name,
             p.phone,
             e.name AS added_by_employee,
             bl.reason,
             DATE_FORMAT(bl.created_at, '%d.%m.%Y %H:%i') AS added_at,
             'blacklist' AS source
      FROM blacklist bl
      JOIN people p ON p.id = bl.person_id
      LEFT JOIN employees e ON e.id = bl.added_by_employee_id
      UNION ALL
      SELECT NULL AS blacklist_id,
             p.id,
             p.name,
             p.phone,
             COALESCE(e2.name, '—') AS added_by_employee,
             CONCAT('Neprezentări: ', COUNT(*)) AS reason,
             DATE_FORMAT(MAX(ns.created_at), '%d.%m.%Y %H:%i') AS added_at,
             'no_show' AS source
      FROM no_shows ns
      JOIN people p ON p.id = ns.person_id
      LEFT JOIN employees e2 ON e2.id = ns.added_by_employee_id
      LEFT JOIN blacklist bl ON bl.person_id = p.id
      WHERE bl.id IS NULL
      GROUP BY p.id, p.name, p.phone, e2.name
      ORDER BY added_at DESC;
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Eroare la listare blacklist:', err);
    res.status(500).json({ error: 'server error' });
  }
});

// ─── Ștergere intrare blacklist după ID ───
//   permis: admin, operator_admin, agent (NU driver)
router.delete('/blacklist/:id', requireRole('admin','operator_admin','agent'), async (req, res) => {
  const { id } = req.params;
  try {
    // află person_id înainte de ștergere
    const q = await db.query('SELECT person_id FROM blacklist WHERE id = ?', [id]);
    const person_id = q.rows?.[0]?.person_id || null;
   const del = await db.query('DELETE FROM blacklist WHERE id = ?', [id]);
    if (del.rowCount === 0) {
      return res.status(404).json({ error: 'Blacklist entry not found' });
    }
    // audit: scoatere din blacklist
    await logPersonEvent(person_id, 'person.blacklist.remove', Number(req.user?.id) || null, {
      role: req.user?.role,
      note: `blacklist_id=${id}`
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Eroare la ștergere blacklist:', err);
    res.status(500).json({ error: 'server error' });
  }
});

// ✅ Șterge toate no-shows pentru o persoană
//   permis: admin, operator_admin, agent, driver (inclusiv șoferul poate șterge no-show)
router.delete('/no-shows/:person_id', requireRole('admin','operator_admin','agent','driver'), async (req, res) => {
  const { person_id } = req.params;
  try {
    const cntQ = await db.query('SELECT COUNT(*) AS c FROM no_shows WHERE person_id = ?', [person_id]);
    const c = Number((cntQ.rows?.[0]?.c) || 0);
    await db.query('DELETE FROM no_shows WHERE person_id = ?', [person_id]);
    // audit: no-shows șterse (bulk)
    await logPersonEvent(person_id, 'person.noshow.remove', Number(req.user?.id) || null, {
      role: req.user?.role,
      note: `deleted_count=${c}`
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Eroare la ștergere no-shows:', err);
    res.status(500).json({ error: 'server error' });
  }
});

// ✅ Returnează ID-urile rezervărilor marcate ca no-show pentru o cursă
router.get('/no-shows/:tripId', async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  try {
    const result = await db.query(
      'SELECT reservation_id FROM no_shows WHERE trip_id = ?',
      [tripId]
    );
    res.json(result.rows.map(r => r.reservation_id));
  } catch (err) {
    console.error('Eroare la GET /no-shows/:tripId', err);
    res.status(500).json({ error: 'server error' });
  }
});


// ➕ Listă no-shows agregată pe persoană (pentru pagina de Admin)
router.get('/no-shows', async (_req, res) => {
  try {
    const rows = await db.query(`
      SELECT ns.person_id,
             p.name,
             p.phone,
             COUNT(*) AS total,
             DATE_FORMAT(MAX(ns.created_at), '%d.%m.%Y %H:%i') AS last_date
      FROM no_shows ns
      JOIN people p ON p.id = ns.person_id
      GROUP BY ns.person_id, p.name, p.phone
      ORDER BY last_date DESC
    `);
    const data = rows.rows || rows; // compat driver
    res.json(data);
  } catch (err) {
    console.error('Eroare la GET /no-shows', err);
    res.status(500).json({ error: 'server error' });
  }
});


module.exports = router;
