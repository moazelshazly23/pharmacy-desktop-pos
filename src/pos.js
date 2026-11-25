'use strict';
// ---------- POS ----------
const POS = { cart: [], customer: null, discType: 'fixed', discVal: 0, results: [], sel: 0, lastItem: null, note: '' };
const unitPrice = (l) => (l.unit === 'strip' ? l.price / l.strips : l.price);
const lineGross = (l) => r2(unitPrice(l) * l.n);
const lineTotal = (l) => Math.max(0, r2(lineGross(l) - num(l.disc)));
const packQty = (l) => (l.unit === 'strip' ? l.n / l.strips : l.n);
const cartSub = () => r2(POS.cart.reduce((s, l) => s + lineTotal(l), 0));
const cartDisc = () => { const s = cartSub(); const v = num(POS.discVal); return Math.min(s, POS.discType === 'pct' ? r2((s * v) / 100) : v); };
const cartTotal = () => r2(cartSub() - cartDisc());

Views.posLeave = () => {};
Views.pos = async (el) => {
  try { App.held = JSON.parse(localStorage.getItem('held') || '[]'); if (!Array.isArray(App.held)) App.held = []; } catch (e) { App.held = []; }
  const before = App.held.length;
  App.held = App.held.filter((h) => h && h.t && fdate(h.t) >= addDays(today(), -7)); // parked invoices older than a week are stale: drop them quietly
  if (App.held.length !== before) localStorage.setItem('held', JSON.stringify(App.held));
  el.style.padding = '14px 18px';
  el.innerHTML = `<div class="pos"><div class="pos-left">
    <div class="searchbar"><span class="si">🔍</span><input id="q" placeholder="امسح الباركود أو اكتب اسم الدواء / المادة الفعالة... (F2)" autocomplete="off" autofocus><div class="results" id="res" hidden></div></div>
    <div id="warns"></div>
    <div class="card cart" id="cartbox" style="padding:0"></div>
    <div class="row"><button class="btn sec" data-act="pos-hold">⏸ تعليق الفاتورة (F6)</button><button class="btn sec" data-act="pos-held">📂 الفواتير المعلقة <span id="hc" class="pill">0</span></button><button class="btn sec" data-act="pos-clear">🗑 فاتورة جديدة</button><span class="grow"></span><span class="mute small">Enter: إضافة | F9: دفع | Del: حذف آخر صنف</span></div>
  </div><div class="pos-right">
    <div class="card totals" id="totals"></div>
    <div class="card grow" style="overflow:hidden;display:flex;flex-direction:column"><div class="row mb"><b>🔁 البدائل (نفس المادة الفعالة)</b><span class="mute small"> راجع التركيز والشكل الدوائي قبل الصرف</span></div><div class="alts" id="alts"><div class="mute small">اختار صنف من الفاتورة أو من البحث عشان تظهر بدائله مع السعر والمتاح.</div></div></div>
  </div></div>`;
  const q = $('#q');
  const doSearch = debounce(async () => {
    const v = q.value.trim();
    if (!v) { hideRes(); return; }
    POS.resultsFor = v; POS.results = await searchDrugs(v, { limit: 30 }); POS.sel = 0; showRes();
  }, 140);
  q.addEventListener('input', doSearch);
  q.addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowDown') { POS.sel = Math.min(POS.sel + 1, POS.results.length - 1); showRes(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { POS.sel = Math.max(POS.sel - 1, 0); showRes(); e.preventDefault(); }
    else if (e.key === 'Escape') { q.value = ''; hideRes(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const v = q.value.trim(); if (!v) return;
      if (/^\d{6,}$/.test(v)) { // barcode scan
        const r = await searchDrugs(v, { limit: 30 }).then((x) => x.filter((d) => d.barcode === v));
        if (r.length > 1) { // the catalog has barcodes shared by different products: never guess, let the cashier pick
          POS.results = r; POS.sel = 0; showRes(); toast('الباركود ده مسجل لأكتر من صنف. اختار الصنف الصح من القائمة', 'err'); return;
        }
        if (r.length) { await addToCart(r[0]); q.value = ''; hideRes(); }
        else await unknownBarcode(v);
        return;
      }
      if (POS.resultsFor !== v || !POS.results.length) { POS.results = await searchDrugs(v, { limit: 30 }); POS.resultsFor = v; POS.sel = 0; } // never add a result of an older, half-typed search
      const d = POS.results[POS.sel]; if (d) { await addToCart(d); q.value = ''; hideRes(); }
    }
  });
  q.addEventListener('blur', () => setTimeout(hideRes, 180));
  el.addEventListener('keydown', (e) => {
    if (document.querySelector('.ov')) return; // a dialog (payment, held, ...) owns the keyboard now
    if (e.key === 'F9') { e.preventDefault(); ACT['pos-pay'](); }
    if (e.key === 'F6') { e.preventDefault(); ACT['pos-hold'](); }
    if (e.key === 'Delete' && document.activeElement === q && !q.value) { POS.cart.pop(); renderCart(); }
  });
  renderCart(); q.focus();
};
function showRes() {
  const r = $('#res'); if (!r) return;
  if (!POS.results.length) { r.hidden = false; r.innerHTML = '<div class="empty">مفيش نتائج</div>'; return; }
  r.hidden = false;
  r.innerHTML = POS.results.map((d, i) => `<div class="res ${i === POS.sel ? 'sel' : ''}" data-act="pos-pick" data-i="${i}">
    <div class="grow"><div class="nm">${esc(d.arabic || d.name)}</div><div class="en">${esc(d.name)} ${d.active ? '· ' + esc(d.active) : ''}</div></div>
    ${stockPill(d.stock, d.min_qty)}<div class="pr">${money(d.price)}</div></div>`).join('');
  const s = r.querySelector('.sel'); s && s.scrollIntoView({ block: 'nearest' });
}
function hideRes() { const r = $('#res'); if (r) r.hidden = true; }
ACT['pos-pick'] = async (el) => { const d = POS.results[+el.dataset.i]; await addToCart(d); $('#q').value = ''; hideRes(); $('#q').focus(); };

