const fs = require('fs'), path = require('path'), { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false });
(async () => {
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  for (const f of fs.readdirSync(dir).sort()) { await pool.query(fs.readFileSync(path.join(dir, f), 'utf8')); console.log('OK', f); }
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
