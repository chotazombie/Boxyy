// Minimal backend: file-backed JSON store for users + boxes.
// Replace storage layer with Postgres/Supabase before real launch.
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data.json');

function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { users: {}, boxes: {}, tokens: {} };
  }
}
function saveDB(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

const db = loadDB();
const app = express();
app.use(cors());
app.use(express.json());

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const userId = db.tokens[token];
  if (!userId || !db.users[userId]) return res.status(401).json({ error: 'unauthorized' });
  req.user = db.users[userId];
  next();
}

const boxKey = (x, y) => `${x}:${y}`;

// ---- Auth (mock: username only; replace with real auth before launch) ----
app.post('/api/auth/login', (req, res) => {
  const { username } = req.body || {};
  if (!username || typeof username !== 'string' || username.length > 40) {
    return res.status(400).json({ error: 'invalid username' });
  }
  let user = Object.values(db.users).find((u) => u.username === username);
  if (!user) {
    user = { id: crypto.randomUUID(), username };
    db.users[user.id] = user;
  }
  const token = crypto.randomBytes(24).toString('hex');
  db.tokens[token] = user.id;
  saveDB(db);
  res.json({ user, token });
});

// ---- Boxes ----
app.get('/api/boxes/:x/:y', (req, res) => {
  const { x, y } = req.params;
  const box = db.boxes[boxKey(x, y)];
  if (!box) return res.json({ x: Number(x), y: Number(y), free: true });
  const owner = box.ownerId ? db.users[box.ownerId] : null;
  res.json({ ...box, ownerUsername: owner?.username ?? null });
});

app.post('/api/boxes/:x/:y/claim', auth, (req, res) => {
  const { x, y } = req.params;
  const key = boxKey(x, y);
  const existing = db.boxes[key];
  if (existing && existing.ownerId && existing.ownerId !== req.user.id) {
    return res.status(409).json({ error: 'already owned' });
  }
  // TODO: integrate payment. For now, claiming is free.
  const box = {
    x: Number(x),
    y: Number(y),
    ownerId: req.user.id,
    content: existing?.content ?? null,
    updatedAt: Date.now(),
  };
  db.boxes[key] = box;
  saveDB(db);
  res.json({ ...box, ownerUsername: req.user.username });
});

app.put('/api/boxes/:x/:y/content', auth, (req, res) => {
  const { x, y } = req.params;
  const key = boxKey(x, y);
  const box = db.boxes[key];
  if (!box || box.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'not owner' });
  }
  const { kind, data } = req.body || {};
  const ALLOWED = ['youtube'];
  if (!ALLOWED.includes(kind)) return res.status(400).json({ error: 'unsupported kind' });
  if (kind === 'youtube') {
    const id = parseYoutubeId(data?.url || '');
    if (!id) return res.status(400).json({ error: 'invalid youtube url' });
    box.content = { kind: 'youtube', data: { videoId: id } };
  }
  box.updatedAt = Date.now();
  saveDB(db);
  res.json({ ...box, ownerUsername: req.user.username });
});

function parseYoutubeId(url) {
  if (typeof url !== 'string') return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url;
  return null;
}

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`api listening on :${port}`));
