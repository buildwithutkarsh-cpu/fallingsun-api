const { Team, Vote, PresentationScore } = require('../db');
const C = require('../config');
const { r2 } = require('../utils');
const { votingState } = require('./settings');

/*
  Total 100 (25 each):
   trial         each completed track = 5 (4 skill + 1 tool), from the sheet's Trial tab
   presentation  average of jury's 0-5 scores (after the 3 min pitch), scaled to 25
   jury_rating   average of jury's 5-criteria votes (each vote out of 25)
   leader_vote   average of team leaders' 5-criteria votes (each vote out of 25)
*/
async function leaderboard(category) {
  const open = (await votingState()).open;
  const filter = { status: { $ne: 'robotics_eliminated' } };
  if (category) filter.category = category;

  const [teams, voteAgg, presAgg, leaderCounts] = await Promise.all([
    Team.find(filter),
    Vote.aggregate([{ $group: { _id: { team: '$team', source: '$source' }, avg: { $avg: '$total' }, n: { $sum: 1 } } }]),
    PresentationScore.aggregate([{ $group: { _id: '$team', avg: { $avg: '$score' }, n: { $sum: 1 } } }]),
    Vote.aggregate([{ $match: { source: 'leader' } }, { $group: { _id: '$voter_team', n: { $sum: 1 } } }]),
  ]);

  const votes = {}; voteAgg.forEach((v) => (votes[`${v._id.team}:${v._id.source}`] = v));
  const pres = {}; presAgg.forEach((p) => (pres[String(p._id)] = p));
  const given = {}; leaderCounts.forEach((c) => (given[String(c._id)] = c.n));

  const rows = teams.map((t) => {
    const id = String(t._id);
    const trial = Math.min(t.tracks.filter((x) => x.completed).length * C.POINTS_PER_TRACK, 25);
    const p = pres[id];
    const jr = votes[`${id}:jury`];
    const lv = votes[`${id}:leader`];
    const min = C.MIN_VOTES[t.category];
    const rated = given[id] || 0;
    const row = {
      team_id: id, team: t.name, category: t.category, project_title: t.project_title,
      trial: r2(trial),
      presentation: r2(p ? (p.avg / 5) * 25 : 0), jury_scores: p ? p.n : 0,
      jury_rating: r2(jr ? jr.avg : 0), jury_votes: jr ? jr.n : 0,
      leader_vote: r2(lv ? lv.avg : 0), leader_votes: lv ? lv.n : 0,
      projects_rated_by_leader: rated, min_required: min,
      standing: rated >= min ? 'eligible' : open ? 'at_risk' : 'disqualified',
    };
    row.total = r2(row.trial + row.presentation + row.jury_rating + row.leader_vote);
    return row;
  });

  const ranked = rows
    .filter((r) => r.standing !== 'disqualified')
    .sort((a, b) => b.total - a.total || b.presentation - a.presentation || b.jury_rating - a.jury_rating);
  ranked.forEach((r, i) => (r.rank = i + 1));
  return { voting_open: open, ranked, disqualified: rows.filter((r) => r.standing === 'disqualified') };
}

module.exports = { leaderboard };
