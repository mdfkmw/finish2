const express = require('express');
const router = express.Router();
const db = require('../db');

const { requireAuth, requireRole } = require('../middleware/auth');

// ✅ Acces: admin, operator_admin, agent (NU driver)
router.use(requireAuth, requireRole('admin', 'operator_admin', 'agent'));


// helper compatibil cu wrapperul tău db.query (întoarce direct rows)
async function q(sql, params) {
  const res = await db.query(sql, params);
  if (Array.isArray(res)) {
    // ex. [rows, fields]
    if (Array.isArray(res[0])) return res[0];
    if (res[0]?.rows) return res[0].rows;
    return res;
  }
  // ex. { rows, rowCount, ... }
  if (res?.rows) return res.rows;
  if (res?.raw)  return res.raw;
  return res;
}



router.get('/lookup', async (req, res) => {
  try {
    const phone = String(req.query.phone || '').replace(/\s+/g, '').trim();
    console.log('[phones/lookup] IN phone =', JSON.stringify(phone));
    if (!phone) return res.json({ phone_id: null, current_owner: null, previous_owners: [] });

 const pn = await q(
   'SELECT id FROM phone_numbers WHERE TRIM(e164) = TRIM(?) COLLATE utf8mb4_general_ci LIMIT 1',
   [phone]
 );
 console.log('[phones/lookup] PN rows =', pn);
    if (!pn.length) return res.json({ phone_id: null, current_owner: null, previous_owners: [] });
    const phoneId = pn[0].id;

    const cur = await q(`
 SELECT pp.person_id, pe.name,
        IFNULL(pe.blacklist, 0) AS blacklisted,
             (SELECT COUNT(*) FROM no_shows ns WHERE ns.person_id = pe.id) AS no_shows
      FROM person_phones pp
      JOIN people pe ON pe.id = pp.person_id
      WHERE pp.phone_id=? AND pp.status='current'
      LIMIT 1
    `, [phoneId]);

    const prev = await q(`
 SELECT pp.person_id, pe.name, pp.status,
        IFNULL(pe.blacklist, 0) AS blacklisted,
             (SELECT COUNT(*) FROM no_shows ns WHERE ns.person_id = pe.id) AS no_shows
      FROM person_phones pp
      JOIN people pe ON pe.id = pp.person_id
      WHERE pp.phone_id=? AND pp.status IN ('previous','suspected_previous')
      ORDER BY pp.updated_at DESC
    `, [phoneId]);

    res.json({
      phone_id: phoneId,
      current_owner: cur[0] || null,
      previous_owners: prev || []
   });
  } catch (e) {
    console.error('[phones/lookup] error', e);
    res.status(500).json({ error: 'server error' });
  }
});

router.post('/attachCurrent', async (req, res) => {
  const { phone, person, note } = req.body || {};
  if (!phone || !person) return res.status(400).json({ error: 'phone and person required' });

  const conn = await (db.getConnection?.() || db);
  try {
    if (conn.beginTransaction) await conn.beginTransaction();

    const phoneId = (await q('SELECT id FROM phone_numbers WHERE TRIM(e164)=TRIM(?) LIMIT 1', [phone]))[0]?.id
      ?? (await conn.query('INSERT INTO phone_numbers(e164) VALUES (?)', [phone])).insertId;

    // retrogradează actualul curent (dacă există)
    await conn.query(
      "UPDATE person_phones SET status='suspected_previous', note=? WHERE phone_id=? AND status='current'",
      [note || 'auto demote from current', phoneId]
    );

    // id persoană (creează dacă lipsește)
    let personId = person.id;
    if (!personId) {
      const ins = await conn.query('INSERT INTO people(name, phone) VALUES (?, ?)', [person.name || '', phone]);
      personId = ins.insertId;
    }

    // setează ca 'current' (upsert simplu)
    await conn.query(
      `INSERT INTO person_phones(person_id, phone_id, status, note)
       VALUES (?, ?, 'current', ?)
       ON DUPLICATE KEY UPDATE status='current', note=VALUES(note)`,
      [personId, phoneId, note || null]
    );

    if (conn.commit) await conn.commit();
    res.json({ success: true, phone_id: phoneId, person_id: personId });
  } catch (e) {
    try { if (conn.rollback) await conn.rollback(); } catch {}
    console.error('[phones/attachCurrent] error', e);
    res.status(500).json({ error: 'server error' });
  } finally {
    conn.release?.();
  }
});


router.post('/hidePrevious', async (req, res) => {
  const { phone_id, person_id, note } = req.body || {};
  if (!phone_id || !person_id) return res.status(400).json({ error: 'phone_id and person_id required' });

  const r = await db.query(
    "UPDATE person_phones SET status='hidden', note=? WHERE phone_id=? AND person_id=? AND status IN ('previous','suspected_previous')",
    [note || 'hidden by agent', phone_id, person_id]
  );
  if (!r.affectedRows) return res.status(404).json({ error: 'relation not found or already hidden' });
  res.json({ success: true });
});


module.exports = router;
