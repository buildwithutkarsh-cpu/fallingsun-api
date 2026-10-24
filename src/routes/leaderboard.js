const router = require('express').Router();
const C = require('../config');
const { leaderboard } = require('../services/scoring');
const { bad } = require('../utils');

router.get('/', async (req, res) => {
  const { category } = req.query;
  if (category && !C.CATEGORIES.includes(category)) throw bad('invalid category');
  res.json(await leaderboard(category));
});

module.exports = router;
