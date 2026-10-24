const { Setting } = require('../db');

// Controlled from the "Settings" tab of the sheet:
//   voting_open        TRUE / FALSE
//   voting_opens_at    2026-10-24T10:00:00+05:30   (optional)
//   voting_closes_at   2026-10-24T18:00:00+05:30   (optional)
async function votingState() {
  const rows = await Setting.find({ key: { $in: ['voting_open', 'voting_opens_at', 'voting_closes_at'] } });
  const s = Object.fromEntries(rows.map((r) => [r.key, (r.value || '').trim()]));
  if (/^(false|no|0|closed)$/i.test(s.voting_open || '')) return { open: false, reason: 'Voting is closed' };
  const now = Date.now();
  const opens = Date.parse(s.voting_opens_at);
  const closes = Date.parse(s.voting_closes_at);
  if (!isNaN(opens) && now < opens) return { open: false, reason: 'Voting has not started yet' };
  if (!isNaN(closes) && now >= closes) return { open: false, reason: 'Voting is closed' };
  return { open: true };
}

module.exports = { votingState };