async function unknownBarcode(code) {
  const m = modal('باركود غير مسجل', `<p>الباركود <b class="ltr">${esc(code)}</b> مش موجود في القاعدة. اربطه بصنف موجود (هيتعرف عليه تلقائي بعد كده):</p>
    <div class="field"><label>ابحث عن الصنف</label><input id="lk" placeholder="اسم الدواء"></div><div id="lkr" style="max-height:260px;overflow:auto;margin-top:10px"></div>`);
  const s = debounce(async () => {
    const r = await searchDrugs($('#lk', m).value, { limit: 15, withStock: false });
    $('#lkr', m).innerHTML = r.map((d) => `<div class="res" data-i="${d.id}"><div class="grow"><div class="nm">${esc(d.arabic || d.name)}</div><div class="en">${esc(d.name)}${d.barcode ? ' · لديه باركود ' + esc(d.barcode) : ''}</div></div><div class="pr">${money(d.price)}</div></div>`).join('');
    $$('.res', m).forEach((n) => (n.onclick = async () => {
      const dup = await Q1('SELECT id, arabic, name FROM drugs WHERE barcode=? AND id<>?', [code, n.dataset.i]);
      if (dup) { toast('الباركود ده مسجل على صنف تاني: ' + (dup.arabic || dup.name || '') + '. صحّح الباركود من شاشة الأصناف الأول', 'err'); return; }
      await X("UPDATE drugs SET barcode=?, search=COALESCE(search,'')||? WHERE id=?", [code, ' ' + code, n.dataset.i]);
      const d = await getDrug(n.dataset.i); m.close(); await addToCart(d); toast('تم ربط الباركود بالصنف', 'ok'); $('#q').value = ''; $('#q').focus();
    }));
  }, 150);
  $('#lk', m).addEventListener('input', s);
  m.addEventListener('close', () => {});
}

