const jwt = require('jsonwebtoken');
const { User } = require('../db');
const { HttpError } = require('../utils');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const sign = (user) => jwt.sign({ id: String(user._id), role: user.role, tv: user.token_version || 0 }, SECRET, { expiresIn: '6h' });

// Token is checked, then the user is loaded again so someone removed from the sheet loses access at once
async function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) throw new HttpError(401, 'Login required');
  let payload;
  try { payload = jwt.verify(h.slice(7), SECRET); } catch (e) { throw new HttpError(401, 'Invalid or expired token'); }
  const u = await User.findById(payload.id);
  if (!u || !u.active || (u.token_version || 0) !== (payload.tv || 0)) throw new HttpError(401, 'Account is not active or you were logged out');
  req.user = { id: String(u._id), role: u.role, name: u.name, team_id: u.team ? String(u.team) : null };
  next();
}

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) throw new HttpError(403, 'You are not allowed to do this');
  next();
};

module.exports = { sign, requireAuth, requireRole };