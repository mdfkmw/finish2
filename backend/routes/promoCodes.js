// backend/routes/promoCodes.js
const express = require('express');
const db = require('../db');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');

// ✅ Doar admin și operator_admin au acces la administrarea codurilor promo
router.use(requireAuth, requireRole('admin', 'operator_admin'));

// ✅ Dacă e operator_admin, impunem operator_id-ul lui pe toate operațiile
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


function toHHMM(s) {
  if (!s) return null;
  // acceptă "HH:MM" sau "HH:MM:SS" și întoarce "HH:MM"
  const v = String(s).slice(0, 5);
  return v;
}

// ───────────────────────── LIST ─────────────────────────
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM promo_codes ORDER BY id DESC');
    const rows = result.rows || [];

    // atașăm sumar de scope (counts), dar dacă lipsesc tabelele → 0 (fără eroare)
    for (const r of rows) {
      let routes = 0, schedules = 0, hours = 0, weekdays = 0;
      try {
        const rc = await db.query('SELECT COUNT(*) AS c FROM promo_code_routes WHERE promo_code_id=?', [r.id]);
        routes = rc.rows?.[0]?.c ?? 0;
      } catch {}
      try {
        const sc = await db.query('SELECT COUNT(*) AS c FROM promo_code_schedules WHERE promo_code_id=?', [r.id]);
        schedules = sc.rows?.[0]?.c ?? 0;
      } catch {}
      try {
        const hc = await db.query('SELECT COUNT(*) AS c FROM promo_code_hours WHERE promo_code_id=?', [r.id]);
        hours = hc.rows?.[0]?.c ?? 0;
      } catch {}
      try {
        const wc = await db.query('SELECT COUNT(*) AS c FROM promo_code_weekdays WHERE promo_code_id=?', [r.id]);
        weekdays = wc.rows?.[0]?.c ?? 0;
      } catch {}
      r._scope = { routes, schedules, hours, weekdays };
    }

    res.json(rows);
  } catch (err) {
    // dacă nu există nici măcar promo_codes, întoarcem listă goală (UI-ul rămâne funcțional)
    console.warn('GET /api/promo-codes fallback → []:', err.message);
    res.json([]);
 }
});

