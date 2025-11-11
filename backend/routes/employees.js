const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');



// ✅ LIST — acces pentru ORICE utilizator AUTENTIFICAT (agent inclus)
// // 🔹 LIST — admin: tot; operator_admin: doar operatorul propriu (impus)
router.get('/', requireAuth, async (req, res) => {
  let { operator_id, agency_id, active = '1', role } = req.query;
  try {
    // Dacă e operator_admin, ignorăm ce vine din query și impunem operatorul propriu
    if (req.scopeOperatorId) {
      operator_id = String(req.scopeOperatorId);
    }
    // Caz 2: filtrare agent activ
    const clauses = [];
    const params = [];

    if (operator_id) {
      params.push(operator_id);
      clauses.push(`operator_id = ?`);
    }
    if (agency_id) {
      params.push(agency_id);
      clauses.push(`agency_id = ?`);
    }

    if (active !== 'all') {
      params.push(active === '0' ? 0 : 1);
      clauses.push(`active = ?`);
    }
    if (role) {
      params.push(role);
      clauses.push(`role = ?`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const sql = `
      SELECT *
        FROM employees
       ${where}
       ORDER BY name ASC
    `;

    const result = await db.query(sql, params);
    const rows = result.rows ?? result[0] ?? result ?? [];
    res.json(rows);
  } catch (err) {
    console.error('GET /employees error:', err);
    res.status(500).json({ error: 'Eroare la interogare DB' });
  }
});

router.use(requireAuth, requireRole('admin','operator_admin'));


// 🔹 CREATE — adaugă angajat
router.post('/', async (req, res) => {
  let { name, username = null, phone = null, email = null, role, operator_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Numele este obligatoriu' });
  if (username) {
    username = String(username).trim() || null;
  }

  try {
    // Operator_admin poate crea doar în operatorul propriu
    if (req.scopeOperatorId) {
      operator_id = Number(req.scopeOperatorId);
    }

    const result = await db.query(
      `INSERT INTO employees (name, username, phone, email, role, operator_id, active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [name, username, phone, email, role, operator_id]
    );

    const inserted = await db.query('SELECT * FROM employees WHERE id = ?', [result.insertId]);
    res.status(201).json(inserted.rows[0]);
  } catch (err) {
    console.error('POST /employees error:', err);

    if (err.errno === 1062) {
      return res.status(409).json({ error: 'Telefonul, emailul și username-ul trebuie să fie unice' });
    }
    if (err.errno === 1452) {
      return res.status(400).json({ error: 'operator_id invalid' });
    }

    res.status(500).json({ error: 'Eroare la inserare DB' });
  }
});

// 🔹 UPDATE — actualizează un angajat
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  let { name, username = null, phone = null, email = null, role, operator_id, active } = req.body;

  if (!name) return res.status(400).json({ error: 'Numele este obligatoriu' });
  if (username) {
    username = String(username).trim() || null;
  }

  try {
    const result = await db.query(
      `UPDATE employees
          SET name=?, username=?, phone=?, email=?, role=?, operator_id=?, active=?
        WHERE id=?`,
      [name, username, phone, email, role, operator_id, active ? 1 : 0, id]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Angajat inexistent' });

    const updated = await db.query('SELECT * FROM employees WHERE id = ?', [id]);
    res.json(updated.rows[0]);
  } catch (err) {
    console.error('PUT /employees error:', err);

    if (err.errno === 1062) {
      return res.status(409).json({ error: 'Telefonul, emailul și username-ul trebuie să fie unice' });
    }

    res.status(500).json({ error: 'Eroare la actualizare DB' });
  }
});

// 🔹 PATCH — active/inactive
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { active } = req.body;

  try {
    let sql = `UPDATE employees SET active = ? WHERE id = ?`;
    const params = [active ? 1 : 0, id];
    if (req.scopeOperatorId) {
      sql += ` AND operator_id = ?`;
      params.push(Number(req.scopeOperatorId));
    }
    const result = await db.query(sql, params);

    if (result.rowCount === 0) return res.status(404).json({ error: 'Angajat inexistent' });

    const updated = await db.query('SELECT * FROM employees WHERE id = ?', [id]);
    res.json(updated.rows[0]);
  } catch (err) {
    console.error('PATCH /employees error:', err);
    res.status(500).json({ error: 'Eroare la actualizare DB' });
  }
});

// 🔹 DELETE — soft delete (marchează inactiv)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    let sql = `UPDATE employees SET active = 0 WHERE id = ?`;
    const params = [id];
    if (req.scopeOperatorId) {
      sql += ` AND operator_id = ?`;
      params.push(Number(req.scopeOperatorId));
    }
    const result = await db.query(sql, params);

    if (result.rowCount === 0) return res.status(404).json({ error: 'Angajat inexistent' });

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /employees error:', err);
    res.status(500).json({ error: 'Eroare la actualizare DB' });
  }
});

module.exports = router;
