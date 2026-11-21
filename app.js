'use strict';
const $ = s => document.querySelector(s);
const S = { token: localStorage.getItem('token'), user: null, compare: new Set(), favs: new Set(), history: [] };
function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null) e.setAttribute(k, v); }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
}
function toast(t) { const n = $('#toast'); n.textContent = t; n.classList.add('on'); setTimeout(() => n.classList.remove('on'), 2800); }
async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Xatolik'); return j;
}
const fmtMoney = n => Number(n).toLocaleString('ru-RU').replace(/\u00a0/g, ' ') + " so'm";
const FMT = { online: 'Onlayn', offline: 'Oflayn', hybrid: 'Aralash' };
const VER = { verified: ['Verified', 'b-verified'], unverified: ['Tasdiqlanmagan', 'b-unverified'], outdated: ["Ma'lumot eskirgan", 'b-outdated'] };
const yn = v => v === true ? 'Ha' : v === false ? "Yo'q" : "Ma'lumot yo'q";
function priceText(c) {
  const d = c.price_checked_at ? ' (tekshirilgan: ' + String(c.price_checked_at).slice(0, 10) + ')' : ' (sana ko\'rsatilmagan)';
  if (c.price_status === 'exact' && c.price_min != null) return fmtMoney(c.price_min) + d;
  if (c.price_status === 'range' && c.price_min != null) return fmtMoney(c.price_min) + ' – ' + fmtMoney(c.price_max ?? c.price_min) + d;
  if (c.price_status === 'on_request') return "Narx so'rov orqali";
  return 'Narx mavjud emas';
}
const badge = c => { const [t, k] = VER[c.verification]; return el('span', { class: 'badge ' + k }, t); };
const rating = c => c.review_count ? c.avg_rating + ' / 5 (' + c.review_count + ' sharh)' : 'Sharh yo\'q';

function card(c) {
  const ch = el('input', { type: 'checkbox', 'aria-label': 'Taqqoslash uchun tanlash', onchange: e => { e.target.checked ? S.compare.add(c.id) : S.compare.delete(c.id); if (S.compare.size > 4) { S.compare.delete(c.id); e.target.checked = false; toast('Eng ko\'pi bilan 4 ta kurs'); } updateBar(); } });
  ch.checked = S.compare.has(c.id); ch.style.width = 'auto';
  return el('article', { class: 'card' },
    el('div', { class: 'row', style: 'margin:0;padding:0;justify-content:space-between' }, badge(c), el('label', { class: 'small' }, ch, ' Solishtirish')),
    el('h3', {}, c.title), el('div', { class: 'meta' }, c.center_name + ' · ' + c.category),
    el('div', { class: 'meta' }, c.city + (c.address ? ', ' + c.address : '') + ' · ' + FMT[c.format]),
    el('div', { class: 'price' }, priceText(c)),
    el('div', { class: 'meta' }, (c.duration_months ? c.duration_months + ' oy' : 'Davomiylik noma\'lum') + (c.lessons_per_week ? ' · haftada ' + c.lessons_per_week + ' dars' : '') + ' · ' + rating(c)),
    el('div', { class: 'row' },
      c.phone ? el('a', { href: 'tel:' + c.phone.replace(/[^\d+]/g, '') }, c.phone) : null,
      c.website && /^https?:\/\//.test(c.website) ? el('a', { href: c.website, target: '_blank', rel: 'noopener' }, 'Sayt') : null,
      el('button', { class: 'btn ghost sm', onclick: () => showReviews(c) }, 'Sharhlar'),
      el('button', { class: 'btn ghost sm', onclick: () => toggleFav(c.id) }, S.favs.has(c.id) ? 'Sevimlidan olish' : 'Sevimli')));
}
function updateBar() { const n = S.compare.size; $('#compare-bar').hidden = !n; $('#compare-text').textContent = n + ' ta kurs tanlandi (2–4 ta kerak)'; }
async function search(params = '') {
  try { const { courses } = await api('/courses' + params); $('#count').textContent = '(' + courses.length + ')';
    const box = $('#results'); box.replaceChildren(...(courses.length ? courses.map(card) : [el('div', { class: 'empty' }, 'Hech narsa topilmadi. Boshqa so\'z yoki shaharni sinab ko\'ring.')]));
  } catch (e) { toast(e.message); }
}
$('#search-form').addEventListener('submit', e => { e.preventDefault(); const p = new URLSearchParams(); new FormData(e.target).forEach((v, k) => v && p.set(k, v)); search('?' + p); });
$('#compare-clear').onclick = () => { S.compare.clear(); updateBar(); search(); };
$('#compare-go').onclick = async () => {
  try { const { courses } = await api('/compare', 'POST', { ids: [...S.compare] }); const rows = [
    ['Markaz', c => c.center_name], ['Narx', priceText], ['Davomiylik', c => c.duration_months ? c.duration_months + ' oy' : "Ma'lumot yo'q"], ['Haftalik darslar', c => c.lessons_per_week ?? "Ma'lumot yo'q"],
    ['Format', c => FMT[c.format]], ['Joylashuv', c => c.city + (c.address ? ', ' + c.address : '')], ["O'qituvchilar", c => c.teachers || "Ma'lumot yo'q"], ['Sertifikat', c => yn(c.certificate)],
    ['Ishga joylashish yordami', c => yn(c.job_help)], ['Reyting', rating], ['Ishonchlilik', c => VER[c.verification][0]]];
    $('#compare-table').replaceChildren(el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, ''), courses.map(c => el('th', {}, c.title)))), el('tbody', {}, rows.map(([l, f]) => el('tr', {}, el('th', {}, l), courses.map(c => el('td', {}, String(f(c)))))))));
    $('#taqqoslash').hidden = false; location.hash = '#taqqoslash';
  } catch (e) { toast(e.message); }
};

