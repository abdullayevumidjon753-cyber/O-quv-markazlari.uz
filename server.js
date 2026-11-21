const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Pool } = require('pg');
const env = process.env;
if (!env.DATABASE_URL || !env.JWT_SECRET) { console.error('DATABASE_URL va JWT_SECRET kerak (.env.example ga qarang).'); process.exit(1); }
const pool = new Pool({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false });
const PUB = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const b64 = b => Buffer.from(b).toString('base64url');
const sign = p => { const body = b64(JSON.stringify(p)); return body + '.' + crypto.createHmac('sha256', env.JWT_SECRET).update(body).digest('base64url'); };
function verify(t) {
  if (!t) return null; const [body, sig] = t.split('.'); if (!body || !sig) return null;
  const ok = crypto.createHmac('sha256', env.JWT_SECRET).update(body).digest('base64url');
  if (sig.length !== ok.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(ok))) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url')); return p.exp > Date.now() ? p : null;
}
const hash = pw => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(pw, s, 64).toString('hex'); };
const check = (pw, h) => { const [s, k] = h.split(':'); const a = crypto.scryptSync(pw, s, 64), b = Buffer.from(k, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); };
class HttpError extends Error { constructor(c, m) { super(m); this.code = c; } }
const hits = new Map();
function limit(ip, key, max, ms) { const k = key + ip, n = Date.now(); const a = (hits.get(k) || []).filter(t => n - t < ms); a.push(n); hits.set(k, a); if (a.length > max) throw new HttpError(429, "Juda ko'p so'rov. Birozdan keyin urinib ko'ring."); }
const send = (res, c, o) => { res.writeHead(c, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(o)); };
const readBody = req => new Promise((ok, no) => { let d = ''; req.on('data', c => { d += c; if (d.length > 100000) { no(new HttpError(413, "So'rov juda katta")); req.destroy(); } }); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch { no(new HttpError(400, "Noto'g'ri JSON")); } }); });
const str = (v, max, req = true) => { v = typeof v === 'string' ? v.trim() : ''; if (req && !v) throw new HttpError(400, "Majburiy maydon bo'sh"); if (v.length > max) throw new HttpError(400, 'Matn juda uzun'); return v || null; };
const intOrNull = v => { if (v === '' || v == null) return null; if (!Number.isFinite(+v)) throw new HttpError(400, 'Son kutilgan'); return Math.trunc(+v); };
const boolOrNull = v => (v === '' || v == null) ? null : !!v;
const needUser = u => { if (!u) throw new HttpError(401, 'Avval tizimga kiring'); return u; };
const needAdmin = u => { if (needUser(u).role !== 'admin') throw new HttpError(403, 'Faqat administrator uchun'); return u; };
const audit = (u, action, target, details) => pool.query('INSERT INTO audit_log(admin_id,action,target,details) VALUES($1,$2,$3,$4)', [u.id, action, target, details || null]);
const COURSE_COLS = `c.*, (SELECT ROUND(AVG(rating)::numeric,1) FROM reviews r WHERE r.course_id=c.id AND r.status='approved') AS avg_rating,
  (SELECT COUNT(*) FROM reviews r WHERE r.course_id=c.id AND r.status='approved')::int AS review_count`;

