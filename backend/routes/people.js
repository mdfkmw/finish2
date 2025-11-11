const express = require('express');
const router = express.Router();
const db = require('../db');


const { requireAuth, requireRole } = require('../middleware/auth');

// ✅ Acces: admin, operator_admin, agent (NU driver)
router.use(requireAuth, requireRole('admin', 'operator_admin', 'agent'));


// ✅ GET /api/people/history
router.get('/history', async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'phone missing' });

  try {
    // 🔹 1️⃣ găsește persoana
    const pRes = await db.query(
      'SELECT id, name, phone FROM people WHERE phone = ?',
      [phone]
    );
    if (pRes.rows.length === 0) {
      return res.json({ exists: false });
    }
    const person = pRes.rows[0];

    // 🔹 2️⃣ ultimele 5 rezervări (cu numele stațiilor)
    const rRes = await db.query(
      `SELECT
         r.board_station_id,
         r.exit_station_id,
         DATE_FORMAT(t.date, '%d.%m.%Y') AS date,
         DATE_FORMAT(t.time, '%H:%i')     AS hour,
         rt.name   AS route_name,
         s.label   AS seat_label,
         sb.name   AS board_name,
         se.name   AS exit_name
       FROM reservations r
       JOIN trips    t  ON t.id   = r.trip_id
       JOIN routes   rt ON rt.id  = t.route_id
       JOIN seats    s  ON s.id   = r.seat_id
       LEFT JOIN stations sb ON sb.id = r.board_station_id
       LEFT JOIN stations se ON se.id = r.exit_station_id
       WHERE r.person_id = ?
         AND r.status    = 'active'
       ORDER BY t.date DESC, t.time DESC
       LIMIT 5`,
      [person.id]
    );

    res.json({
      exists: true,
      name: person.name,
      history: rRes.rows
    });
  } catch (err) {
    console.error('Error /api/people/history:', err);
    res.status(500).json({ error: 'server error' });
  }
});




// ✅ POST /api/people  (creare rapidă persoană)
//Creează persoană minimă (pending) ca s-o putem seta activă imediat după
// body: { name, phone }
router.post('/', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const phone = String(req.body?.phone || '').trim();
    if (!phone) return res.status(400).json({ error: 'phone necesar' });
    // inserăm cu owner_status='pending' ca să nu ciocnim indexul (unicul active pe telefon)
    const r = await db.query(
      `INSERT INTO people (name, phone, owner_status)
       VALUES (?, ?, 'pending')`,
      [name || null, phone]
    );
    const insertId = r.insertId ?? r.rows?.[0]?.id;
    return res.json({ success: true, id: insertId });
  } catch (err) {
    console.error('[people create] error', err);
    res.status(500).json({ error: 'server error' });
  }
});