async function addToCart(d, unit = 'pack') {
  if (!App.shift && !App.warnedShift) { App.warnedShift = true; toast('تنبيه: مفيش وردية مفتوحة. افتح وردية من "الوردية والمصروفات" عشان الجرد اليومي يتحسب', ''); }
  const full = await getDrug(d.id);
  if (!(full.price > 0)) toast('تنبيه: الصنف ده سعره صفر. حدّث السعر من شاشة الأصناف قبل البيع', 'err');
  const near = await Q1('SELECT MIN(expiry) e FROM batches WHERE drug_id=? AND qty>0 AND expiry IS NOT NULL', [full.id]);
  if (near?.e && near.e <= addDays(today(), num(App.settings.expiry_days || 90))) toast(`تنبيه: أقرب تشغيلة متاحة من "${full.arabic || full.name}" ${near.e < today() ? 'تاريخها فات' : 'قربت تنتهي (' + fdate(near.e) + ')'}`, '');
  const ex = POS.cart.find((l) => l.id === full.id && l.unit === unit);
  if (ex) ex.n += 1;
  else POS.cart.push({ id: full.id, name: full.arabic || full.name, en: full.name, active: full.active, price: full.price, strips: full.strips || 1, unit, n: 1, disc: 0, stock: full.stock, kind: full.kind });
  POS.lastItem = full; renderCart(); showAlts(full);
}
async function showAlts(d) {
  const box = $('#alts'); if (!box) return;
  POS.lastItem = d;
  const alts = await alternativesOf(d);
  box.innerHTML = `<div class="small mb"><b>${esc(d.arabic || d.name)}</b> <span class="mute">${esc(d.active || '')}</span></div>` + (alts.length ? alts.map((a) => `<div class="res" data-act="pos-add-alt" data-id="${a.id}"><div class="grow"><div class="nm">${esc(a.arabic || a.name)}</div><div class="en">${esc(a.company || '')}</div></div>${stockPill(a.stock)}<div class="pr">${money(a.price)}</div></div>`).join('') : '<div class="mute small">مفيش بدائل مسجلة</div>');
}
ACT['pos-add-alt'] = async (el) => { const d = await getDrug(el.dataset.id); await addToCart(d); $('#q').focus(); };
ACT['pos-line-alts'] = async (el) => { const l = POS.cart[+el.dataset.i]; const d = await getDrug(l.id); showAlts(d); };

