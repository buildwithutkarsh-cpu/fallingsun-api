const router = require('express').Router();
const crypto = require('crypto');
const { User } = require('../db');
const { HttpError, bad, email } = require('../utils');

router.delete('/', async (req, res) => {
  const expectedHash = process.env.ADMIN_DELETE_HASH;
  if (!expectedHash) throw new HttpError(503, 'User removal is not configured');

  const verificationHash = req.body?.verification_hash;
  if (typeof verificationHash !== 'string' || !verificationHash || verificationHash.length > 256) {
    throw bad('verification_hash is required');
  }
  const suppliedDigest = crypto.createHash('sha256').update(verificationHash).digest();
  const expectedDigest = crypto.createHash('sha256').update(expectedHash).digest();
  if (!crypto.timingSafeEqual(suppliedDigest, expectedDigest)) {
    throw new HttpError(403, 'Invalid verification hash');
  }

  const userEmail = email(req.body?.email);
  const result = await User.updateOne(
    { email: userEmail, active: true },
    { $unset: { password_hash: 1 } }
  );
  if (!result.matchedCount) throw new HttpError(404, 'Active user not found');
  res.json({ ok: true, email: userEmail, password_reset: true });
});

module.exports = router;