async function showReviews(c) {
  const { reviews } = await api('/courses/' + c.id + '/reviews');
  $('#review-title').textContent = c.title;
  const f = $('#review-form'); f.dataset.course = c.id;
  const old = f.querySelector('.list'); if (old) old.remove();
  f.querySelector('h3').after(el('div', { class: 'list small' }, reviews.length ? reviews.map(r => el('p', {}, el('strong', {}, r.name + ' — ' + r.rating + '/5 '), r.verified_student ? el('span', { class: 'badge b-verified' }, 'Verified') : null, el('br'), r.body)) : el('p', { class: 'muted' }, 'Hali tasdiqlangan sharh yo\'q.')));
  $('#review-err').textContent = ''; $('#review-dialog').showModal();
}
$('#review-close').onclick = () => $('#review-dialog').close();
$('#review-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!S.user) { $('#review-dialog').close(); return openAuth(); }
  const d = Object.fromEntries(new FormData(e.target)); d.course_id = e.target.dataset.course;
  try { const r = await api('/reviews', 'POST', d); $('#review-dialog').close(); e.target.reset(); toast(r.message); } catch (er) { $('#review-err').textContent = er.message; }
});
async function toggleFav(id) {
  if (!S.user) return openAuth();
  try { S.favs.has(id) ? await api('/favorites/' + id, 'DELETE') : await api('/favorites/' + id, 'POST'); await loadFavs(); search(); } catch (e) { toast(e.message); }
}
async function loadFavs() { const { courses } = await api('/favorites'); S.favs = new Set(courses.map(c => c.id)); $('#fav-results').replaceChildren(...(courses.length ? courses.map(card) : [el('div', { class: 'empty' }, 'Sevimli kurslar yo\'q.')])); }

// auth
let registering = false;
function openAuth() { $('#auth-err').textContent = ''; $('#auth-dialog').showModal(); }
function setMode(reg) { registering = reg; $('#auth-title').textContent = reg ? "Ro'yxatdan o'tish" : 'Kirish'; $('#auth-form [name=name]').hidden = !reg; $('#auth-form [name=name]').required = reg; $('#auth-switch').textContent = reg ? 'Kirish' : "Ro'yxatdan o'tish"; }
$('#auth-switch').onclick = () => setMode(!registering); $('#auth-close').onclick = () => $('#auth-dialog').close();
$('#auth-form').addEventListener('submit', async e => {
  e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
  try { const r = await api(registering ? '/auth/register' : '/auth/login', 'POST', d); S.token = r.token; localStorage.setItem('token', r.token); $('#auth-dialog').close(); await init(); toast('Xush kelibsiz, ' + r.user.name); } catch (er) { $('#auth-err').textContent = er.message; }
});
function logout() { localStorage.removeItem('token'); S.token = null; S.user = null; S.favs.clear(); renderAuth(); }
function renderAuth() {
  const a = $('#auth-area'); a.replaceChildren(S.user ? el('span', {}, S.user.name + ' ', el('button', { class: 'btn ghost sm', onclick: logout }, 'Chiqish')) : el('button', { class: 'btn ghost', onclick: openAuth }, 'Kirish'));
  $('#nav-admin').hidden = !(S.user && S.user.role === 'admin'); $('#nav-fav').hidden = !S.user; $('#admin').hidden = $('#nav-admin').hidden; $('#sevimlilar').hidden = !S.user;
}