function renderCart() {
  const box = $('#cartbox'); if (!box) return;
  $('#hc') && ($('#hc').textContent = App.held.length);
  if (!POS.cart.length) {
    box.innerHTML = '<div class="empty" style="padding:70px 20px">🧾<br>الفاتورة فاضية<br><span class="small">امسح باركود أو ابحث عن صنف للبدء</span></div>';
  } else {
    box.innerHTML = `<table><thead><tr><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th class="n">السعر</th><th>خصم</th><th class="n">الإجمالي</th><th></th></tr></thead><tbody>${POS.cart.map((l, i) => {
      const short = packQty(l) > l.stock;
      return `<tr><td class="nm"><b>${esc(l.name)}</b><span>${esc(l.en)}</span>${short ? '<span style="color:var(--warn);display:block">⚠ الكمية أكبر من المتاح (' + qtyf(l.stock) + ')</span>' : ''}</td>
      <td>${l.strips > 1 ? `<select data-cart="unit" data-i="${i}"><option value="pack" ${l.unit === 'pack' ? 'selected' : ''}>علبة</option><option value="strip" ${l.unit === 'strip' ? 'selected' : ''}>شريط (1/${l.strips})</option></select>` : 'علبة'}</td>
      <td><div class="row" style="gap:4px;flex-wrap:nowrap"><button class="qtybtn" data-act="pos-qty" data-i="${i}" data-d="-1">−</button><input data-cart="n" data-i="${i}" value="${qtyf(l.n)}" inputmode="decimal"><button class="qtybtn" data-act="pos-qty" data-i="${i}" data-d="1">+</button></div></td>
      <td class="n"><input data-cart="price" data-i="${i}" value="${r2(unitPrice(l))}" style="width:80px" ${isAdmin() || App.user.role === 'pharmacist' ? '' : 'readonly'}></td>
      <td><input data-cart="disc" data-i="${i}" value="${l.disc || ''}" placeholder="0" style="width:64px"></td>
      <td class="n b">${money(lineTotal(l))}</td>
      <td style="white-space:nowrap"><button class="btn sec sm" data-act="pos-line-alts" data-i="${i}" title="البدائل">🔁</button> <button class="btn sec sm" data-act="pos-del" data-i="${i}">✕</button></td></tr>`;
    }).join('')}</tbody></table>`;
  }
  const warns = checkInteractions(POS.cart.map((l) => ({ name: l.name, active: l.active })));
  $('#warns').innerHTML = warns.map((w) => `<div class="alert ${w.lvl}">⚠️ <b>${esc(w.names)}</b>: ${esc(w.msg)}</div>`).join('') + (warns.length ? '<div class="small mute" style="margin:-4px 0 8px">التنبيهات للاستئناس فقط وبتعتمد على المادة الفعالة، والمراجعة النهائية للصيدلي.</div>' : '');
  renderTotals();
}
function renderTotals() {
  const t = $('#totals'); if (!t) return;
  const sub = cartSub(), disc = cartDisc(), tot = cartTotal();
  t.innerHTML = `<div class="line"><span>عدد الأصناف</span><b>${POS.cart.length}</b></div><div class="line"><span>الإجمالي قبل الخصم</span><b>${money(sub)}</b></div>
   <div class="row" style="margin:6px 0"><span class="mute grow">خصم على الفاتورة</span><input id="dv" value="${POS.discVal || ''}" placeholder="0" style="width:84px;text-align:center"><select id="dt" style="width:76px"><option value="fixed" ${POS.discType === 'fixed' ? 'selected' : ''}>${cur()}</option><option value="pct" ${POS.discType === 'pct' ? 'selected' : ''}>%</option></select></div>
   <div class="row" style="margin:6px 0"><span class="mute">العميل</span><span class="grow b" id="custname">${POS.customer ? esc(POS.customer.name) : 'نقدي'}</span><button class="btn sec sm" data-act="pos-customer">اختيار</button></div>
   <div class="grand"><span>الصافي</span><b>${money(tot)}</b></div>
   <button class="btn lg" style="width:100%" data-act="pos-pay" ${POS.cart.length ? '' : 'disabled'}>💳 دفع (F9)</button>`;
  $('#dv').onchange = (e) => { POS.discVal = Math.max(0, num(e.target.value)); renderCart(); }; // a negative discount would silently raise the invoice
  $('#dt').onchange = (e) => { POS.discType = e.target.value; renderCart(); };
}
document.addEventListener('change', (e) => {
  const c = e.target.dataset?.cart; if (!c || App.view !== 'pos') return;
  const l = POS.cart[+e.target.dataset.i]; if (!l) return;
  if (c === 'n') l.n = Math.max(0.01, num(e.target.value) || 1);
  if (c === 'unit') l.unit = e.target.value;
  if (c === 'disc') l.disc = Math.min(Math.max(0, num(e.target.value)), lineGross(l));
  if (c === 'price') { const v = Math.max(0, num(e.target.value)); l.price = l.unit === 'strip' ? v * l.strips : v; } // no negative prices: a negative line would flip the invoice total
  renderCart();
});
ACT['pos-qty'] = (el) => { const l = POS.cart[+el.dataset.i]; l.n = Math.max(1, l.n + +el.dataset.d); renderCart(); };
ACT['pos-del'] = (el) => { POS.cart.splice(+el.dataset.i, 1); renderCart(); $('#q').focus(); };
ACT['pos-clear'] = async () => { if (POS.cart.length && !(await confirmBox('تفريغ الفاتورة الحالية؟', 'تفريغ', true))) return; resetPos(); };
function resetPos() { POS.cart = []; POS.customer = null; POS.discVal = 0; POS.discType = 'fixed'; renderCart(); $('#q') && $('#q').focus(); }
ACT['pos-hold'] = () => {
  if (!POS.cart.length) return;
  App.held.push({ t: nowISO(), cart: POS.cart, customer: POS.customer, discType: POS.discType, discVal: POS.discVal });
  localStorage.setItem('held', JSON.stringify(App.held)); resetPos(); toast('تم تعليق الفاتورة', 'ok');
};
ACT['pos-held'] = () => {
  if (!App.held.length) return toast('مفيش فواتير معلقة');
  const m = modal('الفواتير المعلقة', App.held.map((h, i) => `<div class="res"><div class="grow"><b>${h.cart.length} صنف</b> <span class="mute small">${ftime(h.t)}${h.customer ? ' · ' + esc(h.customer.name) : ''}</span></div><button class="btn sm" data-i="${i}" data-a="open">فتح</button><button class="btn danger sm" data-i="${i}" data-a="del">حذف</button></div>`).join(''));
  m.onclick = async (e) => {
    const b = e.target.closest('button[data-i]'); if (!b) return; const i = +b.dataset.i;
    if (b.dataset.a === 'open') { const h = App.held.splice(i, 1)[0]; const fresh = []; for (const l of h.cart) { const fd = await getDrug(l.id); if (!fd) continue; if (Math.abs(num(fd.price) - num(l.price)) > 0.001) toast('سعر "' + l.name + '" اتغير من ' + money(l.price) + ' إلى ' + money(fd.price) + ' من وقت التعليق. راجع السعر في الفاتورة', ''); fresh.push({ ...l, strips: fd.strips || 1, stock: fd.stock }); } h.cart = fresh; /* stock may have changed since parking; price is kept but flagged */ if (POS.cart.length) App.held.push({ t: nowISO(), cart: POS.cart, customer: POS.customer, discType: POS.discType, discVal: POS.discVal }); /* current invoice is parked, not lost */ Object.assign(POS, { cart: h.cart, customer: h.customer, discType: h.discType, discVal: h.discVal }); }
    else App.held.splice(i, 1);
    localStorage.setItem('held', JSON.stringify(App.held)); m.close(); renderCart();
  };
};
ACT['pos-customer'] = async () => {
  const m = modal('اختيار العميل', `<div class="field"><label>بحث بالاسم أو التليفون</label><input id="cq"></div><div id="cl" class="mt"></div><div class="row mt"><button class="btn sec" data-act="x" id="cnone">نقدي (بدون عميل)</button><button class="btn" id="cnew">+ عميل جديد</button></div>`);
  const load = async () => {
    const t = `%${$('#cq', m).value.trim()}%`;
    const rows = await Q('SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY name LIMIT 30', [t, t]);
    $('#cl', m).innerHTML = rows.map((c) => `<div class="res" data-id="${c.id}"><div class="grow b">${esc(c.name)}<div class="small mute">${esc(c.phone || '')}</div></div>${c.balance > 0.001 ? `<span class="pill red">عليه ${money(c.balance)}</span>` : c.balance < -0.001 ? `<span class="pill">له ${money(-c.balance)}</span>` : ''}</div>`).join('') || '<div class="empty">مفيش عملاء</div>';
    $$('.res', m).forEach((n) => (n.onclick = async () => { POS.customer = await Q1('SELECT * FROM customers WHERE id=?', [n.dataset.id]); m.close(); renderTotals(); }));
  };
  $('#cq', m).oninput = debounce(load, 120); load();
  $('#cnone', m).onclick = () => { POS.customer = null; m.close(); renderTotals(); };
  $('#cnew', m).onclick = async () => { m.close(); const c = await customerForm(); if (c) { POS.customer = c; renderTotals(); } };
};