// ✅ POST /api/people/owner/set-active
// body: { person_id, phone, agent_id }
router.post('/owner/set-active', async (req, res) => {
  try {
    const person_id = Number(req.body?.person_id);
    const rawPhone = String(req.body?.phone || '');
    const agent_id = Number(req.user?.id) || null; // 🔹 autentificat real
    if (!person_id || !rawPhone) return res.status(400).json({ error: 'person_id și phone sunt necesare' });

    // normalizează telefonul (doar cifre)
    const phone = rawPhone.replace(/\D/g, '');
    if (!phone) return res.status(400).json({ error: 'telefon invalid' });

    // asigură-te că rândul "nou" are acest phone (dacă a fost creat fără el)
    await db.query(`UPDATE people SET phone=? WHERE id=?`, [phone, person_id]);

    // 1) dacă deja acest person_id e activ pe telefonul ăsta, nu mai face nimic
    const selfRes = await db.query(
      `SELECT id FROM people WHERE id=? AND phone=? AND owner_status='active' LIMIT 1`,
      [person_id, phone]
    );
    const selfActive = (selfRes.rows || selfRes)[0];
    if (selfActive) {
      return res.json({ success: true, alreadyActive: true });
    }

    // 2) găsește vechiul ACTIV pe același număr (dacă există)
    const oldRes = await db.query(
      `SELECT id FROM people WHERE phone=? AND owner_status='active' LIMIT 1`,
      [phone]
    );
    const oldActive = (oldRes.rows || oldRes)[0] || null;

    // 3) dacă există alt activ != person_id, trece-l pe pending
    if (oldActive && oldActive.id !== person_id) {
      await db.query(
        `UPDATE people
           SET owner_status='pending',
               replaced_by_id=?,
               owner_changed_by=?,
               owner_changed_at=NOW()
         WHERE id=?`,
        [person_id, agent_id, oldActive.id]
      );
    }

    // 4) setează NOUL ca 'active'
    try {
      await db.query(
        `UPDATE people
           SET owner_status='active',
               prev_owner_id=?,
               owner_changed_by=?,
               owner_changed_at=NOW()
         WHERE id=?`,
        [oldActive ? oldActive.id : null, agent_id, person_id]
      );
    } catch (e) {
      // dacă cumva a apărut alt activ concurent -> 409, ca să vedem clar în UI
      if (e && (e.code === 'ER_DUP_ENTRY' || e.errno === 1062)) {
        return res.status(409).json({ error: 'există deja un deținător activ pentru acest număr' });
      }
      throw e;
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('[owner/set-active] error', err);
    return res.status(500).json({ error: 'server error' });
  }
});

// ✅ POST /api/people/owner/confirm
// body: { phone, agent_id }  → toate pending pe acest telefon devin hidden
router.post('/owner/confirm', requireAuth, async (req, res) => {
  try {
    const phone = String(req.body?.phone || '');
    const agent_id = Number(req.user?.id) || null;
    if (!phone) return res.status(400).json({ error: 'phone necesar' });

    const r = await db.query(
      `UPDATE people
          SET owner_status='hidden',
              owner_changed_by=?,
              owner_changed_at=NOW()
        WHERE phone=? AND owner_status='pending'`,
      [agent_id, phone]
    );
    return res.json({ success: true, affected: r.affectedRows ?? r.rowCount ?? 0 });
  } catch (err) {
    console.error('[owner/confirm] error', err);
    res.status(500).json({ error: 'server error' });
  }
});

// ✅ GET /api/people/owner/status?phone=07...
// returnează active + pending (pt. popup)
router.get('/owner/status', async (req, res) => {
  try {
    const phone = String(req.query?.phone || '');
    if (!phone) return res.json({ phone: '', active: null, pending: [], suspect: false });

    const aRes = await db.query(
      `SELECT id, name, blacklist, owner_status, updated_at
         FROM people
        WHERE phone=? AND owner_status='active'
        LIMIT 1`,
      [phone]
    );
    const active = (aRes.rows || aRes)[0] || null;

    const pRes = await db.query(
      `SELECT id, name, blacklist, owner_status, updated_at
         FROM people
        WHERE phone=? AND owner_status='pending'
        ORDER BY updated_at DESC`,
      [phone]
    );
    const pending = (pRes.rows || pRes) || [];

    // atașează no-shows pt pending: COUNT + ultimele 5
    if (pending.length > 0) {
      const ids = pending.map(p => Number(p.id)).filter(Boolean);
      const ph = ids.map(() => '?').join(',');
      // total no-shows
      const nsCnt = await db.query(
        `SELECT person_id, COUNT(*) AS cnt
           FROM no_shows
          WHERE person_id IN (${ph})
          GROUP BY person_id`,
        ids
      );
      const cntMap = new Map((nsCnt.rows || nsCnt).map(r => [Number(r.person_id), Number(r.cnt)]));
      // ultimele 5 per persoană (extragem 50 și tăiem în JS)
      const nsList = await db.query(
        `SELECT ns.person_id,
                DATE_FORMAT(ns.created_at, '%d.%m.%Y') AS date,
                DATE_FORMAT(t.time, '%H:%i')           AS hour,
                r.name                                  AS route_name,
                ns.board_station_id                     AS board_station_id,
                ns.exit_station_id                      AS exit_station_id,
                ns.seat_id                               AS seat_id,
                s.label                                  AS seat_label
           FROM no_shows ns
           LEFT JOIN trips  t ON t.id = ns.trip_id
           LEFT JOIN routes r ON r.id = t.route_id
           LEFT JOIN seats  s ON s.id = ns.seat_id
          WHERE ns.person_id IN (${ph})
          ORDER BY ns.created_at DESC, ns.id DESC
          LIMIT 50`,
        ids
      );
      const grouped = new Map();
      for (const row of (nsList.rows || nsList)) {
        const pid = Number(row.person_id);
        if (!grouped.has(pid)) grouped.set(pid, []);
        if (grouped.get(pid).length < 5) grouped.get(pid).push(row);
      }
      for (const p of pending) {
        const pid = Number(p.id);
        p.no_shows_count = cntMap.get(pid) || 0;
        p.no_shows = grouped.get(pid) || [];
      }
    }

    // suspect dacă are BLACKLIST sau are no-shows
    const suspect = pending.some(x => Number(x.blacklist) === 1 || Number(x.no_shows_count || 0) > 0);
    res.json({ phone, active, pending, suspect });
  } catch (err) {
    console.error('[owner/status] error', err);
    res.status(500).json({ error: 'server error' });
  }
});




// ✅ GET /api/people/:id/report
router.get('/:id/report', async (req, res) => {
  const { id } = req.params;

  try {
    // 1️⃣ Persoană (nume, telefon, note)
    const personRes = await db.query(
      'SELECT name, phone, notes FROM people WHERE id = ?',
      [id]
    );
    const personRow = (personRes.rows || personRes)[0] || {};
    const personName = personRow.name || '';
    const personPhone = personRow.phone || '';
    const personNotes = personRow.notes || '';
    // 2️⃣ Rezervări + loc + segment (ID + nume stații) + creat la + cine a rezervat + preț & reduceri  
    const reservationsRes = await db.query(
      `SELECT
         r.id,
         s.label        AS seat_label,
         r.status                      AS status,
         t.date,
         t.time,
         rt.name        AS route_name,
         r.board_station_id,
         r.exit_station_id,
         COALESCE(sb.name, '')        AS board_name,
         COALESCE(se.name, '')        AS exit_name,
         r.reservation_time,
         COALESCE(e1.name, e2.name)   AS reserved_by,
         rp.booking_channel           AS booking_channel,
         (
           SELECT CASE WHEN SUM(p2.status = 'paid') > 0 THEN 'paid' ELSE NULL END
           FROM payments p2
           WHERE p2.reservation_id = r.id
         ) AS payment_status,
         (
           SELECT p3.payment_method
           FROM payments p3
           WHERE p3.reservation_id = r.id AND p3.status = 'paid'
           ORDER BY p3.timestamp DESC, p3.id DESC
           LIMIT 1
         ) AS payment_method,
         (
           SELECT SUM(CASE WHEN p4.status = 'paid' THEN p4.amount ELSE 0 END)
           FROM payments p4
           WHERE p4.reservation_id = r.id
         ) AS paid_amount,
         /* price_final = netul salvat în reservation_pricing */
         rp.price_value               AS price_final,
         /* discounts_total = suma reducerilor aplicate pe rezervare */
         (
           SELECT COALESCE(SUM(rd.discount_amount), 0)
           FROM reservation_discounts rd
           WHERE rd.reservation_id = r.id
         ) AS discounts_total,
         /* price_base = net + total reduceri (reconstruim baza) */
         (rp.price_value + (
           SELECT COALESCE(SUM(rd.discount_amount), 0)
           FROM reservation_discounts rd
           WHERE rd.reservation_id = r.id
         )) AS price_base,
         /* sumar reduceri: NumeReducere/PROMO  <sumă RON> ; ... */
         (
           SELECT GROUP_CONCAT(
                    TRIM(CONCAT(
                      COALESCE(dt.label, COALESCE(pc.code, '')),
                      ' ',
                      FORMAT(rd.discount_amount, 2),
                      ' RON'
                    )) SEPARATOR '; '
                  )
           FROM reservation_discounts rd
           LEFT JOIN discount_types dt ON dt.id = rd.discount_type_id
           LEFT JOIN promo_codes    pc ON pc.id = rd.promo_code_id
           WHERE rd.reservation_id = r.id
         ) AS discount_summary
       FROM reservations r
       JOIN trips   t   ON r.trip_id   = t.id
       JOIN routes  rt  ON t.route_id  = rt.id
       JOIN seats   s   ON r.seat_id   = s.id
       LEFT JOIN stations sb ON sb.id  = r.board_station_id
       LEFT JOIN stations se ON se.id  = r.exit_station_id
       LEFT JOIN employees e1 ON e1.id = r.created_by
       LEFT JOIN reservation_pricing rp ON rp.reservation_id = r.id
       LEFT JOIN employees e2 ON e2.id = rp.employee_id
     WHERE r.person_id = ?
       ORDER BY t.date DESC, t.time DESC`,
      [id]
    );

    // 3️⃣ Neprezentări — fiecare înregistrare, cu cine a marcat + segment
    const noShowsRes = await db.query(
      `SELECT
         ns.id,
         DATE_FORMAT(t.date, '%d.%m.%Y')            AS date,
         DATE_FORMAT(t.time, '%H:%i')               AS time,
         rt.name                                    AS route_name,
         s.label                                    AS seat_label,
         ns.board_station_id,
         ns.exit_station_id,
         sb.name                                    AS board_name,
         se.name                                    AS exit_name,
         e.name                                     AS marked_by,
         DATE_FORMAT(ns.created_at, '%d.%m.%Y %H:%i') AS marked_at
       FROM no_shows ns
       LEFT JOIN reservations r ON ns.reservation_id = r.id
       LEFT JOIN trips   t ON r.trip_id = t.id
       LEFT JOIN routes  rt ON t.route_id = rt.id
       LEFT JOIN seats   s ON r.seat_id = s.id
       LEFT JOIN stations sb ON sb.id = ns.board_station_id
       LEFT JOIN stations se ON se.id = ns.exit_station_id
       LEFT JOIN employees e ON e.id = ns.added_by_employee_id
       WHERE ns.person_id = ?
       ORDER BY t.date DESC, t.time DESC, ns.id DESC`,
      [id]
    );

    // 4️⃣ Blacklist (dacă există)
    const blacklistRes = await db.query(
      `SELECT b.reason,
              b.added_by_employee_id,
              DATE_FORMAT(b.created_at, '%d.%m.%Y %H:%i') AS created_at,
              e.name AS added_by_name
         FROM blacklist b
         LEFT JOIN employees e ON e.id = b.added_by_employee_id
        WHERE b.person_id = ?
        ORDER BY b.created_at DESC
        LIMIT 1`,
      [id]
    );

    // 5️⃣ Trimitem JSON-ul complet
    res.json({
      personName,
      personPhone,
      personNotes,
      reservations: (reservationsRes.rows || reservationsRes) || [],
      noShows: (noShowsRes.rows || noShowsRes) || [],
      blacklist: (blacklistRes.rows || blacklistRes)[0] || null
    });
  } catch (err) {
    console.error('Eroare la /api/people/:id/report:', err);
    res.status(500).json({ error: 'Eroare la generarea raportului' });
  }
});


// ✅ PUT /api/people/:id  — editare nume/telefon/notes
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const nameRaw  = (req.body?.name  ?? '').toString();
  const phoneRaw = (req.body?.phone ?? '').toString();
  const notesRaw = (req.body?.notes ?? '').toString();
  const name  = nameRaw.trim() || null;
  const phone = phoneRaw.replace(/\D/g, '') || null;  // doar cifre; '' -> null
  const notes = notesRaw; // permite șir gol
  try {
    if (!id) return res.status(400).json({ error: 'id lipsă' });
    // facem update explicit (setăm inclusiv NULL dacă e cazul)
    await db.query(
      `UPDATE people
         SET name = ?,
             phone = ?,
             notes = ?
       WHERE id = ?`,
      [name, phone, notes, id]
    );
    // întoarcem valorile actualizate
    const row = await db.query(`SELECT id, name, phone, COALESCE(notes,'') AS notes FROM people WHERE id=? LIMIT 1`, [id]);
    const person = (row.rows || row)[0] || null;
    res.json({ success: true, person });
 } catch (err) {
    // conflict de unicitate (dacă ai index unic pe telefon)
    if (err?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'acest număr de telefon este deja folosit de alt pasager' });
    }
    console.error('[people PUT] error', err);
    res.status(500).json({ error: 'server error' });
  }
});


