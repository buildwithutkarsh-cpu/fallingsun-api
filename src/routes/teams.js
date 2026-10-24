const router = require('express').Router();
const QRCode = require('qrcode');
const { Team, User } = require('../db');
const C = require('../config');
const { requireAuth, requireRole } = require('../middleware/auth');
const { HttpError, bad, str, objectId, isUniqueError } = require('../utils');

const baseUrl = (req) => process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
const teamLink = (req, id) => `${(process.env.FRONTEND_URL || 'https://fuck-fallingsun.vercel.app').replace(/\/$/, '')}/team/${id}`;

// Registration form. Only a logged-in leader (from the sheet) can fill it, once.
router.post('/', requireAuth, requireRole('leader'), async (req, res) => {
  if (req.user.team_id) throw new HttpError(409, 'Your team is already registered');
  const b = req.body || {};
  const name = str(b.name, 'team name', 60);
  if (!C.CATEGORIES.includes(b.category)) throw bad('category must be game, web or robotics');
  const project_title = str(b.project_title, 'project title', 100);
  const description = str(b.description, 'description', 2000);
  let link;
  if (b.link) {
    link = str(b.link, 'link', 300);
    if (!/^https?:\/\//i.test(link)) throw bad('link must start with http:// or https://');
  }
  let github_url;
  if (b.github_url) {
    github_url = str(b.github_url, 'GitHub repository URL', 300);
    if (!/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/?$/i.test(github_url))
      throw bad('GitHub repository URL must be a public github.com/owner/repository URL');
  }
  const skills = Array.isArray(b.skill_tracks) ? [...new Set(b.skill_tracks)] : [];
  if (skills.length !== C.SKILL_TRACKS_PER_TEAM || !skills.every((t) => C.SKILL_TRACKS[t]))
    throw bad(`pick exactly ${C.SKILL_TRACKS_PER_TEAM} different skill tracks`);
  if (typeof b.tool !== 'string' || !C.TOOLS[b.tool]) throw bad('pick exactly one valid tool track');
  const rawMembers = Array.isArray(b.members) ? b.members : [];
  if (rawMembers.length > 9) throw bad('max 9 members besides the leader');
  const members = rawMembers.map((m, i) => ({ name: str(typeof m === 'string' ? m : m?.name, `member ${i + 1} name`, 80) }));

  let team;
  try {
    team = await Team.create({
      name, leader: req.user.id, category: b.category, project_title, description, link, github_url, members,
      tracks: [...skills.map((t) => ({ kind: 'skill', track: t })), { kind: 'tool', track: b.tool }],
    });
  } catch (e) {
    if (isUniqueError(e)) throw new HttpError(409, e.keyPattern?.leader ? 'Your team is already registered' : 'That team name is already taken');
    throw e;
  }
  // Link leader -> team only if still free (guards against two requests at once)
  const linked = await User.updateOne({ _id: req.user.id, team: null }, { $set: { team: team._id } });
  if (!linked.matchedCount) {
    await Team.deleteOne({ _id: team._id });
    throw new HttpError(409, 'Your team is already registered');
  }
  res.status(201).json({
    team_id: String(team._id),
    team_url: teamLink(req, team._id),
    qr_url: `${baseUrl(req)}/api/teams/${team._id}/qr.png`,
  });
});

router.get('/', async (req, res) => {
  const filter = { status: { $ne: 'robotics_eliminated' } };
  if (req.query.category) {
    if (!C.CATEGORIES.includes(req.query.category)) throw bad('invalid category');
    filter.category = req.query.category;
  }
  const teams = await Team.find(filter).sort('name').select('name category project_title status');
  res.json({ teams });
});

// Eliminated robotics team -> move to web or game
router.post('/me/transfer', requireAuth, requireRole('leader'), async (req, res) => {
  const to = req.body?.category;
  if (!['web', 'game'].includes(to)) throw bad('category must be web or game');
  const r = await Team.updateOne({ _id: req.user.team_id, status: 'robotics_eliminated' }, { $set: { category: to, status: 'transferred' } });
  if (!r.matchedCount) throw new HttpError(409, 'Only eliminated robotics teams can transfer');
  res.json({ ok: true, category: to });
});

router.get('/:id', async (req, res) => {
  const t = await Team.findById(objectId(req.params.id, 'team id')).populate('leader', 'name');
  if (!t) throw new HttpError(404, 'Team not found');
  res.json({
    id: String(t._id), name: t.name, category: t.category, project_title: t.project_title,
    description: t.description, link: t.link || null, github_url: t.github_url || null, status: t.status,
    members: [{ name: t.leader?.name || 'Leader', role: 'leader' }, ...t.members.map((m) => ({ name: m.name, role: 'member' }))],
    tracks: t.tracks,
  });
});

async function getTeamQr(req, format) {
  const id = objectId(req.params.id, 'team id');
  if (!(await Team.exists({ _id: id }))) throw new HttpError(404, 'Team not found');
  const options = { width: 320, margin: 2, color: { dark: '#000000', light: '#ffffff' } };
  return format === 'svg'
    ? QRCode.toString(teamLink(req, id), { ...options, type: 'svg' })
    : QRCode.toBuffer(teamLink(req, id), options);
}

router.get('/:id/qr.png', async (req, res) => {
  const png = await getTeamQr(req, 'png');
  res.type('png').send(png);
});

router.get('/:id/qr.png/download', async (req, res) => {
  const png = await getTeamQr(req, 'png');
  res.attachment(`team-${req.params.id}-qr.png`).send(png);
});

router.get('/:id/qr.svg', async (req, res) => {
  const svg = await getTeamQr(req, 'svg');
  res.attachment(`team-${req.params.id}-qr.svg`).type('image/svg+xml').send(svg);
});

module.exports = router;