const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');




// ⬇️ Adăugări pentru upload
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const ALLOWED_ROLES = new Set(['admin', 'operator_admin', 'agent']);

// directorul unde salvăm imaginile
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext) ? ext : '.png';
    const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`;
    cb(null, name);
  }
});

const fileFilter = (_req, file, cb) => {
  if (!file.mimetype || !file.mimetype.startsWith('image/')) {
    return cb(new Error('Doar imagini sunt permise'));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});


async function ensureTable() {
  await db.query(
    `CREATE TABLE IF NOT EXISTS agent_chat_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      author_name VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL,
      content TEXT NULL,
      attachment_url TEXT NULL,
      attachment_type ENUM('image','link') NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

let tableEnsured = false;
async function ensureOnce() {
  if (!tableEnsured) {
    await ensureTable();
    tableEnsured = true;
  }
}

router.use(async (_req, _res, next) => {
  try {
    await ensureOnce();
  } catch (err) {
    console.error('[chat] failed to ensure table', err);
  }
  next();
});

router.use(requireAuth);

router.use((req, res, next) => {
  const role = req.user?.role;
  if (!ALLOWED_ROLES.has(role)) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[chat] acces interzis pentru rol=', role);
    }
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
});

function sanitizeContent(str) {
  if (typeof str !== 'string') return '';
  return str.trim();
}

function normalizeUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return trimmed;
  return null;
}

// Upload imagine
router.post('/upload', requireAuth, upload.single('image'), (req, res) => {
  const role = req.user?.role;
  if (!ALLOWED_ROLES.has(role)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Lipsește fișierul' });
  }
  // URL public servit din /uploads (configurat în server.js)
  const base = `${req.protocol}://${req.get('host')}`;
const publicUrl = `${base}/uploads/${req.file.filename}`;
  res.status(201).json({ url: publicUrl });
});

router.get('/messages', async (req, res) => {
  const afterId = req.query.afterId ? Number(req.query.afterId) : null;
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 100;

  const params = [];
  let where = '';
  if (Number.isInteger(afterId) && afterId > 0) {
    where = 'WHERE id > ?';
    params.push(afterId);
  }

  params.push(limit);

  const { rows } = await db.query(
    `SELECT id, user_id AS userId, author_name AS authorName, role, content, attachment_url AS attachmentUrl,
            attachment_type AS attachmentType, created_at AS createdAt
     FROM agent_chat_messages
     ${where}
     ORDER BY id ASC
     LIMIT ?`,
    params
  );

  res.json({ messages: rows || [] });
});

router.post('/messages', async (req, res) => {
  const user = req.user;
  const rawContent = sanitizeContent(req.body?.content);
  const attachmentType = req.body?.attachmentType;
  const rawUrl = normalizeUrl(req.body?.attachmentUrl);

  if (!rawContent && !rawUrl) {
    return res.status(400).json({ error: 'mesajul nu poate fi gol' });
  }

  if (rawContent && rawContent.length > 2000) {
    return res.status(400).json({ error: 'mesaj prea lung (max 2000 caractere)' });
  }

  let storedType = null;
  if (rawUrl) {
    if (rawUrl.length > 2048) {
      return res.status(400).json({ error: 'URL prea lung' });
    }
    if (attachmentType === 'image' || attachmentType === 'link') {
      storedType = attachmentType;
    } else {
      storedType = 'link';
    }
  }

  if (storedType === 'image') {
    const lower = rawUrl.toLowerCase();
    const isImage = /(\.png|\.jpe?g|\.gif|\.webp|\.svg)$/i.test(lower);
    if (!isImage) {
      return res.status(400).json({ error: 'URL imagine invalid' });
    }
  }

  const insertResult = await db.query(
    `INSERT INTO agent_chat_messages
      (user_id, author_name, role, content, attachment_url, attachment_type)
     VALUES (?, ?, ?, ?, ?, ?)` ,
    [
      user.id,
      user.name || 'Agent',
      user.role,
      rawContent || null,
      rawUrl,
      storedType,
    ]
  );

  const insertedId = insertResult.insertId;
  const { rows: insertedRows } = await db.query(
    `SELECT id, user_id AS userId, author_name AS authorName, role, content,
            attachment_url AS attachmentUrl, attachment_type AS attachmentType,
            created_at AS createdAt
     FROM agent_chat_messages WHERE id = ? LIMIT 1`,
    [insertedId]
  );

  res.status(201).json({ message: insertedRows?.[0] });
});

module.exports = router;
