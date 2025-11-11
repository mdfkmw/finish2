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


// ✅ Returnează lista agențiilor din tabela `agencies`
router.get('/', async (_req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name FROM agencies ORDER BY name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /api/agencies]', err);
    res.status(500).json({ error: 'Eroare la interogarea bazei de date' });
  }
});

module.exports = router;
