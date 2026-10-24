const mongoose = require('mongoose');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

function str(v, name, max = 200) {
  if (typeof v !== 'string' || !v.trim()) throw bad(`${name} is required`);
  if (v.trim().length > max) throw bad(`${name} is too long (max ${max})`);
  return v.trim();
}
function email(v, name = 'email') {
  v = str(v, name, 150).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(v)) throw bad(`${name} is not a valid email`);
  return v;
}
function password(v) {
  if (typeof v !== 'string' || v.length < 8 || Buffer.byteLength(v, 'utf8') > 72)
    throw bad('password must be at least 8 characters and no more than 72 bytes');
  return v;
}
function scores(arr) {
  if (!Array.isArray(arr) || arr.length !== 5 || !arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 5))
    throw bad('scores must be an array of 5 integers between 0 and 5');
  return arr;
}
function objectId(v, name = 'id') {
  if (typeof v !== 'string' || !/^[a-f0-9]{24}$/i.test(v) || !mongoose.isValidObjectId(v)) throw bad(`${name} is invalid`);
  return v;
}
const r2 = (n) => Math.round(n * 100) / 100;
const isUniqueError = (e) => e && e.code === 11000;

module.exports = { HttpError, bad, str, email, password, scores, objectId, r2, isUniqueError };
