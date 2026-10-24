// Usage: npm run robotics:finalize -- 20
require('dotenv').config();
const db = require('../src/db');
const C = require('../src/config');
const { finalize } = require('../src/services/robotics');

(async () => {
  const top = Number(process.argv[2] || C.ROBOTICS_TOP_N);
  if (!Number.isInteger(top) || top < 1) { console.error('Give a positive number'); process.exit(1); }
  await db.connect();
  console.log(await finalize(top));
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