// ---------- payment ----------
ACT['pos-pay'] = async () => {
  if (!POS.cart.length) return;
  const total = cartTotal();
  const m = modal('إتمام الدفع', `<div style="text-align:center;margin-bottom:14px"><div class="mute">المطلوب</div><div style="font-size:38px;font-weight:800;color:var(--pri)">${money(total)} <small>${cur()}</small></div></div>
   <div class="tabs" id="pm"><button class="on" data-m="cash">💵 كاش</button><button data-m="card">💳 فيزا</button><button data-m="credit">📒 آجل</button><button data-m="mixed">➗ مختلط</button></div>
   <div id="pf"></div><div class="err" id="pe"></div>
   <label class="row small mute"><input type="checkbox" id="pdel"> طلب دليفري</label>`, { footer: '<button class="btn lg" id="pok">✔ تأكيد وطباعة (Enter)</button><button class="btn sec" data-close2>إلغاء</button>' });
  let mode = 'cash';
  const form = () => {
    const pf = $('#pf', m);
    if (mode === 'cash') pf.innerHTML = `<div class="grid g2"><div class="field"><label>المدفوع من العميل</label><input id="tend" value="${total}" inputmode="decimal"></div><div class="field"><label>الباقي للعميل</label><input id="chg" readonly value="0.00"></div></div>`;
    else if (mode === 'card') pf.innerHTML = '<div class="alert info">الدفع بالفيزا بالكامل.</div>';
    else if (mode === 'credit') pf.innerHTML = `<div class="alert info">${POS.customer ? 'هيتسجل على حساب: <b>' + esc(POS.customer.name) + '</b>' : '⚠ لازم تختار عميل الأول من شاشة الفاتورة.'}</div><div class="field"><label>مدفوع مقدماً (كاش)</label><input id="cash2" value="0" inputmode="decimal"></div>`;
    else pf.innerHTML = `<div class="grid g3"><div class="field"><label>كاش</label><input id="mc" value="${total}"></div><div class="field"><label>فيزا</label><input id="mv" value="0"></div><div class="field"><label>آجل</label><input id="mr" value="0"></div></div>`;
    const t = $('#tend', m); if (t) { const f = () => ($('#chg', m).value = money(Math.max(0, num(t.value) - total))); t.oninput = f; t.select(); }
    $$('#pf input', m).forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#pok', m).click(); }));
  };
  $('#pm', m).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; mode = b.dataset.m; $$('#pm button', m).forEach((x) => x.classList.toggle('on', x === b)); form(); };
  $('[data-close2]', m).onclick = () => m.close();
  form();
  $('#pok', m).onclick = async () => {
    let cash = 0, card = 0, credit = 0;
    if (mode === 'cash') { cash = total; if (num($('#tend', m).value) < total - 0.001) { $('#pe', m).textContent = 'المبلغ المدفوع أقل من المطلوب (استخدم آجل أو مختلط)'; return; } }
    else if (mode === 'card') card = total;
    else if (mode === 'credit') { const adv = num($('#cash2', m).value); if (adv < 0) { $('#pe', m).textContent = 'مينفعش مبلغ بالسالب'; return; } if (adv > total + 0.001) { $('#pe', m).textContent = 'المدفوع مقدماً أكبر من قيمة الفاتورة. لو فيه فرق، سجّله تحصيل بعد البيع'; return; } cash = r2(adv); credit = r2(total - cash); }
    else { cash = num($('#mc', m).value); card = num($('#mv', m).value); credit = num($('#mr', m).value); if (cash < 0 || card < 0 || credit < 0) { $('#pe', m).textContent = 'مينفعش مبلغ بالسالب'; return; } if (Math.abs(cash + card + credit - total) > 0.01) { $('#pe', m).textContent = `مجموع الدفع (${money(cash + card + credit)}) لا يساوي المطلوب`; return; } }
    if (credit > 0 && !POS.customer) { $('#pe', m).textContent = 'اختار عميل للبيع الآجل'; return; }
    const cap = num(App.settings.cashier_max_disc);
    if (cap > 0 && App.user.role === 'cashier') { const gross = POS.cart.reduce((s, l) => s + lineGross(l), 0), given = gross - total; if (gross > 0 && (given / gross) * 100 > cap + 0.001) { $('#pe', m).textContent = `الخصم أكبر من المسموح للكاشير (${cap}%). اطلب من الصيدلي أو المدير`; return; } }
    if (credit > 0) {
      const cu = await Q1('SELECT balance, credit_limit FROM customers WHERE id=?', [POS.customer.id]);
      if (cu && cu.credit_limit > 0 && cu.balance + credit > cu.credit_limit + 0.001) { $('#pe', m).textContent = `البيع الآجل هيعدي حد الائتمان للعميل (${money(cu.credit_limit)}). المديونية الحالية ${money(cu.balance)}`; return; }
    }
    const free = POS.cart.find((l) => !(unitPrice(l) > 0));
    if (free) { $('#pe', m).textContent = `الصنف "${free.name}" بسعر صفر. عدّل سعره من شاشة الأصناف قبل البيع`; return; }
    $('#pok', m).disabled = true;
    try {
      const id = await saveSale({ cash, card, credit, delivery: $('#pdel', m).checked ? 1 : 0 });
      const tendered = mode === 'cash' ? num($('#tend', m).value) : 0;
      await audit('فاتورة بيع', `#${id} بقيمة ${money(total)}${POS.cart.some((l) => num(l.disc) > 0) || cartDisc() > 0 ? ' (بخصم)' : ''}`);
      m.close(); resetPos(); toast(`تم حفظ الفاتورة رقم ${id}${tendered > total ? ' · الباقي ' + money(tendered - total) : ''}`, 'ok');
      try { await printReceipt(id); } catch (pe) { console.error(pe); toast('الفاتورة اتحفظت لكن الطباعة فشلت. اعمل إعادة طباعة من شاشة المرتجعات', 'err'); }
    } catch (e) { console.error(e); $('#pe', m).textContent = e.message; $('#pok', m).disabled = false; }
  };
};

