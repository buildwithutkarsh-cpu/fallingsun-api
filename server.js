require('dotenv').config();
require('express-async-errors'); // lets async route handlers throw errors safely
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const db = require('./src/db');
const C = require('./src/config');
const { sync, getLastSync } = require('./src/services/sheets');

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('Set JWT_SECRET in production'); process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
// CORS: set CORS_ORIGIN=https://your-frontend.com (comma separated). Unset = open in dev, closed in production.
const origins = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : process.env.NODE_ENV !== 'production' }));
app.use(express.json({ limit: '50kb' }));

app.get('/', (req, res) => res.json({
  service: 'Hackathon Voting API',
  docs: `${req.protocol}://${req.get('host')}/api`,
  health: `${req.protocol}://${req.get('host')}/api/health`,
}));
app.get('/api', (req, res) => res.json({
  authentication: 'Send the login token as Authorization: Bearer <token>.',
  endpoints: [
    { method: 'GET', path: '/api/health', access: 'public' },
    { method: 'GET', path: '/api/config', access: 'public' },
    { method: 'POST', path: '/api/auth/register', access: 'public', body: '{ "email": "...", "password": "...", "invite_code": "..." }', note: 'first-time setup, needs the invite_code from the organizers' },
    { method: 'POST', path: '/api/auth/login', access: 'public', body: '{ "email": "...", "password": "..." }' },
    { method: 'GET', path: '/api/auth/me', access: 'authenticated' },
    { method: 'DELETE', path: '/api/admin/users', access: 'admin verification hash', body: '{ "email": "...", "verification_hash": "..." }', note: 'clears the password (forgot password); user registers again with invite_code' },
    { method: 'GET', path: '/api/teams', access: 'public', query: '?category=game|web|robotics' },
    { method: 'POST', path: '/api/teams', access: 'leader', body: '{ "name": "...", "category": "game|web|robotics", "project_title": "...", "description": "...", "skill_tracks": ["..."], "tool": "...", "members": [{ "name": "..." }], "link": "https://...", "github_url": "https://github.com/owner/repository" }' },
    { method: 'GET', path: '/api/teams/:id', access: 'public' },
    { method: 'GET', path: '/api/teams/:id/qr.png', access: 'public' },
    { method: 'GET', path: '/api/teams/:id/qr.png/download', access: 'public' },
    { method: 'GET', path: '/api/teams/:id/qr.svg', access: 'public' },
    { method: 'POST', path: '/api/teams/me/transfer', access: 'leader', body: '{ "category": "web|game" }' },
    { method: 'POST', path: '/api/votes', access: 'leader or jury', body: '{ "team_id": "...", "scores": [0, 1, 2, 3, 4] }' },
    { method: 'GET', path: '/api/votes/mine', access: 'leader or jury' },
    { method: 'POST', path: '/api/votes/presentation', access: 'jury', body: '{ "team_id": "...", "score": 0 }' },
    { method: 'GET', path: '/api/votes/presentation/mine', access: 'jury' },
    { method: 'POST', path: '/api/robotics/ideation', access: 'jury', body: '{ "team_id": "...", "scores": [0, 1, 2, 3, 4] }' },
    { method: 'GET', path: '/api/robotics/ideation/ranking', access: 'jury' },
    { method: 'GET', path: '/api/leaderboard', access: 'public', query: '?category=game|web|robotics' },
  ],
}));

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
app.use('/api/admin/users', rateLimit({
  windowMs: 15 * 60 * 1000, max: 5,
  handler: (req, res) => res.status(429).json({ error: 'Too many user removal attempts. Try again later.' }),
}), require('./src/routes/admin-users'));
app.use('/api/teams', require('./src/routes/teams'));
app.use('/api/votes', rateLimit({ windowMs: 60 * 1000, max: 120 }), require('./src/routes/votes'));
app.use('/api/leaderboard', require('./src/routes/leaderboard'));
app.use('/api/robotics', require('./src/routes/robotics'));
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

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