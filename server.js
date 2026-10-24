require('dotenv').config();
require('express-async-errors'); // lets async route handlers throw errors safely
const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const db = require('./src/db');
const C = require('./src/config');
const { sync, getLastSync } = require('./src/services/sheets');

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('Se  t JWT_SECRET in production'); process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));

app.get('/api/config', (req, res) =>
  res.json({
    CATEGORIES: C.CATEGORIES, SKILL_TRACKS: C.SKILL_TRACKS, TOOLS: C.TOOLS, CRITERIA: C.CRITERIA,
    IDEATION: C.IDEATION, MIN_VOTES: C.MIN_VOTES, MAX_SUBMISSIONS: C.MAX_SUBMISSIONS,
    LEADER_SAME_CATEGORY_ONLY: C.LEADER_SAME_CATEGORY_ONLY,
  })
);
app.get('/api/health', (req, res) => {
  const s = getLastSync();
  res.json({ ok: true, sheet: { ok: s.ok, last_sync: s.at ? new Date(s.at).toISOString() : null, error: s.error } });
});

app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 60 }));
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  handler: (req, res) => res.status(429).json({ error: 'Too many login attempts. Try again later.' }),
}));
app.use('/api/auth/register', rateLimit({
  windowMs: 15 * 60 * 1000, max: 5,
  handler: (req, res) => res.status(429).json({ error: 'Too many registration attempts. Try again later.' }),
}));
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/teams', require('./src/routes/teams'));
app.use('/api/votes', rateLimit({ windowMs: 60 * 1000, max: 120 }), require('./src/routes/votes'));
app.use('/api/leaderboard', require('./src/routes/leaderboard'));
app.use('/api/robotics', require('./src/routes/robotics'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.get('/team/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'team.html')));
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Server error' : err.message });
});

async function main() {
  await db.connect();
  const first = await sync(); // must work once, otherwise nobody can log in
  console.log('Sheet synced:', JSON.stringify(first.summary));
  const every = Math.max(15, Number(process.env.SHEET_SYNC_SECONDS || 60));
  setInterval(() => sync().catch(() => {}), every * 1000).unref();
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Running on http://localhost:${port}`));
}
if (require.main === module) main().catch((e) => { console.error('Startup failed:', e.message); process.exit(1); });
module.exports = app;