// ───────────────────────── CREATE ─────────────────────────
router.post('/', async (req, res) => {
  const {
    code, label, type, value_off,
    valid_from, valid_to, active = 1,
    channels = 'online', min_price, max_discount,
    max_total_uses, max_uses_per_person, combinable = 0,
    route_ids = [], route_schedule_ids = [],
    hours = [], weekdays = []
  } = req.body || {};

  const CODE = String(code || '').trim().toUpperCase();
  if (!CODE || !label || !type || value_off === undefined || value_off === null) {
    return res.status(400).json({ error: 'Câmpuri lipsă' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const ins = await conn.query(
      `INSERT INTO promo_codes
       (code,label,type,value_off,valid_from,valid_to,active,channels,min_price,max_discount,
        max_total_uses,max_uses_per_person,combinable)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        CODE, label, type, Number(value_off),
        valid_from || null, valid_to || null, Number(active),
        channels, min_price || null, max_discount || null,
        max_total_uses || null, max_uses_per_person || null, Number(combinable)
      ]
    );
    // mysql2: conn.query() => [result]; wrapper: => {insertId}
    const promoId = (ins && ins.insertId !== undefined) ? ins.insertId : ins?.[0]?.insertId;
    if (!promoId) throw new Error('Nu am putut obține insertId pentru promo_codes');

    if (Array.isArray(route_ids) && route_ids.length) {
      await conn.query(
        `INSERT INTO promo_code_routes (promo_code_id, route_id)
         VALUES ${route_ids.map(() => '(?,?)').join(',')}`,
        route_ids.flatMap((rid) => [promoId, rid])
      );
    }

    if (Array.isArray(route_schedule_ids) && route_schedule_ids.length) {
      await conn.query(
        `INSERT INTO promo_code_schedules (promo_code_id, route_schedule_id)
         VALUES ${route_schedule_ids.map(() => '(?,?)').join(',')}`,
        route_schedule_ids.flatMap((sid) => [promoId, sid])
      );
    }

    if (Array.isArray(hours) && hours.length) {
      const vals = [];
      for (const h of hours) vals.push(promoId, toHHMM(h.start), toHHMM(h.end));
      await conn.query(
        `INSERT INTO promo_code_hours (promo_code_id, start_time, end_time)
         VALUES ${hours.map(() => '(?,?,?)').join(',')}`,
        vals
      );
    }

    if (Array.isArray(weekdays) && weekdays.length) {
      await conn.query(
        `INSERT INTO promo_code_weekdays (promo_code_id, weekday)
         VALUES ${weekdays.map(() => '(?,?)').join(',')}`,
        weekdays.flatMap((w) => [promoId, w])
      );
    }

    await conn.commit();
    res.json({ id: promoId });
  } catch (err) {
    await conn.rollback();
    console.error('POST /api/promo-codes error:', err);
    res.status(500).json({ error: 'Eroare la creare cod promo' });
  } finally {
    conn.release();
  }
});

// ───────────────────────── UPDATE ─────────────────────────
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    label, type, value_off, valid_from, valid_to, active,
    channels, min_price, max_discount, max_total_uses, max_uses_per_person, combinable,
    route_ids = [], route_schedule_ids = [], hours = [], weekdays = []
  } = req.body || {};

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `UPDATE promo_codes SET
         label=?, type=?, value_off=?, valid_from=?, valid_to=?, active=?,
         channels=?, min_price=?, max_discount=?, max_total_uses=?, max_uses_per_person=?, combinable=?
       WHERE id=?`,
      [
        label, type, Number(value_off),
        valid_from || null, valid_to || null, Number(active),
        channels, min_price || null, max_discount || null,
        max_total_uses || null, max_uses_per_person || null, Number(combinable),
        id
      ]
    );

    // reset scope și re-inserăm
    await conn.query('DELETE FROM promo_code_routes WHERE promo_code_id=?', [id]);
    await conn.query('DELETE FROM promo_code_schedules WHERE promo_code_id=?', [id]);
    await conn.query('DELETE FROM promo_code_hours WHERE promo_code_id=?', [id]);
    await conn.query('DELETE FROM promo_code_weekdays WHERE promo_code_id=?', [id]);

    if (Array.isArray(route_ids) && route_ids.length) {
      await conn.query(
        `INSERT INTO promo_code_routes (promo_code_id, route_id)
         VALUES ${route_ids.map(() => '(?,?)').join(',')}`,
        route_ids.flatMap((rid) => [id, rid])
      );
    }

    if (Array.isArray(route_schedule_ids) && route_schedule_ids.length) {
      await conn.query(
        `INSERT INTO promo_code_schedules (promo_code_id, route_schedule_id)
         VALUES ${route_schedule_ids.map(() => '(?,?)').join(',')}`,
        route_schedule_ids.flatMap((sid) => [id, sid])
      );
    }

    if (Array.isArray(hours) && hours.length) {
      const vals = [];
      for (const h of hours) vals.push(id, toHHMM(h.start), toHHMM(h.end));
      await conn.query(
        `INSERT INTO promo_code_hours (promo_code_id, start_time, end_time)
         VALUES ${hours.map(() => '(?,?,?)').join(',')}`,
        vals
      );
    }

    if (Array.isArray(weekdays) && weekdays.length) {
      await conn.query(
        `INSERT INTO promo_code_weekdays (promo_code_id, weekday)
         VALUES ${weekdays.map(() => '(?,?)').join(',')}`,
        weekdays.flatMap((w) => [id, w])
      );
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error('PUT /api/promo-codes/:id error:', err);
    res.status(500).json({ error: 'Eroare la modificare cod promo' });
  } finally {
    conn.release();
  }
});

// ───────────────────────── TOGGLE ─────────────────────────
router.patch('/:id/toggle', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('UPDATE promo_codes SET active = 1 - active WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/promo-codes/:id/toggle error:', err);
    res.status(500).json({ error: 'Eroare la activare/dezactivare' });
  }
});

// ───────────────────────── DELETE ─────────────────────────
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // ON DELETE CASCADE deja curăță scope + usages dacă ai FK-urile setate
    await db.query('DELETE FROM promo_codes WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/promo-codes/:id error:', err);
    res.status(500).json({ error: 'Eroare la ștergere cod promo' });
  }
});

// ───────────────────────── VALIDATE ─────────────────────────
router.post('/validate', async (req, res) => {
  try {
    const {
      code, route_id, route_schedule_id, date, time, channel,
      price_value, phone
    } = req.body || {};

    const CODE = String(code || '').trim().toUpperCase();
    if (!CODE) return res.json({ valid: false, reason: 'Cod lipsă' });

    const q1 = await db.query(
      `SELECT * FROM promo_codes
       WHERE UPPER(code)=? AND active=1
         AND (valid_from IS NULL OR NOW() >= valid_from)
         AND (valid_to   IS NULL OR NOW() <= valid_to)`,
      [CODE]
    );
    const promo = q1.rows?.[0];
    if (!promo) return res.json({ valid: false, reason: 'Cod inexistent sau expirat' });

    // canal
    const allowedChannels = (promo.channels || '')
      .split(',')
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);
    const normalizedChannel = String(channel || '').trim().toLowerCase();
    const currentChannel = normalizedChannel === 'agent' ? 'agent' : 'online';
    if (allowedChannels.length && !allowedChannels.includes(currentChannel)) {
      return res.json({ valid: false, reason: 'Cod nevalabil pe acest canal' });
    }

    // scope rute
    const cntR = await db.query('SELECT COUNT(*) AS c FROM promo_code_routes WHERE promo_code_id=?', [promo.id]);
    if ((cntR.rows?.[0]?.c ?? 0) > 0) {
      const okR = await db.query(
        'SELECT COUNT(*) AS c FROM promo_code_routes WHERE promo_code_id=? AND route_id=?',
        [promo.id, route_id || 0]
      );
      if (!((okR.rows?.[0]?.c ?? 0) > 0)) {
        return res.json({ valid: false, reason: 'Nu e valabil pe acest traseu' });
      }
    }

    // scope orar (schedule)
    const cntS = await db.query('SELECT COUNT(*) AS c FROM promo_code_schedules WHERE promo_code_id=?', [promo.id]);
    if ((cntS.rows?.[0]?.c ?? 0) > 0) {
      const okS = await db.query(
        'SELECT COUNT(*) AS c FROM promo_code_schedules WHERE promo_code_id=? AND route_schedule_id=?',
        [promo.id, route_schedule_id || 0]
      );
      if (!((okS.rows?.[0]?.c ?? 0) > 0)) {
        return res.json({ valid: false, reason: 'Nu e valabil pe această oră' });
      }
    }

    // intervale orare zilnice
    const hhmm = toHHMM(time);
    const cntH = await db.query('SELECT COUNT(*) AS c FROM promo_code_hours WHERE promo_code_id=?', [promo.id]);
    if ((cntH.rows?.[0]?.c ?? 0) > 0) {
      const okH = await db.query(
        'SELECT COUNT(*) AS c FROM promo_code_hours WHERE promo_code_id=? AND ? BETWEEN start_time AND end_time',
        [promo.id, hhmm]
      );
      if (!((okH.rows?.[0]?.c ?? 0) > 0)) {
        return res.json({ valid: false, reason: 'Nu e în intervalul orar' });
      }
    }

    // zile săptămână (0..6)
    const dow = new Date(date).getDay();
    const cntW = await db.query('SELECT COUNT(*) AS c FROM promo_code_weekdays WHERE promo_code_id=?', [promo.id]);
    if ((cntW.rows?.[0]?.c ?? 0) > 0) {
      const okW = await db.query(
        'SELECT COUNT(*) AS c FROM promo_code_weekdays WHERE promo_code_id=? AND weekday=?',
        [promo.id, dow]
      );
      if (!((okW.rows?.[0]?.c ?? 0) > 0)) {
        return res.json({ valid: false, reason: 'Nu e valabil în această zi' });
      }
    }

    // limite utilizări
    const tot = await db.query('SELECT COUNT(*) AS c FROM promo_code_usages WHERE promo_code_id=?', [promo.id]);
    if (promo.max_total_uses && (tot.rows?.[0]?.c ?? 0) >= promo.max_total_uses) {
      return res.json({ valid: false, reason: 'Limită totală atinsă' });
    }
    if (phone) {
      const per = await db.query(
        'SELECT COUNT(*) AS c FROM promo_code_usages WHERE promo_code_id=? AND phone=?',
        [promo.id, phone]
      );
      if (promo.max_uses_per_person && (per.rows?.[0]?.c ?? 0) >= promo.max_uses_per_person) {
        return res.json({ valid: false, reason: 'Limită pe persoană atinsă' });
      }
    }

    // calcul reducere
    const base = Number(price_value || 0);
    if (promo.min_price && base < Number(promo.min_price)) {
      return res.json({ valid: false, reason: 'Sub pragul minim' });
    }

    let discount =
      promo.type === 'percent'
        ? +(base * (Number(promo.value_off) / 100)).toFixed(2)
        : +Number(promo.value_off);

    if (promo.max_discount) discount = Math.min(discount, Number(promo.max_discount));
    discount = Math.min(discount, base);

    res.json({
      valid: true,
      promo_code_id: promo.id,
      type: promo.type,
      value_off: Number(promo.value_off),
      discount_amount: Number(discount),
      combinable: !!promo.combinable
    });
  } catch (err) {
    console.error('POST /api/promo-codes/validate error:', err);
    res.status(500).json({ error: 'Eroare validare cod promo' });
  }
});

module.exports = router;
