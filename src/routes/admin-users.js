const router = require('express').Router();
const crypto = require('crypto');
const { User } = require('../db');
const { HttpError, bad, email } = require('../utils');

// ADMIN_DELETE_HASH is a long random secret kept in .env (it is compared as-is, not a real hash)
function checkSecret(req) {
  const expected = process.env.ADMIN_DELETE_HASH;
  if (!expected) throw new HttpError(503, 'User removal is not configured');
  const given = req.body?.verification_hash;
  if (typeof given !== 'string' || !given || given.length > 256) throw bad('verification_hash is required');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  if (!crypto.timingSafeEqual(a, b)) throw new HttpError(403, 'Invalid verification hash');
}

// Forgotten password: clear the password and log the user out everywhere (old tokens stop working).
// To set a new password they must register again, which still needs their invite_code from the sheet.
router.delete('/', async (req, res) => {
  checkSecret(req);
  const userEmail = email(req.body?.email);
  const result = await User.updateOne(
    { email: userEmail, active: true },
    { $unset: { password_hash: 1 }, $inc: { token_version: 1 }, $set: { register_failures: 0, register_locked_until: null } }
  );
  if (!result.matchedCount) throw new HttpError(404, 'Active user not found');
  res.json({ ok: true, email: userEmail, password_reset: true });
});

module.exports = router;