// db.js — MariaDB (mysql2/promise) cu adaptor compatibil "pg"
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.MDB_HOST,
  user: process.env.MDB_USER,
  password: process.env.MDB_PASS,
  database: process.env.MDB_NAME,
  port: Number(process.env.MDB_PORT || 3306),
  connectionLimit: 10,
  multipleStatements: false,
  charset: 'utf8mb4',
  decimalNumbers: true,
  // returnează DATETIME/TIMESTAMP ca string, fără conversii implicite la UTC
  dateStrings: true
});

// Adaptor ca să mimeze API-ul pg: pool.query() => { rows, rowCount, insertId }
const adapter = {
  async query(sql, params = []) {
    const [res] = await pool.execute(sql, params);

    if (Array.isArray(res)) {
      return { rows: res, rowCount: res.length, insertId: null, raw: res };
    }

    return {
      rows: [],
      rowCount: typeof res.affectedRows === 'number' ? res.affectedRows : 0,
      insertId: typeof res.insertId === 'number' ? res.insertId : null,
      raw: res
    };
  },

  async getConnection() {
    return pool.getConnection();
  },

  pool
};

module.exports = adapter;


// ─────────────────────────────────────────────────────────────────────────────
// Setează TZ pe fiecare conexiune din pool -> Europe/Bucharest (fallback la +HH:MM)
// ─────────────────────────────────────────────────────────────────────────────
try {
  // calculează offset local curent (+02:00 / +03:00, ține cont de DST)
  const mins = -new Date().getTimezoneOffset(); // ex: 180 pentru +03:00
  const sign = mins >= 0 ? '+' : '-';
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const offsetStr = `${sign}${pad(Math.abs(mins) / 60)}:${pad(Math.abs(mins) % 60)}`;

  const attachHandler = (conn) => {
    // IMPORTANT: 'conn' aici este varianta callback-based (non-promise)!
    // Folosim API-ul cu callback, nu .then/.catch.
    conn.query("SET time_zone = 'Europe/Bucharest'", (err) => {
      if (err) {
        conn.query(`SET time_zone = '${offsetStr}'`, () => { /* ignore */ });
      }
    });
  };

  // mysql2/promise Pool emite 'connection' (uneori sub .pool). Acoperim ambele.
  if (typeof pool.on === 'function') {
    pool.on('connection', attachHandler);
  }
  if (pool.pool && typeof pool.pool.on === 'function') {
    pool.pool.on('connection', attachHandler);
  }
} catch (_) {
  // nu blocăm aplicația dacă evenimentul nu e disponibil într-o versiune de driver
}