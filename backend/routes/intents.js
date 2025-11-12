const express = require('express');
const db = require('../db');

const router = express.Router();

const INTENT_TTL_SECONDS = Number(process.env.RESERVATION_INTENT_TTL_SECONDS || 90);
const CLEANUP_INTERVAL_MS = 60_000;

const { ensureIntentOwner } = require('../utils/intentOwner');
const { loadOnlineSettings, evaluateBookingWindow } = require('../utils/onlineSettings');

function normalizeId(value) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function getOwnerId(req, res) {
  const { ownerId } = ensureIntentOwner(req, res);
  if (Number.isInteger(ownerId)) return ownerId;
  return null;
}

async function cleanupExpiredIntents() {
  try {
    await db.query('DELETE FROM reservation_intents WHERE expires_at <= NOW()');
  } catch (err) {
    console.error('[reservation_intents] cleanup failed', err);
  }
}

setInterval(() => {
  cleanupExpiredIntents();
}, CLEANUP_INTERVAL_MS).unref?.();

cleanupExpiredIntents();

router.post('/', async (req, res) => {
  const tripId = normalizeId(req.body?.trip_id);
  const seatId = normalizeId(req.body?.seat_id);
  if (!tripId || !seatId) {
    return res.status(400).json({ error: 'Lipsesc trip_id sau seat_id' });
  }

  const ownerId = getOwnerId(req, res);

  try {
    const tripMeta = await db.query(
      `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS trip_date,
              DATE_FORMAT(time, '%H:%i')   AS trip_time,
              boarding_started
         FROM trips
        WHERE id = ?
        LIMIT 1`,
      [tripId]
    );
    const tripRow = tripMeta.rows?.[0] || null;
    if (!tripRow) {
      return res.status(404).json({ error: 'Cursa nu există.' });
    }
    if (Number(tripRow.boarding_started)) {
      return res.status(409).json({ error: 'Îmbarcarea a început pentru această cursă. Rezervările nu mai sunt disponibile.' });
    }
    try {
      const settings = await loadOnlineSettings();
      const windowCheck = evaluateBookingWindow({
        date: tripRow.trip_date,
        time: tripRow.trip_time,
        settings,
        includeLeadTime: true,
        includeMaxAdvance: true,
        now: new Date(),
      });
      if (!windowCheck.allowed) {
        return res.status(409).json({ error: windowCheck.reason || 'Rezervările pentru această cursă sunt închise.' });
      }
    } catch (settingsErr) {
      console.warn('[reservation_intents] online settings check failed', settingsErr);
    }

    const existing = await db.query(
      `SELECT id, user_id FROM reservation_intents WHERE trip_id = ? AND seat_id = ? LIMIT 1`,
      [tripId, seatId]
    );

    if (!existing.rows.length) {
      const insert = await db.query(
        `INSERT INTO reservation_intents (trip_id, seat_id, user_id, expires_at)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
        [tripId, seatId, ownerId, INTENT_TTL_SECONDS]
      );
      const { rows } = await db.query(
        `SELECT trip_id, seat_id, expires_at FROM reservation_intents WHERE id = ?`,
        [insert.insertId]
      );
      const row = rows[0];
      return res.json({
        trip_id: Number(row.trip_id),
        seat_id: Number(row.seat_id),
        expires_at: row.expires_at,
      });
    }

    const intent = existing.rows[0];
    const existingUserId = intent.user_id === null ? null : Number(intent.user_id);
    const normalizedIncoming = ownerId ?? null;

    const sameUser = existingUserId === normalizedIncoming;
    if (!sameUser && existingUserId !== null) {
      return res.status(409).json({ error: 'Loc în curs de rezervare' });
    }

    await db.query(
      `UPDATE reservation_intents
          SET expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
              user_id = ?
        WHERE id = ?`,
      [INTENT_TTL_SECONDS, normalizedIncoming, intent.id]
    );

    const { rows } = await db.query(
      `SELECT trip_id, seat_id, expires_at FROM reservation_intents WHERE id = ?`,
      [intent.id]
    );
    const row = rows[0];
    return res.json({
      trip_id: Number(row.trip_id),
      seat_id: Number(row.seat_id),
      expires_at: row.expires_at,
    });
  } catch (err) {
    console.error('[POST /api/intents] error', err);
    return res.status(500).json({ error: 'Eroare la crearea intentului' });
  }
});

router.delete('/:tripId/:seatId', async (req, res) => {
  const tripId = normalizeId(req.params.tripId);
  const seatId = normalizeId(req.params.seatId);
  if (!tripId || !seatId) {
    return res.status(400).json({ error: 'Parametri invalizi' });
  }

  const ownerId = getOwnerId(req, res);

  try {
    let sql = 'DELETE FROM reservation_intents WHERE trip_id = ? AND seat_id = ?';
    const params = [tripId, seatId];
    if (ownerId !== null) {
      sql += ' AND (user_id <=> ? OR user_id IS NULL)';
      params.push(ownerId);
    }
    await db.query(sql, params);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/intents/:tripId/:seatId] error', err);
    return res.status(500).json({ error: 'Eroare la ștergerea intentului' });
  }
});

router.get('/', async (req, res) => {
  const tripId = normalizeId(req.query?.trip_id);
  if (!tripId) {
    return res.status(400).json({ error: 'trip_id este obligatoriu' });
  }

  const ownerId = getOwnerId(req, res);
  try {
    const { rows } = await db.query(
      `SELECT seat_id, expires_at, user_id
         FROM reservation_intents
        WHERE trip_id = ?
          AND expires_at > NOW()
        ORDER BY seat_id`,
      [tripId]
    );

    const payload = rows.map((row) => {
      const rowOwnerId = row.user_id === null ? null : Number(row.user_id);
      const isMine = rowOwnerId === (ownerId ?? null) ? 1 : 0;
      return {
        seat_id: Number(row.seat_id),
        expires_at: row.expires_at,
        is_mine: isMine,
      };
    });

    return res.json(payload);
  } catch (err) {
    console.error('[GET /api/intents] error', err);
    return res.status(500).json({ error: 'Eroare la listarea intentelor' });
  }
});

module.exports = router;

module.exports.cleanupExpiredIntents = cleanupExpiredIntents;