// GET /api/people?q=&sort=name|phone&order=asc|desc&limit=25&offset=0
router.get('/', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const sort = (req.query.sort || 'name').toLowerCase() === 'phone' ? 'phone' : 'name';
    const order = (req.query.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 200);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

    const phoneDigits = q.replace(/\D/g, '');
    const params = [];
    let where = '1=1';

    if (q) {
      if (phoneDigits.length >= 3) {
        where = `(p.name LIKE ? OR REPLACE(REPLACE(REPLACE(p.phone,' ',''),'-',''),'.','') LIKE ?)`;
        params.push(`%${q}%`, `%${phoneDigits}%`);
      } else {
        where = `(p.name LIKE ?)`;
        params.push(`%${q}%`);
      }
    }

    // total
    const totalSql = `SELECT COUNT(*) AS total FROM people p WHERE ${where}`;
    const totalRows = await db.query(totalSql, params);
    const total = (totalRows.rows || totalRows)[0].total;

    // page
    const pageSql = `
      SELECT p.id, p.name, p.phone, COALESCE(p.notes,'') AS notes
      FROM people p
      WHERE ${where}
      ORDER BY ${sort === 'phone' ? 'p.phone' : 'p.name'} ${order}
      LIMIT ? OFFSET ?
    `;
    const pageRows = await db.query(pageSql, [...params, limit, offset]);
    res.json({ total, items: (pageRows.rows || pageRows) });
  } catch (e) {
    console.error('[GET /api/people] error', e);
    res.status(500).json({ error: 'server error' });
  }
});


module.exports = router;