async function route(req, u, url, body) {
  const m = req.method, p = url.pathname, q = url.searchParams, ip = req.socket.remoteAddress;
  let r, mm;
  if (m === 'POST' && p === '/api/auth/register') {
    limit(ip, 'auth', 10, 600000);
    const name = str(body.name, 80), email = str(body.email, 200).toLowerCase(), pw = str(body.password, 200);
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, "Email noto'g'ri");
    if (pw.length < 8) throw new HttpError(400, "Parol kamida 8 belgi bo'lsin");
    const role = env.ADMIN_EMAIL && env.ADMIN_EMAIL.toLowerCase() === email ? 'admin' : 'user';
    try { r = await pool.query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role', [name, email, hash(pw), role]); }
    catch (e) { if (e.code === '23505') throw new HttpError(409, 'Bu email band'); throw e; }
    return [201, { token: sign({ id: r.rows[0].id, exp: Date.now() + 7 * 864e5 }), user: r.rows[0] }];
  }
  if (m === 'POST' && p === '/api/auth/login') {
    limit(ip, 'auth', 10, 600000);
    r = await pool.query('SELECT * FROM users WHERE email=$1', [str(body.email, 200).toLowerCase()]);
    const row = r.rows[0];
    if (!row || !check(str(body.password, 200), row.password_hash)) throw new HttpError(401, "Email yoki parol noto'g'ri");
    return [200, { token: sign({ id: row.id, exp: Date.now() + 7 * 864e5 }), user: { id: row.id, name: row.name, email: row.email, role: row.role } }];
  }
  if (m === 'GET' && p === '/api/me') return [200, { user: needUser(u) }];

  if (m === 'GET' && p === '/api/courses') {
    const w = [], a = [];
    const add = (sql, v) => { a.push(v); w.push(sql.replace(/\?/g, '$' + a.length)); };
    if (q.get('q')) add('(c.title ILIKE ? OR c.center_name ILIKE ? OR c.category ILIKE ?)', '%' + q.get('q').slice(0, 100) + '%');
    if (q.get('city')) add('c.city ILIKE ?', q.get('city').slice(0, 80));
    if (['online', 'offline', 'hybrid'].includes(q.get('format'))) add('c.format = ?', q.get('format'));
    if (+q.get('maxPrice') > 0) add("c.price_status IN ('exact','range') AND c.price_min <= ?", +q.get('maxPrice'));
    r = await pool.query(`SELECT ${COURSE_COLS} FROM courses c ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY (c.verification='verified') DESC, c.updated_at DESC LIMIT 100`, a);
    return [200, { courses: r.rows }];
  }
  if (m === 'POST' && p === '/api/compare') {
    const ids = [...new Set((body.ids || []).map(Number).filter(Number.isInteger))];
    if (ids.length < 2 || ids.length > 4) throw new HttpError(400, '2 dan 4 tagacha kurs tanlang');
    r = await pool.query(`SELECT ${COURSE_COLS} FROM courses c WHERE c.id = ANY($1)`, [ids]);
    return [200, { courses: r.rows }];
  }
  if (m === 'GET' && (mm = p.match(/^\/api\/courses\/(\d+)\/reviews$/))) {
    r = await pool.query(`SELECT r.id,r.rating,r.teacher_rating,r.body,r.verified_student,r.created_at,u.name FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.course_id=$1 AND r.status='approved' ORDER BY r.created_at DESC LIMIT 50`, [mm[1]]);
    return [200, { reviews: r.rows }];
  }
  if (m === 'POST' && p === '/api/reviews') {
    needUser(u); limit(ip, 'rev', 10, 3600000);
    const rating = intOrNull(body.rating), tr = intOrNull(body.teacher_rating);
    if (!(rating >= 1 && rating <= 5) || (tr != null && !(tr >= 1 && tr <= 5))) throw new HttpError(400, "Reyting 1–5 oralig'ida bo'lsin");
    const text = str(body.body, 2000); if (text.length < 20) throw new HttpError(400, "Sharh kamida 20 belgi bo'lsin");
    try { await pool.query('INSERT INTO reviews(course_id,user_id,rating,teacher_rating,body) VALUES($1,$2,$3,$4,$5)', [intOrNull(body.course_id), u.id, rating, tr, text]); }
    catch (e) { if (e.code === '23505') throw new HttpError(409, 'Siz bu kursga allaqachon sharh yozgansiz'); if (e.code === '23503') throw new HttpError(404, 'Kurs topilmadi'); throw e; }
    return [201, { ok: true, message: "Sharh moderatsiyaga yuborildi. Tasdiqlangach ko'rinadi." }];
  }
  if (m === 'GET' && p === '/api/favorites') { r = await pool.query(`SELECT ${COURSE_COLS} FROM courses c JOIN favorites f ON f.course_id=c.id WHERE f.user_id=$1`, [needUser(u).id]); return [200, { courses: r.rows }]; }
  if ((m === 'POST' || m === 'DELETE') && (mm = p.match(/^\/api\/favorites\/(\d+)$/))) {
    needUser(u);
    if (m === 'POST') { try { await pool.query('INSERT INTO favorites VALUES($1,$2) ON CONFLICT DO NOTHING', [u.id, mm[1]]); } catch (e) { if (e.code === '23503') throw new HttpError(404, 'Kurs topilmadi'); throw e; } }
    else await pool.query('DELETE FROM favorites WHERE user_id=$1 AND course_id=$2', [u.id, mm[1]]);
    return [200, { ok: true }];
  }
  if (m === 'POST' && p === '/api/support') {
    limit(ip, 'sup', 5, 3600000);
    const kind = ['message', 'problem', 'suggestion'].includes(body.kind) ? body.kind : 'message';
    await pool.query('INSERT INTO support_messages(user_id,kind,contact,body) VALUES($1,$2,$3,$4)', [u ? u.id : null, kind, str(body.contact, 200, false), str(body.body, 3000)]);
    return [201, { ok: true }];
  }
  if (m === 'POST' && p === '/api/ai/chat') {
    limit(ip, 'ai', 15, 600000);
    const msg = str(body.message, 1000);
    if (!env.ANTHROPIC_API_KEY) return [200, { demo: true, reply: 'AI yordamchi demo holatda: serverda ANTHROPIC_API_KEY sozlanmagan. Kurslarni "Kurslar" bo\'limidagi qidiruv orqali topishingiz mumkin.' }];
    const likes = msg.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2).slice(0, 8).map(w => '%' + w + '%');
    r = await pool.query(`SELECT id,title,center_name,category,city,address,phone,website,format,duration_months,lessons_per_week,price_status,price_min,price_max,price_checked_at,verification FROM courses c
      WHERE c.title ILIKE ANY($1) OR c.category ILIKE ANY($1) OR c.city ILIKE ANY($1) OR c.center_name ILIKE ANY($1) ORDER BY (verification='verified') DESC LIMIT 25`, [likes]);
    if (!r.rows.length) r = await pool.query(`SELECT id,title,center_name,category,city,address,phone,website,format,duration_months,lessons_per_week,price_status,price_min,price_max,price_checked_at,verification FROM courses ORDER BY updated_at DESC LIMIT 25`);
    const hist = Array.isArray(body.history) ? body.history.slice(-6).filter(h => h && ['user', 'assistant'].includes(h.role) && typeof h.content === 'string').map(h => ({ role: h.role, content: h.content.slice(0, 1000) })) : [];
    const system = `Sen EDU FIND UZ ta'lim yordamchisisan. O'zbek tilida qisqa va aniq javob ber. FAQAT quyidagi JSON bazadagi kurslardan foydalan. Bazada yo'q narsani (narx, manzil, telefon) o'ylab topma — "bazada ma'lumot yo'q" de. Narxning tekshirilgan sanasini ayt; price_status 'exact' yoki 'range' bo'lmasa narx noma'lum de. Mos kurs bo'lmasa, shuni ochiq ayt.\nBAZA:\n${JSON.stringify(r.rows)}`;
    const ai = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: env.ANTHROPIC_MODEL || 'claude-sonnet-4-6', max_tokens: 900, system, messages: [...hist, { role: 'user', content: msg }] }) });
    if (!ai.ok) throw new HttpError(502, 'AI xizmati vaqtincha ishlamayapti');
    const j = await ai.json();
    return [200, { reply: (j.content || []).map(c => c.text || '').join('\n') }];
  }

  if (m === 'GET' && p === '/api/admin/reviews') { needAdmin(u); r = await pool.query(`SELECT r.*,u.name AS user_name,c.title FROM reviews r JOIN users u ON u.id=r.user_id JOIN courses c ON c.id=r.course_id WHERE r.status='pending' ORDER BY r.created_at`); return [200, { reviews: r.rows }]; }
  if (m === 'POST' && (mm = p.match(/^\/api\/admin\/reviews\/(\d+)\/(approve|reject)$/))) {
    needAdmin(u); const st = mm[2] === 'approve' ? 'approved' : 'rejected';
    await pool.query('UPDATE reviews SET status=$1, verified_student=$2 WHERE id=$3', [st, !!body.verified_student && st === 'approved', mm[1]]);
    await audit(u, 'review.' + mm[2], 'review:' + mm[1], { verified_student: !!body.verified_student }); return [200, { ok: true }];
  }
  if (m === 'POST' && p === '/api/admin/courses') {
    needAdmin(u);
    const ps = body.price_status; if (!['exact', 'range', 'on_request', 'unavailable'].includes(ps)) throw new HttpError(400, "Narx holati noto'g'ri");
    const fmt = ['online', 'offline', 'hybrid'].includes(body.format) ? body.format : 'offline';
    const dur = body.duration_months === '' || body.duration_months == null ? null : +body.duration_months;
    r = await pool.query(`INSERT INTO courses(title,center_name,category,city,address,phone,website,format,duration_months,lessons_per_week,teachers,certificate,job_help,price_status,price_min,price_max,price_checked_at,source_url)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [str(body.title, 200), str(body.center_name, 200), str(body.category, 100), str(body.city, 100), str(body.address, 300, false), str(body.phone, 50, false), str(body.website, 300, false), fmt,
       Number.isFinite(dur) ? dur : null, intOrNull(body.lessons_per_week), str(body.teachers, 500, false), boolOrNull(body.certificate), boolOrNull(body.job_help),
       ps, intOrNull(body.price_min), intOrNull(body.price_max), body.price_checked_at || null, str(body.source_url, 500, false)]);
    await audit(u, 'course.create', 'course:' + r.rows[0].id); return [201, { id: r.rows[0].id }];
  }
  if (m === 'POST' && (mm = p.match(/^\/api\/admin\/courses\/(\d+)\/verification$/))) {
    needAdmin(u); if (!['verified', 'unverified', 'outdated'].includes(body.verification)) throw new HttpError(400, "Holat noto'g'ri");
    const src = str(body.source_url, 500, body.verification === 'verified');
    await pool.query("UPDATE courses SET verification=$1, verified_at=CASE WHEN $1='verified' THEN now() END, source_url=COALESCE($2,source_url), updated_at=now() WHERE id=$3", [body.verification, src, mm[1]]);
    await audit(u, 'course.verification', 'course:' + mm[1], { to: body.verification, source_url: src }); return [200, { ok: true }];
  }
  if (m === 'DELETE' && (mm = p.match(/^\/api\/admin\/courses\/(\d+)$/))) { needAdmin(u); await pool.query('DELETE FROM courses WHERE id=$1', [mm[1]]); await audit(u, 'course.delete', 'course:' + mm[1]); return [200, { ok: true }]; }
  if (m === 'GET' && p === '/api/admin/support') { needAdmin(u); r = await pool.query('SELECT * FROM support_messages ORDER BY created_at DESC LIMIT 100'); return [200, { messages: r.rows }]; }
  if (m === 'GET' && p === '/api/admin/audit') { needAdmin(u); r = await pool.query('SELECT a.*,u.email FROM audit_log a LEFT JOIN users u ON u.id=a.admin_id ORDER BY a.created_at DESC LIMIT 100'); return [200, { log: r.rows }]; }
  throw new HttpError(404, 'Topilmadi');
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      limit(req.socket.remoteAddress, 'all', 300, 60000);
      const pl = verify((req.headers.authorization || '').replace('Bearer ', '')); let u = null;
      if (pl) { const r = await pool.query('SELECT id,name,email,role FROM users WHERE id=$1', [pl.id]); u = r.rows[0] || null; }
      const body = req.method === 'POST' ? await readBody(req) : {};
      const [c, o] = await route(req, u, url, body); return send(res, c, o);
    }
    let f = path.normalize(path.join(PUB, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUB, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.code, { error: e.message });
    console.error(e); send(res, 500, { error: 'Server xatosi' });
  }
}).listen(env.PORT || 3000, () => console.log('EDU FIND UZ: http://localhost:' + (env.PORT || 3000)));
