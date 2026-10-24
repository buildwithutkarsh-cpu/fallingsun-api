const router = require('express').Router();
const { Team, Vote, PresentationScore, VoteAudit } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { votingState } = require('../services/settings');
const C = require('../config');
const { HttpError, bad, scores, objectId, isUniqueError } = require('../utils');

router.use(requireAuth, requireRole('leader', 'jury'));

/*
  One vote counts per (voter, project).
  The unique index guarantees it; the filter {submissions < MAX} + upsert makes the edit limit atomic:
  if the doc exists but is over the limit, the upsert tries to insert and hits the unique index (E11000).
*/
async function saveLimited(Model, key, set) {
  try {
    return await Model.findOneAndUpdate(
      { ...key, submissions: { $lt: C.MAX_SUBMISSIONS } },
      { $set: set, $inc: { submissions: 1 } },
      { upsert: true, new: false } // returns the OLD doc (null on first submit)
    );
  } catch (e) {
    if (isUniqueError(e)) throw new HttpError(409, `You already used all ${C.MAX_SUBMISSIONS} submissions for this project`);
    throw e;
  }
}

async function openTeam(teamId) {
  const state = await votingState();
  if (!state.open) throw new HttpError(403, state.reason);
  const team = await Team.findById(teamId);
  if (!team || team.status === 'robotics_eliminated') throw new HttpError(404, 'Project not found');
  return team;
}

router.post('/', async (req, res) => {
  const teamId = objectId(req.body?.team_id, 'team_id');
  const s = scores(req.body?.scores);
  const target = await openTeam(teamId);

  if (req.user.role === 'leader') {
    if (!req.user.team_id) throw new HttpError(403, 'Register your team before voting');
    if (req.user.team_id === teamId) throw new HttpError(403, 'You cannot vote for your own project');
    const mine = await Team.findById(req.user.team_id);
    if (mine.status === 'robotics_eliminated') throw new HttpError(403, 'Your team was eliminated from robotics. Transfer to web or game first');
    if (C.LEADER_SAME_CATEGORY_ONLY && mine.category !== target.category)
      throw new HttpError(403, `As a ${mine.category} team leader you can only vote for ${mine.category} projects`);
  }

  const set = {
    scores: s, total: s.reduce((a, b) => a + b, 0),
    source: req.user.role === 'leader' ? 'leader' : 'jury',
    voter_team: req.user.team_id || null,
  };
  const before = await saveLimited(Vote, { voter: req.user.id, team: teamId }, set);
  await VoteAudit.create({
    kind: 'vote', action: before ? 'update' : 'create', voter: req.user.id, team: teamId,
    before: before ? before.scores : null, after: s, ip: req.ip,
  });
  const used = (before?.submissions || 0) + 1;
  res.json({ ok: true, submissions_used: used, submissions_left: C.MAX_SUBMISSIONS - used });
});

router.get('/mine', async (req, res) => {
  const votes = await Vote.find({ voter: req.user.id });
  res.json({
    max_submissions: C.MAX_SUBMISSIONS,
    count: votes.length,
    votes: votes.map((v) => ({ team_id: String(v.team), scores: v.scores, submissions: v.submissions })),
  });
});

// Jury only: 0-5 after the 3 minute presentation
router.post('/presentation', requireRole('jury'), async (req, res) => {
  const teamId = objectId(req.body?.team_id, 'team_id');
  const score = req.body?.score;
  if (!Number.isInteger(score) || score < 0 || score > 5) throw bad('score must be an integer 0-5');
  await openTeam(teamId);
  const before = await saveLimited(PresentationScore, { reviewer: req.user.id, team: teamId }, { score });
  await VoteAudit.create({
    kind: 'presentation', action: before ? 'update' : 'create', voter: req.user.id, team: teamId,
    before: before ? before.score : null, after: score, ip: req.ip,
  });
  const used = (before?.submissions || 0) + 1;
  res.json({ ok: true, submissions_used: used, submissions_left: C.MAX_SUBMISSIONS - used });
});

router.get('/presentation/mine', requireRole('jury'), async (req, res) => {
  const rows = await PresentationScore.find({ reviewer: req.user.id });
  res.json({ scores: rows.map((r) => ({ team_id: String(r.team), score: r.score, submissions: r.submissions })) });
});

module.exports = router;
