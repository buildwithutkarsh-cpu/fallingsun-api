const { Team, IdeationScore } = require('../db');
const { r2 } = require('../utils');

async function ranking() {
  const [teams, agg] = await Promise.all([
    Team.find({ category: 'robotics', status: { $in: ['active', 'robotics_selected', 'robotics_eliminated'] } }),
    IdeationScore.aggregate([{ $group: { _id: '$team', avg: { $avg: '$total' }, n: { $sum: 1 } } }]),
  ]);
  const m = {}; agg.forEach((a) => (m[String(a._id)] = a));
  return teams
    .map((t) => ({ id: String(t._id), name: t.name, project_title: t.project_title, status: t.status,
      avg_score: r2(m[String(t._id)]?.avg || 0), reviews: m[String(t._id)]?.n || 0 }))
    .sort((a, b) => b.avg_score - a.avg_score || a.name.localeCompare(b.name))
    .map((t, i) => ({ rank: i + 1, ...t }));
}

// Top N -> robotics_selected, rest -> robotics_eliminated (they can then transfer to web/game)
async function finalize(top) {
  const list = await ranking();
  if (list.length) {
    await Team.bulkWrite(list.map((t, i) => ({
      updateOne: { filter: { _id: t.id }, update: { $set: { status: i < top ? 'robotics_selected' : 'robotics_eliminated' } } },
    })));
  }
  return { selected: Math.min(top, list.length), eliminated: Math.max(list.length - top, 0) };
}

module.exports = { ranking, finalize };
