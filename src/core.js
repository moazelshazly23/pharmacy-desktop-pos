'use strict';
// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => {
  let s = String(v ?? '').trim().replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/٫/g, '.').replace(/٬/g, ',');
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, ''); // 1,500 means one thousand five hundred
  else s = s.replace(',', '.');
  const n = parseFloat(s); return isFinite(n) ? n : 0;
};
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n) => r2(num(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyf = (n) => { n = r2(num(n)); return Number.isInteger(n) ? String(n) : String(+n.toFixed(2)); };
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nowISO = () => { const d = new Date(); return `${today()}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const fdate = (s) => (s ? String(s).slice(0, 10) : '');
const ftime = (s) => (s ? String(s).slice(0, 16).replace('T', ' ') : '');
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const normAr = (s) => String(s || '').toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
const hashPinLegacy = (pin) => { let h = 5381; const s = 'ph1:' + pin; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(16); };
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function pbkdf2(pin, saltHex, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
// New PINs: salted PBKDF2-SHA256. Old simple hashes are still accepted once and upgraded at login.
async function hashPin(pin) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return `pbkdf2$120000$${salt}$${await pbkdf2(pin, salt, 120000)}`;
}
async function verifyPin(pin, stored) {
  stored = String(stored || '');
  if (stored.startsWith('pbkdf2$')) { const [, it, salt, h] = stored.split('$'); return (await pbkdf2(pin, salt, +it)) === h; }
  return stored === hashPinLegacy(pin);
}
const weakPin = (v) => v.length < 4 || v === '1234' || /^(\d)\1+$/.test(v) || '0123456789'.includes(v) || '9876543210'.includes(v);
const WEAK_MSG = 'الرقم السري ضعيف: 4 أرقام على الأقل، ومش 1234 ولا أرقام متكررة أو متتالية';
async function audit(action, detail = '') {
  try { await api.run('INSERT INTO audit_log(ts,user_id,user_name,action,detail) VALUES(?,?,?,?,?)', [nowISO(), App.user?.id || null, App.user?.name || '', action, String(detail).slice(0, 300)]); } catch (e) { console.error('audit', e); }
}
const debounce = (fn, ms = 160) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const Q = (sql, p) => api.all(sql, p);
const Q1 = async (sql, p) => (await api.all(sql, p))[0];
const X = (sql, p) => api.run(sql, p);

// ---------- state ----------
const App = { user: null, settings: {}, view: 'pos', shift: null, held: [] };
const ACT = {}; // click actions: data-act="name"
const ROLE_NAMES = { admin: 'مدير', pharmacist: 'صيدلي', cashier: 'كاشير' };
const VIEWS = [
  { id: 'pos', ic: '🧾', t: 'المبيعات', roles: ['admin', 'pharmacist', 'cashier'] },
  { id: 'items', ic: '💊', t: 'الأصناف', roles: ['admin', 'pharmacist', 'cashier'] },
  { id: 'stock', ic: '📦', t: 'المخزون والتنبيهات', roles: ['admin', 'pharmacist'], badge: true },
  { id: 'purchases', ic: '🚚', t: 'المشتريات', roles: ['admin', 'pharmacist'] },
  { id: 'returns', ic: '↩️', t: 'المرتجعات', roles: ['admin', 'pharmacist', 'cashier'] },
  { id: 'parties', ic: '👥', t: 'العملاء والموردين', roles: ['admin', 'pharmacist', 'cashier'] },
  { id: 'cash', ic: '💵', t: 'الوردية والمصروفات', roles: ['admin', 'pharmacist', 'cashier'] },
  { id: 'reports', ic: '📊', t: 'التقارير', roles: ['admin', 'pharmacist'] },
  { id: 'settings', ic: '⚙️', t: 'الإعدادات', roles: ['admin'] },
];
const Views = {}; // id -> async render(el)
const can = (id) => VIEWS.find((v) => v.id === id)?.roles.includes(App.user?.role);
const isAdmin = () => App.user?.role === 'admin';
const cur = () => App.settings.currency || 'ج.م';

async function loadSettings() {
  const rows = await Q('SELECT key,value FROM settings');
  App.settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  document.documentElement.dataset.theme = App.settings.theme === 'dark' ? 'dark' : 'light';
}
async function setSetting(k, v) {
  await X('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [k, String(v)]);
  App.settings[k] = String(v);
}

// ---------- UI primitives ----------
function toast(msg, kind = '') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 3600);
}
function modal(title, body, opts = {}) {
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<div class="modal ${opts.wide ? 'wide' : ''}"><header><span>${title}</span><button class="x" data-close>×</button></header><div class="bd">${body}</div>${opts.footer ? `<footer>${opts.footer}</footer>` : ''}</div>`;
  const close = () => { ov.remove(); opts.onClose && opts.onClose(); };
  ov.addEventListener('mousedown', (e) => { if (e.target === ov && !opts.sticky) close(); });
  ov.querySelector('[data-close]').onclick = close;
  ov.close = close;
  ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  document.body.appendChild(ov);
  const f = ov.querySelector('[autofocus]') || ov.querySelector('input,select,textarea');
  if (f && !opts.noFocus) setTimeout(() => f.focus(), 30);
  return ov;
}
function confirmBox(msg, okText = 'تأكيد', danger = false) {
  return new Promise((res) => {
    const m = modal('تأكيد', `<p style="font-size:15px;margin:0">${msg}</p>`, {
      footer: `<button class="btn ${danger ? 'danger' : ''}" data-ok>${okText}</button><button class="btn sec" data-no>إلغاء</button>`,
      onClose: () => res(false), noFocus: true,
    });
    m.querySelector('[data-ok]').onclick = () => { m.remove(); res(true); };
    m.querySelector('[data-no]').onclick = () => m.close();
    m.querySelector('[data-ok]').focus();
  });
}
function promptBox(title, label, def = '', type = 'text') {
  return new Promise((res) => {
    const m = modal(title, `<div class="field"><label>${label}</label><input id="pb" type="${type}" value="${esc(def)}"></div>`, {
      footer: `<button class="btn" data-ok>موافق</button><button class="btn sec" data-no>إلغاء</button>`, onClose: () => res(null),
    });
    const done = () => { const v = $('#pb', m).value; m.remove(); res(v); };
    m.querySelector('[data-ok]').onclick = done; m.querySelector('[data-no]').onclick = () => m.close();
    $('#pb', m).addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); });
  });
}
function table(cols, rows, opts = {}) {
  if (!rows.length) return `<div class="empty">${opts.empty || 'مفيش بيانات'}</div>`;
  return `<div class="tw" style="${opts.maxh ? `max-height:${opts.maxh}` : ''}"><table><thead><tr>${cols.map((c) => `<th class="${c.n ? 'n' : ''}">${c.h}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr ${r._attr || ''}>${cols.map((c) => `<td class="${c.n ? 'n' : ''}">${typeof c.f === 'function' ? c.f(r) : esc(r[c.f])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function downloadCSV(name, header, rows) {
  const csv = '\uFEFF' + [header, ...rows].map((r) => r.map((v) => { let t = String(v ?? ''); if (/^[=+@\t\r]/.test(t) || (/^-/.test(t) && isNaN(Number(t)))) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; }).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name; a.click();
}
function expiryBadge(exp) {
  if (!exp) return '<span class="pill gray">بدون تاريخ</span>';
  const d = Math.round((new Date(exp) - new Date(today())) / 864e5);
  if (d < 0) return `<span class="pill red">منتهي منذ ${-d} يوم</span>`;
  if (d <= num(App.settings.expiry_days || 90)) return `<span class="pill amber">باقي ${d} يوم</span>`;
  return `<span class="pill">${fdate(exp)}</span>`;
}
const drugLabel = (d) => `${esc(d.arabic || d.name)}`;

// ---------- drug search (shared) ----------
async function searchDrugs(text, { limit = 40, kind = '', inStock = false, withStock = true } = {}) {
  text = String(text || '').trim();
  if (!text) return [];
  const sel = `SELECT d.*, ${withStock ? '(SELECT COALESCE(SUM(qty),0) FROM batches b WHERE b.drug_id=d.id) AS stock' : '0 AS stock'} FROM drugs d`;
  if (/^\d{6,}$/.test(text)) {
    const r = await Q(`${sel} WHERE d.barcode=? LIMIT ${limit}`, [text]);
    if (r.length) return r;
  }
  const toks = normAr(text).split(' ').filter(Boolean);
  const where = toks.map(() => 'd.search LIKE ?').join(' AND ');
  const params = toks.map((t) => `%${t}%`);
  let extra = kind ? ` AND d.kind='${kind === 'cosmetic' ? 'cosmetic' : 'drug'}'` : '';
  if (inStock) extra += ' AND (SELECT COALESCE(SUM(qty),0) FROM batches b WHERE b.drug_id=d.id)>0';
  // rank: starts-with name first, in-stock first
  const first = toks[0] || '';
  return Q(`${sel} WHERE ${where}${extra} ORDER BY (d.search LIKE ?) DESC, stock>0 DESC, length(d.arabic) ASC LIMIT ${limit}`, [...params, first + '%']);
}
async function getDrug(id) {
  return Q1('SELECT d.*, (SELECT COALESCE(SUM(qty),0) FROM batches b WHERE b.drug_id=d.id) AS stock FROM drugs d WHERE d.id=?', [id]);
}
async function alternativesOf(drug, limit = 30) {
  const a = String(drug.active || '').trim().toLowerCase();
  if (!a) return [];
  return Q(`SELECT d.*, (SELECT COALESCE(SUM(qty),0) FROM batches b WHERE b.drug_id=d.id) AS stock FROM drugs d WHERE lower(d.active)=? AND d.id<>? ORDER BY stock>0 DESC, d.price ASC LIMIT ${limit}`, [a, drug.id]);
}
function stockPill(s, min = 0) {
  s = num(s);
  if (s <= 0) return '<span class="stk out">نفذ</span>';
  if (min && s <= min) return `<span class="stk low">${qtyf(s)} (قليل)</span>`;
  return `<span class="stk in">${qtyf(s)}</span>`;
}

// ---------- auth / shift ----------
async function currentShift() {
  // The drawer is shared on one device: the open shift belongs to whoever opened it, but everyone sells into it and anyone can close it.
  App.shift = (await Q1('SELECT * FROM shifts WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1')) || null;
  if (App.shift) App.warnedShift = false; // allow the no-shift warning again if the shift gets closed
  return App.shift;
}
function renderLogin() {
  Q('SELECT id,name,role FROM users WHERE active=1 ORDER BY id').then((users) => {
    $('#app').innerHTML = `<div class="login"><form class="box" id="lf" autocomplete="off">
      <div class="logo">⚕️</div><h2>${esc(App.settings.pharmacy_name || 'نظام الصيدلية')}</h2><p>سجّل دخولك للمتابعة</p>
      <div class="field"><label>المستخدم</label><select id="lu">${users.map((u) => `<option value="${u.id}">${esc(u.name)} (${ROLE_NAMES[u.role] || u.role})</option>`).join('')}</select></div>
      <div class="field"><label>الرقم السري</label><input id="lp" type="password" inputmode="numeric" autofocus></div>
      <div class="err" id="le"></div><button class="btn lg" style="width:100%">دخول</button></form></div>`;
    $('#lf').onsubmit = async (e) => {
      e.preventDefault();
      const u = await Q1('SELECT * FROM users WHERE id=? AND active=1', [$('#lu').value]);
      if (!u) return;
      const left = (u.locked_until || 0) - Date.now();
      if (left > 0) { $('#le').textContent = `الحساب مقفول مؤقتاً بعد محاولات غلط. حاول بعد ${Math.ceil(left / 60000)} دقيقة أو اطلب من المدير فتحه`; return; }
      if (!(await verifyPin($('#lp').value, u.pin_hash))) {
        const f = (u.failed_count || 0) + 1, lock = f >= 5;
        await X('UPDATE users SET failed_count=?, locked_until=? WHERE id=?', [lock ? 0 : f, lock ? Date.now() + 5 * 60000 : 0, u.id]);
        if (lock) await X('UPDATE users SET failed_count=0 WHERE id=?', [u.id]);
        App.user = null; await audit(lock ? 'قفل حساب' : 'دخول فاشل', u.name);
        $('#le').textContent = lock ? 'محاولات غلط كتير. الحساب اتقفل 5 دقايق' : `الرقم السري غلط (${f} من 5)`; $('#lp').select(); return;
      }
      if (!String(u.pin_hash).startsWith('pbkdf2$')) { u.pin_hash = await hashPin($('#lp').value); await X('UPDATE users SET pin_hash=? WHERE id=?', [u.pin_hash, u.id]); }
      await X('UPDATE users SET failed_count=0, locked_until=0 WHERE id=?', [u.id]);
      App.user = u; await currentShift(); await audit('دخول', u.name);
      let shiftOther = null;
      if (App.shift && App.shift.user_id !== u.id) { const o = await Q1('SELECT name FROM users WHERE id=?', [App.shift.user_id]); shiftOther = o?.name; }
      if (u.must_change) await forceChangePin();
      renderShell(); startIdleLock(); go(can('pos') ? 'pos' : 'items');
      if (shiftOther) setTimeout(() => toast(`الوردية المفتوحة فتحها ${shiftOther}. الدرج مشترك: مبيعاتك بتتحسب على نفس الوردية`, ''), 700);
    };
  });
}
function forceChangePin() {
  return new Promise((res) => {
    const m = modal('غيّر الرقم السري', `<p class="mute">ده أول دخول بالرقم الافتراضي. اختار رقم سري جديد (4 أرقام على الأقل).</p><div class="field"><label>الرقم السري الجديد</label><input id="np" type="password" inputmode="numeric"></div><div class="err" id="ne"></div>`, { sticky: true, footer: '<button class="btn" data-ok>حفظ</button>' });
    m.querySelector('[data-ok]').onclick = async () => {
      const v = $('#np', m).value;
      if (weakPin(v)) { $('#ne', m).textContent = WEAK_MSG; return; }
      await X('UPDATE users SET pin_hash=?, must_change=0 WHERE id=?', [await hashPin(v), App.user.id]); await audit('تغيير الرقم السري', App.user.name);
      App.user.must_change = 0; m.remove(); toast('تم تغيير الرقم السري', 'ok'); res();
    };
  });
}
function logout() { clearInterval(idleT); $$('.ov').forEach((o) => o.remove()); $('#receipt') && ($('#receipt').innerHTML = ''); if (App.user) audit('خروج', App.user.name);
  if (typeof POS !== 'undefined') { POS.cart = []; POS.customer = null; POS.discVal = 0; POS.discType = 'fixed'; } App.user = null; App.shift = null; renderLogin(); }
ACT.logout = logout;
ACT['pin-change'] = () => {
  const m = modal('تغيير الرقم السري', `<div class="field"><label>الرقم السري الحالي</label><input id="pc_o" type="password" inputmode="numeric"></div><div class="field"><label>الرقم السري الجديد</label><input id="pc_n" type="password" inputmode="numeric"></div><div class="err" id="pc_e"></div>`, { footer: '<button class="btn" id="pc_ok">حفظ</button>' });
  $('#pc_ok', m).onclick = async () => {
    const u = await Q1('SELECT pin_hash FROM users WHERE id=?', [App.user.id]), n = $('#pc_n', m).value;
    if (!(await verifyPin($('#pc_o', m).value, u.pin_hash))) { $('#pc_e', m).textContent = 'الرقم السري الحالي غلط'; return; }
    if (weakPin(n)) { $('#pc_e', m).textContent = WEAK_MSG; return; }
    await X('UPDATE users SET pin_hash=?, must_change=0 WHERE id=?', [await hashPin(n), App.user.id]); await audit('تغيير الرقم السري', App.user.name);
    m.close(); toast('تم تغيير الرقم السري', 'ok');
  };
};

// ---------- shell / router ----------
let clockT;
function renderShell() {
  const nav = VIEWS.filter((v) => can(v.id)).map((v) => `<button data-act="nav" data-v="${v.id}" id="nav-${v.id}"><span class="ic">${v.ic}</span>${v.t}${v.badge ? '<span class="badge" id="nb-alerts" hidden></span>' : ''}</button>`).join('');
  $('#app').innerHTML = `<div class="shell"><aside class="side">
    <div class="brand"><div class="logo">⚕️</div><div>${esc(App.settings.pharmacy_name || 'الصيدلية')}<small>نظام إدارة الصيدلية</small></div></div>
    <nav class="nav">${nav}</nav>
    <div class="userbox"><div><b>${esc(App.user.name)}</b><span class="small">${ROLE_NAMES[App.user.role]}</span></div><button data-act="pin-change" title="تغيير الرقم السري">🔑</button><button data-act="logout">خروج</button></div></aside>
    <section class="main"><div class="top"><h1 id="ttl"></h1><span class="sp"></span><span id="shiftpill" class="pill gray"></span><span class="clock" id="clock"></span></div><div class="view" id="view"></div></section></div>`;
  clearInterval(clockT);
  const tick = () => { const c = $('#clock'); if (c) c.textContent = new Date().toLocaleString('ar-EG', { weekday: 'long', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'long' }); };
  tick(); clockT = setInterval(tick, 20000);
  refreshBadges(); updateShiftPill();
}
function updateShiftPill() {
  const p = $('#shiftpill'); if (!p) return;
  p.className = 'pill ' + (App.shift ? '' : 'amber'); p.textContent = App.shift ? 'وردية مفتوحة' : 'لا توجد وردية مفتوحة';
}
async function refreshBadges() {
  try {
    const days = num(App.settings.expiry_days || 90), lim = addDays(today(), days);
    const e = await Q1("SELECT COUNT(*) c FROM batches WHERE qty>0 AND expiry IS NOT NULL AND expiry<=?", [lim]);
    const s = await Q1("SELECT COUNT(*) c FROM drugs d WHERE d.min_qty>0 AND (SELECT COALESCE(SUM(qty),0) FROM batches b WHERE b.drug_id=d.id)<=d.min_qty");
    const n = e.c + s.c, b = $('#nb-alerts'); if (b) { b.hidden = !n; b.textContent = n; }
  } catch (e) { /* ignore */ }
}
async function go(id) {
  if (!can(id)) return;
  if (App.view === 'pos' && id !== 'pos' && Views.posLeave) Views.posLeave();
  App.view = id;
  $$('.nav button').forEach((b) => b.classList.toggle('on', b.dataset.v === id));
  $('#ttl').textContent = VIEWS.find((v) => v.id === id).t;
  const el = $('#view'); el.innerHTML = '<div class="empty">جاري التحميل...</div>';
  try { await Views[id](el); } catch (e) { console.error(e); el.innerHTML = `<div class="alert danger">حصل خطأ: ${esc(e.message)}</div>`; }
  refreshBadges(); updateShiftPill();
}
ACT.nav = (el) => go(el.dataset.v);
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && ACT[el.dataset.act]) { e.preventDefault(); Promise.resolve(ACT[el.dataset.act](el, e)).catch((err) => { console.error(err); toast('خطأ: ' + err.message, 'err'); }); }
});
document.addEventListener('keydown', (e) => {
  if (!App.user || document.querySelector('.ov')) return; // no view jumping while a dialog is open
  if (e.key === 'F2') { e.preventDefault(); go('pos'); }
  if (e.key === 'F3') { e.preventDefault(); go('items'); }
});

// ---------- auto-lock after idle ----------
let idleT = null, lastAct = Date.now();
['mousemove', 'mousedown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => { lastAct = Date.now(); }, true));
function startIdleLock() {
  clearInterval(idleT);
  idleT = setInterval(() => {
    const mins = num(App.settings.idle_lock ?? 10);
    if (!App.user || !mins || document.querySelector('.lockov') || Date.now() - lastAct < mins * 60000) return;
    lockScreen();
  }, 15000);
}
let lockFails = 0;
function lockScreen() {
  lockFails = 0;
  const ov = document.createElement('div'); ov.className = 'ov lockov'; ov.style.zIndex = 9999; ov.style.background = 'var(--bg, #f4f6f8)';
  ov.innerHTML = `<form class="login" style="width:100%"><div class="box"><div class="logo">🔒</div><h2>الشاشة مقفولة</h2><p>${esc(App.user.name)} - اكتب الرقم السري للمتابعة (السلة والفاتورة محفوظة)</p><div class="field"><input id="lkp" type="password" inputmode="numeric" autofocus></div><div class="err" id="lke"></div><button class="btn lg" style="width:100%">فتح</button><button type="button" class="btn sec" style="width:100%;margin-top:8px" id="lko">تسجيل خروج</button></div></form>`;
  document.body.appendChild(ov);
  setTimeout(() => $('#lkp', ov).focus(), 30);
  $('#lko', ov).onclick = () => logout();
  ov.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const u = await Q1('SELECT pin_hash, failed_count FROM users WHERE id=?', [App.user.id]);
    if (await verifyPin($('#lkp', ov).value, u.pin_hash)) { if (u.failed_count) await X('UPDATE users SET failed_count=0 WHERE id=?', [App.user.id]); ov.remove(); lastAct = Date.now(); lockFails = 0; return; }
    lockFails++;
    await audit('دخول فاشل (شاشة القفل)', App.user.name);
    if (lockFails >= 5) { await X('UPDATE users SET locked_until=? WHERE id=?', [Date.now() + 5 * 60000, App.user.id]); await audit('قفل حساب', App.user.name); ov.remove(); logout(); return; } // no unlimited guessing: after 5 wrong tries the full login (with lockout) applies
    $('#lke', ov).textContent = `الرقم السري غلط (${lockFails} من 5 وبعدها خروج)`; $('#lkp', ov).select();
  };
}
