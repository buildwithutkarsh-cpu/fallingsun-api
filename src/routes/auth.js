const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { User, Team } = require('../db');
const { sign, requireAuth } = require('../middleware/auth');
const { syncIfStale, hashInvite } = require('../services/sheets');
const { HttpError, email, password, str } = require('../utils');

const DUMMY_PASSWORD_HASH = bcrypt.hashSync('not-a-real-user-password', 12);

function authenticated(u) {
  return { token: sign(u), user: { id: String(u._id), name: u.name, role: u.role } };
}

// First-time account setup. The email must be on the sheet AND the person must know the invite_code
// the organizers put next to their email, so knowing someone's email is not enough to claim the account.
const MAX_FAILS = 5, LOCK_MS = 15 * 60 * 1000;
const NOT_ELIGIBLE = 'Email or invite code is incorrect';

async function registerFailed(u) {
  const after = await User.findOneAndUpdate({ _id: u._id }, { $inc: { register_failures: 1 } }, { new: true });
  if (after.register_failures >= MAX_FAILS)
    await User.updateOne({ _id: u._id }, { $set: { register_failures: 0, register_locked_until: new Date(Date.now() + LOCK_MS) } });
}

router.post('/register', async (req, res) => {
  const e = email(req.body?.email);
  const p = password(req.body?.password);
  const code = str(typeof req.body?.invite_code === 'string' ? req.body.invite_code : '', 'invite_code', 100);
  await syncIfStale(10000);

  const u = await User.findOne({ email: e, active: true }).select('+password_hash +invite_hash');
  if (!u || !u.invite_hash) throw new HttpError(403, NOT_ELIGIBLE); // unknown email, or organizers gave no invite code
  if (u.register_locked_until && u.register_locked_until > new Date())
    throw new HttpError(429, 'Too many wrong invite codes. Try again in a few minutes.');

  const given = Buffer.from(hashInvite(code), 'hex'), real = Buffer.from(u.invite_hash, 'hex');
  if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) {
    await registerFailed(u);
    throw new HttpError(403, NOT_ELIGIBLE);
  }
  if (u.password_hash) throw new HttpError(409, 'A password is already set for this account. Log in instead.');

  const passwordHash = await bcrypt.hash(p, 12);
  const result = await User.updateOne(
    { _id: u._id, active: true, password_hash: { $exists: false } },
    { $set: { password_hash: passwordHash, register_failures: 0, register_locked_until: null } }
  );
  if (!result.modifiedCount) throw new HttpError(409, 'A password is already set for this account. Log in instead.');
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