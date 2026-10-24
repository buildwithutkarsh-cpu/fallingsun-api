const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { User, Team } = require('../db');
const { sign, requireAuth } = require('../middleware/auth');
const { syncIfStale } = require('../services/sheets');
const { HttpError, email, password } = require('../utils');

const DUMMY_PASSWORD_HASH = bcrypt.hashSync('not-a-real-user-password', 12);

function authenticated(u) {
  return { token: sign(u), user: { id: String(u._id), name: u.name, role: u.role } };
}

// Only active accounts from the Leaders/Jury sheet can enroll, and enrollment cannot reset a password.
router.post('/register', async (req, res) => {
  const e = email(req.body?.email);
  const p = password(req.body?.password);
  await syncIfStale(10000);

  const u = await User.findOne({ email: e, active: true }).select('+password_hash');
  if (!u) throw new HttpError(403, 'This email is not an active leader or jury account');
  if (u.password_hash) throw new HttpError(409, 'A password is already set for this account');

  const passwordHash = await bcrypt.hash(p, 12);
  const result = await User.updateOne(
    { _id: u._id, active: true, password_hash: { $exists: false } },
    { $set: { password_hash: passwordHash } }
  );
  if (!result.modifiedCount) throw new HttpError(409, 'A password is already set for this account');
  res.status(201).json(authenticated(u));
});

router.post('/login', async (req, res) => {
  const e = email(req.body?.email);
  const p = password(req.body?.password);
  await syncIfStale(10000);

  const u = await User.findOne({ email: e, active: true }).select('+password_hash');
  const valid = await bcrypt.compare(p, u?.password_hash || DUMMY_PASSWORD_HASH);
  if (!u || !u.password_hash || !valid) throw new HttpError(401, 'Email or password is incorrect');
  res.json(authenticated(u));
});

router.get('/me', requireAuth, async (req, res) => {
  const team = req.user.team_id ? await Team.findById(req.user.team_id) : null;
  res.json({
    user: {
      id: req.user.id, name: req.user.name, role: req.user.role,
      team: team ? { id: String(team._id), name: team.name, category: team.category, status: team.status } : null,
    },
  });
});

module.exports = router;