// AI
$('#chat-form').addEventListener('submit', async e => {
  e.preventDefault(); const inp = e.target.m, msg = inp.value.trim(); if (!msg) return; inp.value = '';
  const log = $('#chat-log'); log.append(el('div', { class: 'bubble me' }, msg)); const wait = el('div', { class: 'bubble bot' }, '…'); log.append(wait); log.scrollTop = log.scrollHeight;
  try { const r = await api('/ai/chat', 'POST', { message: msg, history: S.history }); wait.textContent = r.reply; S.history.push({ role: 'user', content: msg }, { role: 'assistant', content: r.reply }); }
  catch (er) { wait.textContent = 'Xatolik: ' + er.message; } log.scrollTop = log.scrollHeight;
});

// support
$('#support-form').addEventListener('submit', async e => { e.preventDefault(); try { await api('/support', 'POST', Object.fromEntries(new FormData(e.target))); e.target.reset(); toast('Xabar yuborildi'); } catch (er) { toast(er.message); } });

// admin
async function loadAdmin() {
  if (!S.user || S.user.role !== 'admin') return;
  const [rv, su, au, cs] = await Promise.all([api('/admin/reviews'), api('/admin/support'), api('/admin/audit'), api('/courses')]);
  const act = (id, what, v) => async () => { try { await api('/admin/reviews/' + id + '/' + what, 'POST', { verified_student: v }); loadAdmin(); } catch (e) { toast(e.message); } };
  $('#pending').replaceChildren(...(rv.reviews.length ? rv.reviews.map(r => el('div', { class: 'small' }, el('strong', {}, r.title + ' — ' + r.user_name + ' (' + r.rating + '/5)'), el('p', {}, r.body),
    el('button', { class: 'btn sm', onclick: act(r.id, 'approve', false) }, 'Tasdiqlash'), ' ', el('button', { class: 'btn sm', onclick: act(r.id, 'approve', true) }, 'Verified talaba sifatida'), ' ', el('button', { class: 'btn ghost sm', onclick: act(r.id, 'reject') }, 'Rad etish'))) : [el('p', { class: 'muted' }, 'Kutilayotgan sharh yo\'q.')]));
  $('#verify-list').replaceChildren(...(cs.courses.length ? cs.courses.map(c => el('div', { class: 'row small' }, badge(c), c.title, el('button', { class: 'btn ghost sm', onclick: async () => { const src = prompt('Rasmiy manba havolasi (https://…):'); if (!src) return; try { await api('/admin/courses/' + c.id + '/verification', 'POST', { verification: 'verified', source_url: src }); loadAdmin(); search(); } catch (e) { toast(e.message); } } }, 'Verified qilish'),
    el('button', { class: 'btn ghost sm', onclick: async () => { await api('/admin/courses/' + c.id + '/verification', 'POST', { verification: 'outdated' }); loadAdmin(); search(); } }, 'Eskirgan'),
    el('button', { class: 'btn ghost sm', onclick: async () => { if (confirm("O'chirilsinmi?")) { await api('/admin/courses/' + c.id, 'DELETE'); loadAdmin(); search(); } } }, "O'chirish"))) : [el('p', { class: 'muted' }, 'Kurslar yo\'q.')]));
  $('#support-list').replaceChildren(...(su.messages.length ? su.messages.map(m => el('p', { class: 'small' }, '[' + m.kind + '] ' + m.body + (m.contact ? ' — ' + m.contact : ''))) : [el('p', { class: 'muted' }, 'Murojaat yo\'q.')]));
  $('#audit-list').replaceChildren(...au.log.map(l => el('div', {}, String(l.created_at).slice(0, 16).replace('T', ' ') + ' ' + (l.email || '?') + ' · ' + l.action + ' · ' + (l.target || ''))));
}
$('#course-form').addEventListener('submit', async e => {
  e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
  for (const k of ['certificate', 'job_help']) d[k] = d[k] === '1' ? true : null;
  try { await api('/admin/courses', 'POST', d); e.target.reset(); toast('Kurs qo\'shildi'); loadAdmin(); search(); } catch (er) { toast(er.message); }
});
async function init() {
  if (S.token) { try { S.user = (await api('/me')).user; await loadFavs(); } catch { logout(); } }
  renderAuth(); loadAdmin();
}
setMode(false); updateBar(); search(); init();
