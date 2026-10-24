const fs = require('fs');
const { GoogleAuth } = require('google-auth-library');
const C = require('../config');
const { User, Team, Setting } = require('../db');

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const REQUIRED = ['Leaders', 'Jury'];
const OPTIONAL = ['Trial', 'Settings'];

const norm = (s) => String(s || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const truthy = (v) => /^(true|yes|y|1|done|completed)$/i.test(String(v || '').trim());

// [[header...],[row...]] -> [{header: value}]
// If a tab has no header row (no "email" column in row 1), fall back to the given column order
// and treat row 1 as data.
function recordsFromValues(values, fallback) {
  if (!Array.isArray(values) || !values.length) return [];
  let head = values[0].map(norm);
  let rows = values.slice(1);
  if (fallback && !head.includes('email')) { head = fallback; rows = values; }
  return rows
    .filter((r) => r.some((c) => String(c).trim() !== ''))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? '' : String(r[i])])));
}
const FALLBACK = { Leaders: ['name', 'email'], Jury: ['name', 'email'] };

async function getJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Google Sheets API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function fetchTabs() {
  if (process.env.LOCAL_SHEET_FILE) return JSON.parse(fs.readFileSync(process.env.LOCAL_SHEET_FILE, 'utf8'));

  // Free option, no Google Cloud / credit card: an Apps Script web app inside the sheet (see apps-script/Code.gs)
  if (process.env.GOOGLE_SCRIPT_URL) {
    const url = `${process.env.GOOGLE_SCRIPT_URL}?key=${encodeURIComponent(process.env.GOOGLE_SCRIPT_SECRET || '')}`;
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Apps Script returned ${res.status}`);
    let data;
    try { data = await res.json(); } catch (e) { throw new Error('Apps Script did not return JSON. Check the web app is deployed for "Anyone".'); }
    if (data.error) throw new Error(`Apps Script: ${data.error}`);
    for (const n of REQUIRED) if (!data[n]) throw new Error(`Sheet tab "${n}" not found`);
    const out = {};
    Object.keys(data).forEach((n) => (out[n] = recordsFromValues(data[n], FALLBACK[n])));
    return out;
  }

  const id = process.env.GOOGLE_SHEET_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!id || !email || !key) throw new Error('Google Sheet not configured (GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY)');

  const auth = new GoogleAuth({
    credentials: { client_email: email, private_key: key.replace(/\\n/g, '\n') },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const headers = { Authorization: `Bearer ${await auth.getAccessToken()}` };

  const meta = await getJson(`${API}/${id}?fields=sheets.properties.title`, headers);
  const titles = meta.sheets.map((s) => s.properties.title);
  const find = (n) => titles.find((t) => t.toLowerCase() === n.toLowerCase());
  for (const n of REQUIRED) if (!find(n)) throw new Error(`Sheet tab "${n}" not found`);

  const names = [...REQUIRED, ...OPTIONAL].filter(find);
  const q = names.map((n) => 'ranges=' + encodeURIComponent(find(n))).join('&');
  const data = await getJson(`${API}/${id}/values:batchGet?${q}`, headers);
  const out = {};
  names.forEach((n, i) => (out[n] = recordsFromValues(data.valueRanges[i].values, FALLBACK[n])));
  return out;
}

// label or key -> track key ("3D Design" / "design_3d")
const trackLookup = {};
Object.entries({ ...C.SKILL_TRACKS, ...C.TOOLS }).forEach(([k, label]) => {
  trackLookup[norm(k)] = k;
  trackLookup[norm(label)] = k;
});

let lastSync = { at: 0, ok: false, error: 'not synced yet', summary: null };
let running = null;

async function syncFromSheet() {
  const tabs = await fetchTabs();
  const skipped = [];
  const wanted = [];
  const seen = new Set();

  const take = (rows, role) => {
    for (const r of rows || []) {
      const email = (r.email || '').trim().toLowerCase();
      if (!email) continue;
      if (!/^\S+@\S+\.\S+$/.test(email)) { skipped.push(`${email}: invalid email`); continue; }
      if (seen.has(email)) { skipped.push(`${email}: duplicate (kept the first one)`); continue; }
      seen.add(email);
      wanted.push({ email, role, name: (r.name || email.split('@')[0]).trim() });
    }
  };
  take(tabs.Leaders, 'leader');
  take(tabs.Jury, 'jury');

  // Safety: an empty / broken sheet must never lock everybody out
  if (!wanted.length) throw new Error('Sheet has no valid users, keeping the old accounts');

  const ops = wanted.map((w) => ({
    updateOne: {
      filter: { email: w.email },
      update: { $set: { name: w.name, role: w.role }, $setOnInsert: { active: true } },
      upsert: true,
    },
  }));
  await User.bulkWrite(ops);
  const wantedEmails = wanted.map((w) => w.email);
  await User.updateMany(
    { email: { $in: wantedEmails }, admin_removed: { $ne: true } },
    { $set: { active: true } }
  );
  const removed = await User.updateMany(
    { email: { $nin: wantedEmails }, active: true, admin_removed: { $ne: true } },
    { $set: { active: false } }
  );

  // Settings tab: key | value  (voting_open, voting_opens_at, voting_closes_at)
  for (const r of tabs.Settings || []) {
    const key = norm(r.key);
    if (key) await Setting.updateOne({ key }, { $set: { value: String(r.value || '').trim() } }, { upsert: true });
  }

  // Trial tab: team | track | completed
  const trialOps = [];
  for (const r of tabs.Trial || []) {
    const team = (r.team || r.team_name || '').trim();
    const key = trackLookup[norm(r.track)];
    if (!team || !key) { if (team || r.track) skipped.push(`Trial row "${team} / ${r.track}": unknown team or track`); continue; }
    trialOps.push({
      updateOne: {
        filter: { name: team, 'tracks.track': key },
        update: { $set: { 'tracks.$.completed': truthy(r.completed) } },
        collation: { locale: 'en', strength: 2 },
      },
    });
  }
  if (trialOps.length) await Team.bulkWrite(trialOps);

  lastSync = {
    at: Date.now(), ok: true, error: null,
    summary: { leaders: wanted.filter((w) => w.role === 'leader').length, jury: wanted.filter((w) => w.role === 'jury').length,
      deactivated: removed.modifiedCount, trial_rows: trialOps.length, skipped },
  };
  return lastSync;
}

// Only one sync runs at a time; failures are remembered, not thrown away silently
function sync() {
  if (!running) {
    running = syncFromSheet()
      .catch((e) => { lastSync = { ...lastSync, ok: false, error: e.message }; console.error('Sheet sync failed:', e.message); throw e; })
      .finally(() => { running = null; });
  }
  return running;
}
async function syncIfStale(maxAgeMs) {
  if (Date.now() - lastSync.at < maxAgeMs) return;
  try { await sync(); } catch (e) { /* login will just fail normally */ }
}

module.exports = { sync, syncIfStale, getLastSync: () => lastSync, recordsFromValues };
