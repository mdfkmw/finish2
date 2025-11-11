const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// ✅ GET /api/operators — lista operatorilor, ordonată alfabetic
//    (acces pentru toți utilizatorii AUTENTIFICAȚI, inclusiv agent)
router.get('/', requireAuth, async (_req, res) => {
 try {
    const result = await db.query(
      'SELECT id, name, pos_endpoint, theme_color FROM operators ORDER BY name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Eroare la GET /api/operators:', err);
    res.status(500).json({ error: 'Eroare la interogarea bazei de date' });
  }
});

module.exports = router;
