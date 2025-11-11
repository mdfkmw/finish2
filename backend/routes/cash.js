// backend/routes/cash.js
require('dotenv').config();
const express = require('express');
const router  = express.Router();
const db      = require('../db');


const { requireAuth, requireRole } = require('../middleware/auth');

// ✅ Acces DOAR pentru admin și operator_admin
router.use(requireAuth, requireRole('admin', 'operator_admin'));

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


 const FISCAL_URL = process.env.FISCAL_PRINTER_URL || '';
 const FISCAL_ON  = String(process.env.FISCAL_ENABLED || 'true').toLowerCase() === 'true';
 const FISCAL_TO  = Number(process.env.FISCAL_TIMEOUT_MS || 6000);




/**
 * GET /api/cash/unsettled?employeeId=1
 * Returnează ce bani are de predat agentul (DOAR CASH, nepredați), grupați pe operator.
 */
router.get('/unsettled', async (req, res) => {
  try {
    const employeeId = Number(req.query.employeeId);
    if (!employeeId) return res.status(400).json({ error: 'employeeId required' });

    const sql = `
      SELECT 
        o.id AS operator_id,
        o.name AS operator_name,
        COUNT(p.id) AS payments_count,
        IFNULL(SUM(p.amount), 0) AS total_amount,
        GROUP_CONCAT(p.id) AS payment_ids
      FROM payments p
      JOIN reservations r ON r.id = p.reservation_id
      JOIN trips t ON t.id = r.trip_id
      JOIN route_schedules rs ON rs.id = t.route_schedule_id
      JOIN operators o ON o.id = rs.operator_id
      WHERE 
        p.status = 'paid'
        AND p.payment_method = 'cash'
        AND p.cash_handover_id IS NULL
        AND p.collected_by = ?
      GROUP BY o.id, o.name
      ORDER BY o.name;
    `;

    const result = await db.query(sql, [employeeId]);
    res.json(result.rows);
  } catch (e) {
    console.error('[GET /api/cash/unsettled]', e);
    res.status(500).json({ error: 'Failed to fetch unsettled cash' });
  }
});




/* ============================================================================
   POST /api/cash/receipt
   Trimite bon către bridge-ul fiscal (server.js).
   Body: { reservationId, amount, description }
   ENV:  FISCAL_PRINTER_URL = http://host:port/print
============================================================================ */
router.post('/receipt', async (req, res) => {
  try {
    const { reservationId, amount, description } = req.body || {};
    const url = FISCAL_URL;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Suma lipsă sau invalidă' });
    }
    if (!FISCAL_ON || !url) {
      return res.json({ ok: true, printed: false, reason: 'FISCAL_PRINTER_URL not set' });
    }

    const payload = {
      amount: Number(amount),
      paymentType: 'cash',
      description: description || (reservationId ? `Rezervare #${reservationId}` : 'Plată cash')
    };

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FISCAL_TO)
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    // Acceptăm succes DOAR dacă avem ok:true (sau status/printed pozitiv)
    const okFromService =
      r.ok &&
      (data?.ok === true || data?.printed === true || data?.status === 'ok');

    if (!okFromService) {
      // normalizează mesajul de eroare (coduri gen -102002, -111016 din bridge)
      const code = data?.code ?? data?.errorCode ?? data?.errCode ?? null;
      const message = data?.message ?? data?.error ?? 'Fiscal service error';
      return res.status(502).json({
        ok: false,
        printed: false,
        error: message,
        code,
        details: data
      });
    }

    return res.json({ ok: true, printed: true, data });
  } catch (err) {
    console.error('[POST /api/cash/receipt]', err);
    return res.status(500).json({ ok: false, printed: false, error: 'Eroare la trimiterea bonului' });
  }
});





/**
 * POST /api/cash/handovers/preda
 * Body: { "employeeId": 1 }
 * Creează handover-uri (câte unul per operator) și marchează plățile ca predate.
 */
router.post('/handovers/preda', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const employeeId = Number(req.body.employeeId);
    if (!employeeId) {
      conn.release();
      return res.status(400).json({ error: 'employeeId required' });
    }

    await conn.beginTransaction();

    // Selectăm plățile eligibile
    const operatorIdsRaw = Array.isArray(req.body.operatorIds) ? req.body.operatorIds : [];
    const operatorIds = [...new Set(
      operatorIdsRaw
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )];

    const params = [employeeId];
    let operatorFilter = '';
    if (operatorIds.length) {
      operatorFilter = ` AND o.id IN (${operatorIds.map(() => '?').join(',')})`;
      params.push(...operatorIds);
    }

    const [eligible] = await conn.execute(
      `
      SELECT
        o.id AS operator_id,
        IFNULL(SUM(p.amount),0) AS total_amount,
        GROUP_CONCAT(p.id) AS payment_ids
      FROM payments p
      JOIN reservations r ON r.id = p.reservation_id
      JOIN trips t ON t.id = r.trip_id
      JOIN route_schedules rs ON rs.id = t.route_schedule_id
      JOIN operators o ON o.id = rs.operator_id
      WHERE
        p.status = 'paid'
        AND p.payment_method = 'cash'
        AND p.cash_handover_id IS NULL
        AND p.collected_by = ?
        ${operatorFilter}
      GROUP BY o.id;
      `,
      params
    );

    const results = [];

    for (const row of eligible) {
      const operatorId = row.operator_id;
      const totalAmount = Number(row.total_amount);
      const paymentIds = (row.payment_ids || '').split(',').map(id => parseInt(id));

      if (paymentIds.length === 0) continue;

      // 1️⃣ Inserăm handover
      const [ins] = await conn.execute(
        `INSERT INTO cash_handovers (employee_id, operator_id, amount, created_at)
         VALUES (?, ?, ?, NOW())`,
        [employeeId, operatorId, totalAmount]
      );
      const handoverId = ins.insertId;

      // 2️⃣ Actualizăm plățile cu handoverId
      await conn.execute(
        `UPDATE payments SET cash_handover_id = ? WHERE id IN (${paymentIds.join(',')})`,
        [handoverId]
      );

      results.push({
        handoverId,
        operatorId,
        amount: totalAmount,
        paymentsCount: paymentIds.length,
        createdAt: new Date().toISOString()
      });
    }

    await conn.commit();
    conn.release();
    res.json({ ok: true, handovers: results });
  } catch (e) {
    await conn.rollback();
    conn.release();
    console.error('[POST /api/cash/handovers/preda]', e);
    res.status(500).json({ error: 'Failed to handover cash' });
  }
});

/**
 * GET /api/cash/handovers/history?employeeId=1
 * Istoric predări ale agentului curent
 */
router.get('/handovers/history', async (req, res) => {
  try {
    const employeeId = Number(req.query.employeeId);
    if (!employeeId) return res.status(400).json({ error: 'employeeId required' });

    const sql = `
      SELECT
        ch.id,
        ch.created_at,
        ch.operator_id,
        o.name AS operator_name,
        ch.amount,
        COUNT(p.id) AS payments_count
      FROM cash_handovers ch
      JOIN operators o ON o.id = ch.operator_id
      LEFT JOIN payments p ON p.cash_handover_id = ch.id
      WHERE ch.employee_id = ?
      GROUP BY ch.id, ch.created_at, ch.operator_id, o.name, ch.amount
      ORDER BY ch.created_at DESC;
    `;

    const result = await db.query(sql, [employeeId]);
    res.json(result.rows);
  } catch (e) {
    console.error('[GET /api/cash/handovers/history]', e);
    res.status(500).json({ error: 'Failed to fetch handover history' });
  }
});

module.exports = router;
