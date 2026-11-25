'use strict';
const PUR = { lines: [], supplier: null };
Views.purchases = async (el) => {
  el.style.padding = '18px 22px';
  const list = await Q('SELECT p.*, s.name sname FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id ORDER BY p.id DESC LIMIT 200');
  el.innerHTML = `<div class="row mb"><button class="btn lg" data-act="pur-new">+ فاتورة شراء جديدة</button><span class="mute small">كل سطر شراء بيعمل تشغيلة جديدة بتاريخ صلاحيتها وبيحدّث التكلفة.</span></div>` +
    table([{ h: '#', f: 'id' }, { h: 'التاريخ', f: (p) => fdate(p.date) }, { h: 'المورد', f: (p) => esc(p.sname || '—') }, { h: 'رقم فاتورة المورد', f: (p) => esc(p.invoice_no || '') }, { h: 'الإجمالي', n: 1, f: (p) => money(p.total) }, { h: 'المدفوع', n: 1, f: (p) => money(p.paid) }, { h: 'المتبقي', n: 1, f: (p) => (p.total - p.paid > 0.001 ? `<span class="pill red">${money(p.total - p.paid)}</span>` : '—') }, { h: '', f: (p) => `<button class="btn sec sm" data-act="pur-view" data-id="${p.id}">عرض</button>` }], list, { empty: 'لا توجد فواتير شراء بعد' });
};
ACT['pur-view'] = async (el) => {
  const items = await Q('SELECT pi.*, d.arabic, d.name FROM purchase_items pi JOIN drugs d ON d.id=pi.drug_id WHERE purchase_id=?', [el.dataset.id]);
  modal('فاتورة شراء #' + el.dataset.id, table([{ h: 'الصنف', f: (i) => esc(i.arabic || i.name) }, { h: 'تشغيلة', f: (i) => esc(i.batch_no || '') }, { h: 'صلاحية', f: (i) => fdate(i.expiry) }, { h: 'الكمية', n: 1, f: (i) => qtyf(i.qty) }, { h: 'التكلفة', n: 1, f: (i) => money(i.cost) }, { h: 'الإجمالي', n: 1, f: (i) => money(i.qty * i.cost) }], items), { wide: true });
};
ACT['pur-new'] = async () => {
  PUR.lines = []; PUR.supplier = null;
  const sups = await Q('SELECT * FROM suppliers ORDER BY name');
  const m = modal('فاتورة شراء جديدة', `<div class="grid g3 mb"><div class="field"><label>المورد</label><select id="p_s"><option value="">— بدون مورد —</option>${sups.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
    <div class="field"><label>رقم فاتورة المورد</label><input id="p_n"></div><div class="field"><label>التاريخ</label><input id="p_d" type="date" value="${today()}"></div></div>
    <div class="searchbar mb"><span class="si">🔍</span><input id="p_q" placeholder="ابحث عن صنف أو امسح الباركود لإضافته" autocomplete="off"><div class="results" id="p_r" hidden></div></div>
    <div id="p_l"></div><div class="row mt"><div class="field"><label>المدفوع للمورد الآن</label><input id="p_paid" value="0" style="width:140px"></div><label class="row small" style="margin-top:22px"><input type="checkbox" id="p_dr"> المدفوع طلع من درج الكاش (يتخصم من جرد الوردية)</label><span class="grow"></span><div style="text-align:left"><span class="mute">إجمالي الفاتورة</span><div style="font-size:28px;font-weight:800;color:var(--pri)" id="p_t">0.00</div></div></div><div class="err" id="p_e"></div>`,
    { wide: true, sticky: true, footer: '<button class="btn lg" id="p_ok">💾 حفظ الفاتورة وإضافة للمخزون</button><button class="btn sec" id="p_no">إلغاء</button>' });
  const renderLines = () => {
    $('#p_l', m).innerHTML = PUR.lines.length ? `<div class="tw"><table><thead><tr><th>الصنف</th><th>التشغيلة</th><th>الصلاحية (2027-03)</th><th>الكمية</th><th>التكلفة</th><th>سعر البيع</th><th class="n">الإجمالي</th><th></th></tr></thead><tbody>${PUR.lines.map((l, i) => `<tr><td><b>${esc(l.name)}</b></td>
      <td><input data-pl="batch" data-i="${i}" value="${esc(l.batch)}" style="width:100px"></td><td><input data-pl="exp" data-i="${i}" value="${esc(l.exp)}" class="ltr" style="width:100px" placeholder="YYYY-MM"></td>
      <td><input data-pl="qty" data-i="${i}" value="${l.qty}" style="width:70px"></td><td><input data-pl="cost" data-i="${i}" value="${l.cost}" style="width:84px"></td><td><input data-pl="price" data-i="${i}" value="${l.price}" style="width:84px"></td>
      <td class="n b">${money(l.qty * l.cost)}</td><td><button class="btn sec sm" data-pdel="${i}">✕</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">أضف أصناف الفاتورة من البحث فوق</div>';
    $('#p_t', m).textContent = money(PUR.lines.reduce((s, l) => s + l.qty * l.cost, 0));
  };
  renderLines();
  const q = $('#p_q', m); let res = [];
  const add = async (d) => { PUR.lines.push({ id: d.id, name: d.arabic || d.name, batch: '', exp: '', qty: 1, cost: d.cost || 0, price: d.price }); q.value = ''; $('#p_r', m).hidden = true; renderLines(); q.focus(); };
  q.oninput = debounce(async () => { res = await searchDrugs(q.value, { limit: 20, withStock: false }); const r = $('#p_r', m); r.hidden = !q.value.trim(); r.innerHTML = res.map((d, i) => `<div class="res" data-i="${i}"><div class="grow"><div class="nm">${esc(d.arabic || d.name)}</div><div class="en">${esc(d.name)}</div></div><div class="pr">${money(d.price)}</div></div>`).join('') || '<div class="empty">مفيش نتائج</div>'; $$('.res', r).forEach((n) => (n.onclick = () => add(res[+n.dataset.i]))); }, 140);
  q.onkeydown = (e) => { if (e.key === 'Enter' && res[0]) { e.preventDefault(); add(res[0]); } };
  m.addEventListener('change', (e) => { const k = e.target.dataset.pl; if (!k) return; const l = PUR.lines[+e.target.dataset.i]; l[k] = ['qty', 'cost', 'price'].includes(k) ? num(e.target.value) : e.target.value.trim(); renderLines(); });
  m.addEventListener('click', (e) => { const b = e.target.closest('[data-pdel]'); if (b) { PUR.lines.splice(+b.dataset.pdel, 1); renderLines(); } });
  $('#p_no', m).onclick = () => m.close();
  $('#p_ok', m).onclick = async () => {
    if (!PUR.lines.length) return ($('#p_e', m).textContent = 'أضف صنف واحد على الأقل');
    for (const l of PUR.lines) { if (l.qty <= 0) return ($('#p_e', m).textContent = 'الكمية لازم تكون أكبر من صفر: ' + l.name); if (l.exp && !monthToDate(l.exp)) return ($('#p_e', m).textContent = 'صيغة الصلاحية غلط في: ' + l.name); }
    const total = r2(PUR.lines.reduce((s, l) => s + l.qty * l.cost, 0)), paid = Math.max(0, Math.min(total, num($('#p_paid', m).value))), sid = $('#p_s', m).value || null;
    const ops = [{ sql: 'INSERT INTO purchases(supplier_id,date,invoice_no,total,paid,user_id) VALUES(?,?,?,?,?,?)', params: [sid, $('#p_d', m).value || today(), $('#p_n', m).value.trim(), total, paid, App.user.id] }];
    for (const l of PUR.lines) {
      const ex = monthToDate(l.exp);
      ops.push({ sql: 'INSERT INTO batches(drug_id,batch_no,expiry,qty,cost,price,purchase_id,created_at) VALUES(?,?,?,?,?,?,?,?)', params: [l.id, l.batch, ex, l.qty, l.cost, l.price, '@0', nowISO()] });
      ops.push({ sql: 'INSERT INTO purchase_items(purchase_id,drug_id,batch_id,batch_no,expiry,qty,cost,price) VALUES(?,?,?,?,?,?,?,?)', params: ['@0', l.id, '@last', l.batch, ex, l.qty, l.cost, l.price] });
      ops.push({ sql: 'UPDATE drugs SET cost=?, price=CASE WHEN ?>0 THEN ? ELSE price END WHERE id=?', params: [l.cost, l.price, l.price, l.id] });
    }
    if ($('#p_dr', m).checked && paid > 0) ops.push({ sql: "INSERT INTO payments(date,party_type,party_id,amount,user_id,shift_id,note) VALUES(?,'supplier',?,?,?,?,?)", params: [nowISO(), sid ? +sid : 0, paid, App.user.id, App.shift?.id || null, 'سداد فاتورة شراء من الدرج'] });
    if (sid && total - paid > 0) ops.push({ sql: 'UPDATE suppliers SET balance=balance+? WHERE id=?', params: [r2(total - paid), sid] });
    await api.tx(ops); m.close(); toast('تم حفظ فاتورة الشراء وتحديث المخزون', 'ok'); go('purchases');
  };
};
