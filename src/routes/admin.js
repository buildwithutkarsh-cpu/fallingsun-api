const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const C = require('../config');
const { requireAuth, requireRole } = require('../middleware/auth');
const { HttpError, bad, str, email, password, isUniqueError } = require('../utils');

router.use(requireAuth, requireRole('admin'));

router.get('/overview', (req, res) => {
  const voting_open = db.prepare("SELECT value FROM settings WHERE key='voting_open'").get().value === '1';
  const teams = db
    .prepare(
      `SELECT t.id,t.name,t.category,t.status,
              (SELECT email FROM users WHERE team_id=t.id AND role='leader') AS leader_email
       FROM teams t ORDER BY t.id`
    )
    .all()
    .map((t) => ({
      ...t,
      tracks: db.prepare('SELECT kind,track,completed FROM team_tracks WHERE team_id=?').all(t.id),
    }));
  res.json({ voting_open, teams });
});

router.patch('/voting', (req, res) => {
  if (typeof req.body?.open !== 'boolean') throw bad('open must be true or false');
  db.prepare("UPDATE settings SET value=? WHERE key='voting_open'").run(req.body.open ? '1' : '0');
  res.json({ voting_open: req.body.open });
});

// Create judge / reviewer accounts
router.post('/users', (req, res) => {
  const role = req.body?.role;
  if (!['judge', 'reviewer'].includes(role)) throw bad('role must be judge or reviewer');
  const name = str(req.body?.name, 'name', 80);
  const e = email(req.body?.email);
  const p = password(req.body?.password);
  try {
    const r = db
      .prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)')
      .run(name, e, bcrypt.hashSync(p, 10), role);
    res.status(201).json({ id: r.lastInsertRowid, name, email: e, role });
  } catch (err) {
    if (isUniqueError(err)) throw new HttpError(409, 'Email already registered');
    throw err;
  }
});

// Mark a team's trial track complete / incomplete (5 pts each)
router.patch('/teams/:id/tracks', (req, res) => {
  const track = req.body?.track;
  if (typeof req.body?.completed !== 'boolean') throw bad('completed must be true or false');
  if (!C.SKILL_TRACKS[track] && !C.TOOLS[track]) throw bad('unknown track');
  const r = db
    .prepare('UPDATE team_tracks SET completed=? WHERE team_id=? AND track=?')
    .run(req.body.completed ? 1 : 0, req.params.id, track);
  if (!r.changes) throw new HttpError(404, 'This team did not pick that track');
  res.json({ ok: true });
});

module.exports = router;