// FEFO allocation + atomic save
async function saveSale({ cash, card, credit, delivery }) {
  const allowNeg = App.settings.allow_negative !== '0';
  const ops = []; const t = today(); const sub = cartSub(), disc = cartDisc(), total = cartTotal();
  let costTotal = 0; const consumed = {};
  ops.push({ sql: 'INSERT INTO sales(date,user_id,shift_id,customer_id,subtotal,discount,total,cash,card,credit,cost_total,delivery) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', params: [nowISO(), App.user.id, App.shift?.id || null, POS.customer?.id || null, sub, disc, total, cash, card, credit, 0, delivery] });
  const saleIdx = 0; const itemOps = [];
  for (const l of POS.cart) {
    let need = r2(packQty(l) * 1000) / 1000;
    const total_l = lineTotal(l), disc_l = num(l.disc), Q_all = need;
    const batches = await Q('SELECT * FROM batches WHERE drug_id=? AND qty>0 AND (expiry IS NULL OR expiry>=?) ORDER BY expiry IS NULL, expiry ASC, id ASC', [l.id, t]);
    const allocs = [];
    for (const b of batches) { if (need <= 0.0000001) break; const avail = b.qty - (consumed[b.id] || 0); if (avail <= 0) continue; let take = Math.min(avail, need); if (l.unit === 'strip' && avail - take > 0 && avail - take < 0.0015) take = avail; /* strip rounding dust */ consumed[b.id] = (consumed[b.id] || 0) + take; allocs.push({ batch: b.id, q: take, cost: b.cost }); need -= take; if (take > 0) ops.push({ sql: 'UPDATE batches SET qty=qty-? WHERE id=?', params: [take, b.id] }); }
    if (need > 0.0000001) {
      const expd = await Q1('SELECT COALESCE(SUM(qty),0) q FROM batches WHERE drug_id=? AND qty>0 AND expiry IS NOT NULL AND expiry<?', [l.id, t]);
      if (expd.q > 0) throw new Error(`الصنف ${l.name}: الرصيد المتاح منتهي الصلاحية (${qtyf(expd.q)}) ومينفعش يتباع. اسحبه من الرف وصحّح الرصيد من الجرد`);
      if (!allowNeg) throw new Error(`الرصيد غير كافٍ للصنف: ${l.name} (المتاح للبيع ${qtyf(batches.reduce((x, b) => x + b.qty, 0))})`);
      let nb = await Q1("SELECT * FROM batches WHERE drug_id=? AND batch_no='' AND expiry IS NULL LIMIT 1", [l.id]);
      const dr = await getDrug(l.id);
      if (nb) { ops.push({ sql: 'UPDATE batches SET qty=qty-? WHERE id=?', params: [need, nb.id] }); allocs.push({ batch: nb.id, q: need, cost: nb.cost || dr.cost || 0 }); }
      else { ops.push({ sql: "INSERT INTO batches(drug_id,batch_no,expiry,qty,cost,created_at) VALUES(?,'',NULL,?,?,?)", params: [l.id, -need, dr.cost || 0, nowISO()] }); allocs.push({ batchIdx: ops.length - 1, q: need, cost: dr.cost || 0 }); }
    }
    let usedT = 0, usedD = 0;
    allocs.forEach((a, i) => {
      const last = i === allocs.length - 1;
      const t_i = last ? r2(total_l - usedT) : r2((total_l * a.q) / Q_all), d_i = last ? r2(disc_l - usedD) : r2((disc_l * a.q) / Q_all);
      usedT += t_i; usedD += d_i; costTotal += a.cost * a.q;
      itemOps.push({ sql: 'INSERT INTO sale_items(sale_id,drug_id,batch_id,qty,unit,price,cost,discount,total) VALUES(?,?,?,?,?,?,?,?,?)', params: ['@' + saleIdx, l.id, a.batch ?? ('@' + a.batchIdx), a.q, l.unit, l.price, a.cost, d_i, t_i] });
    });
  }
  ops.push(...itemOps);
  ops.push({ sql: 'UPDATE sales SET cost_total=? WHERE id=?', params: [r2(costTotal), '@' + saleIdx] });
  if (credit > 0) ops.push({ sql: 'UPDATE customers SET balance=balance+? WHERE id=?', params: [credit, POS.customer.id] });
  const ids = await api.tx(ops);
  return ids[saleIdx];
}

