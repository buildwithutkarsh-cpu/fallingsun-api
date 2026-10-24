const router = require('express').Router();
const { Team, IdeationScore } = require('../db');
const C = require('../config');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ranking } = require('../services/robotics');
const { votingState } = require('../services/settings');
const { HttpError, scores, objectId } = require('../utils');

router.use(requireAuth, requireRole('jury'));

// Ideation round: jury scores a robotics team on 5 criteria (0-5 each)
router.post('/ideation', async (req, res) => {
  const state = await votingState();
  if (!state.open) throw new HttpError(403, state.reason);
  const teamId = objectId(req.body?.team_id, 'team_id');
  const s = scores(req.body?.scores);
  const team = await Team.findById(teamId);
  if (!team || team.category !== 'robotics') throw new HttpError(404, 'Robotics team not found');
  if (team.status !== 'active') throw new HttpError(409, 'Ideation round is already finalized for this team');
  await IdeationScore.updateOne(
    { reviewer: req.user.id, team: teamId },
    { $set: { scores: s, total: s.reduce((a, b) => a + b, 0) } },
    { upsert: true }
  );
  res.json({ ok: true });
});

router.get('/ideation/ranking', async (req, res) => res.json({ ranking: await ranking(), criteria: C.IDEATION }));

module.exports = router;