// ---------- receipt ----------
async function printReceipt(saleId, opts = {}) {
  const s = await Q1('SELECT s.*, u.name uname, c.name cname FROM sales s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN customers c ON c.id=s.customer_id WHERE s.id=?', [saleId]);
  const items = await Q('SELECT si.*, d.arabic, d.name, d.strips FROM sale_items si JOIN drugs d ON d.id=si.drug_id WHERE si.sale_id=?', [saleId]);
  const merged = {};
  items.forEach((i) => { const k = i.drug_id + i.unit; (merged[k] ||= { ...i, qty: 0, total: 0 }); merged[k].qty += i.qty; merged[k].total += i.total; });
  const S = App.settings;
  $('#receipt').innerHTML = `<h3>${esc(S.pharmacy_name)}</h3><div class="c">${esc(S.address || '')}</div><div class="c">${esc(S.phone || '')}</div><hr>
   <div>فاتورة رقم: <b>${s.id}</b></div><div>التاريخ: ${ftime(s.date)}</div><div>الكاشير: ${esc(s.uname || '')}</div>${s.cname ? `<div>العميل: ${esc(s.cname)}</div>` : ''}<hr>
   <table style="width:100%"><thead><tr><th>الصنف</th><th>الكمية</th><th>الإجمالي</th></tr></thead><tbody>${Object.values(merged).map((i) => `<tr><td>${esc(i.arabic || i.name)}</td><td>${qtyf(i.unit === 'strip' ? i.qty * (i.strips || 1) : i.qty)}${i.unit === 'strip' ? ' شريط' : ''}</td><td>${money(i.total)}</td></tr>`).join('')}</tbody></table><hr>
   <div class="c" style="font-size:11px">عدد الأصناف: ${Object.keys(merged).length}</div>
   <div style="display:flex;justify-content:space-between"><span>الإجمالي</span><span>${money(s.subtotal)}</span></div>
   ${s.discount ? `<div style="display:flex;justify-content:space-between"><span>الخصم</span><span>${money(s.discount)}</span></div>` : ''}
   <div style="display:flex;justify-content:space-between;font-size:15px"><b>الصافي</b><b>${money(s.total)} ${cur()}</b></div>
   ${s.cash ? `<div>كاش: ${money(s.cash)}</div>` : ''}${s.card ? `<div>فيزا: ${money(s.card)}</div>` : ''}${s.credit ? `<div>آجل: ${money(s.credit)}</div>` : ''}<hr><div class="c">${esc(S.receipt_footer || '')}</div>`;
  if (App.settings.auto_print === '0' && !opts.force) return;
  await doPrint();
}
async function doPrint() { const r = await api.print(App.settings.silent_print === '1'); if (r && r.ok === false && r.why && !/cancel/i.test(r.why)) throw new Error(r.why); }
ACT['reprint'] = (el) => printReceipt(+el.dataset.id, { force: true }).catch((e) => toast('تعذر الطباعة: ' + e.message, 'err'));
