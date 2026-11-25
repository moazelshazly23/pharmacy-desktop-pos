'use strict';
const PartyState = { tab: 'customers', q: '' };
Views.parties = async (el) => {
  el.style.padding = '18px 22px';
  const isC = PartyState.tab === 'customers', tb = isC ? 'customers' : 'suppliers';
  const qq = `%${PartyState.q.trim()}%`;
  const rows = await Q(`SELECT * FROM ${tb} WHERE name LIKE ? OR phone LIKE ? ORDER BY balance DESC, name`, [qq, qq]);
  const owed = rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
  el.innerHTML = `<div class="tabs"><button data-act="party-tab" data-k="customers" class="${isC ? 'on' : ''}">العملاء</button><button data-act="party-tab" data-k="suppliers" class="${!isC ? 'on' : ''}">الموردين</button></div>
   <div class="row mb"><button class="btn" data-act="party-new">+ ${isC ? 'عميل جديد' : 'مورد جديد'}</button><input id="pq" placeholder="بحث بالاسم أو التليفون" value="${esc(PartyState.q)}" style="width:220px"><span class="grow"></span><div class="stat" style="padding:8px 16px"><span class="l">${isC ? 'إجمالي المديونيات على العملاء' : 'إجمالي المستحق للموردين'}</span> <b style="font-size:20px;color:var(--danger)">${money(owed)}</b></div></div>` +
    table([{ h: 'الاسم', f: (r) => `<b>${esc(r.name)}</b>${r.chronic ? `<div class="small mute">أمراض مزمنة: ${esc(r.chronic)}</div>` : ''}` }, { h: 'التليفون', f: (r) => `<span class="ltr">${esc(r.phone || '')}</span>` }, { h: isC ? 'عليه' : 'له', n: 1, f: (r) => (r.balance > 0.001 ? `<span class="pill red">${money(r.balance)}</span>` : '—') + (isC && r.credit_limit > 0 ? `<div class="small mute">الحد ${money(r.credit_limit)}</div>` : '') },
      { h: '', f: (r) => `<button class="btn sm" data-act="party-pay" data-id="${r.id}">${isC ? 'تحصيل' : 'سداد'}</button> <button class="btn sec sm" data-act="party-edit" data-id="${r.id}">تعديل</button> ${isC ? `<button class="btn sec sm" data-act="party-stmt" data-id="${r.id}">كشف حساب</button>` : ''}` }], rows, { empty: isC ? 'لا يوجد عملاء' : 'لا يوجد موردين' });
  $('#pq').oninput = debounce(() => { PartyState.q = $('#pq').value; go('parties').then(() => { const i = $('#pq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 300);
};
ACT['party-tab'] = (el) => { PartyState.tab = el.dataset.k; go('parties'); };
async function customerForm(c) { return partyForm('customers', c); }
function partyForm(tb, p) {
  return new Promise((res) => {
    const isC = tb === 'customers';
    const m = modal(p ? 'تعديل' : isC ? 'عميل جديد' : 'مورد جديد', `<div class="grid g2"><div class="field"><label>الاسم</label><input id="pf_n" value="${esc(p?.name || '')}"></div><div class="field"><label>التليفون</label><input id="pf_p" class="ltr" value="${esc(p?.phone || '')}"></div>
     ${isC ? `<div class="field" style="grid-column:1/3"><label>أمراض مزمنة / ملاحظات صحية (اختياري)</label><input id="pf_c" value="${esc(p?.chronic || '')}"></div><div class="field"><label>حد الائتمان للبيع الآجل (0 = بدون حد)</label><input id="pf_l" value="${p?.credit_limit || 0}" inputmode="decimal"></div>` : ''}</div><div class="err" id="pf_e"></div>`, { footer: '<button class="btn" id="pf_ok">حفظ</button>', onClose: () => res(null) });
    $('#pf_ok', m).onclick = async () => {
      const n = $('#pf_n', m).value.trim(); if (!n) return ($('#pf_e', m).textContent = 'اكتب الاسم');
      if (!p && !(await confirmDupParty(tb, n, $('#pf_p', m).value.trim()))) return;
      let id;
      if (p) { await X(`UPDATE ${tb} SET name=?,phone=?${isC ? ',chronic=?,credit_limit=?' : ''} WHERE id=?`, isC ? [n, $('#pf_p', m).value.trim(), $('#pf_c', m).value.trim(), Math.max(0, num($('#pf_l', m).value)), p.id] : [n, $('#pf_p', m).value.trim(), p.id]); id = p.id; }
      else { const r = await X(isC ? 'INSERT INTO customers(name,phone,chronic,credit_limit) VALUES(?,?,?,?)' : 'INSERT INTO suppliers(name,phone) VALUES(?,?)', isC ? [n, $('#pf_p', m).value.trim(), $('#pf_c', m).value.trim(), Math.max(0, num($('#pf_l', m).value))] : [n, $('#pf_p', m).value.trim()]); id = r.id; }
      const row = await Q1(`SELECT * FROM ${tb} WHERE id=?`, [id]); m.remove(); res(row); if (App.view === 'parties') go('parties');
    };
  });
}
async function confirmDupParty(tb, name, phone) {
  const d = await Q1(`SELECT name FROM ${tb} WHERE lower(name)=lower(?) OR (?<>'' AND phone=?) LIMIT 1`, [name, phone, phone]);
  return d ? confirmBox(`فيه ${tb === 'customers' ? 'عميل' : 'مورد'} بنفس الاسم أو التليفون: <b>${esc(d.name)}</b>. تضيف برضه؟`, 'إضافة') : true;
}
ACT['party-new'] = () => partyForm(PartyState.tab);
ACT['party-edit'] = async (el) => partyForm(PartyState.tab, await Q1(`SELECT * FROM ${PartyState.tab} WHERE id=?`, [el.dataset.id]));
ACT['party-pay'] = async (el) => {
  const tb = PartyState.tab, isC = tb === 'customers', p = await Q1(`SELECT * FROM ${tb} WHERE id=?`, [el.dataset.id]);
  const m = modal(`${isC ? 'تحصيل من' : 'سداد إلى'} ${esc(p.name)}`, `<p>الرصيد الحالي: <b>${money(p.balance)}</b></p><div class="field"><label>المبلغ</label><input id="py" value="${Math.max(0, p.balance)}" inputmode="decimal"></div><div class="field mt"><label>ملاحظة</label><input id="pn"></div><label class="row small mt"><input type="checkbox" id="pdr" checked> ${isC ? 'المبلغ دخل درج الكاش (يتحسب في جرد الوردية)' : 'المبلغ طلع من درج الكاش (يتخصم من جرد الوردية)'}</label>`, { footer: '<button class="btn" id="pok">تأكيد</button>' });
  $('#py', m).select();
  $('#pok', m).onclick = async () => {
    const a = num($('#py', m).value); if (a <= 0) return toast('اكتب مبلغ صحيح', 'err');
    if ($('#pok', m).disabled) return; $('#pok', m).disabled = true;
    const drawer = $('#pdr', m).checked;
    await api.tx([{ sql: 'INSERT INTO payments(date,party_type,party_id,amount,user_id,shift_id,note,method) VALUES(?,?,?,?,?,?,?,?)', params: [nowISO(), isC ? 'customer' : 'supplier', p.id, a, App.user.id, App.shift?.id || null, $('#pn', m).value, drawer ? 'drawer' : 'external'] }, { sql: `UPDATE ${tb} SET balance=balance-? WHERE id=?`, params: [a, p.id] }]);
    await audit(isC ? 'تحصيل من عميل' : 'سداد مورد', `${p.name}: ${money(a)}${drawer ? '' : ' (خارج الدرج)'}`);
    m.close(); toast('تم تسجيل العملية', 'ok'); go('parties');
  };
};
ACT['party-stmt'] = async (el) => {
  const c = await Q1('SELECT * FROM customers WHERE id=?', [el.dataset.id]);
  const sales = await Q('SELECT id,date,total,credit FROM sales WHERE customer_id=? ORDER BY id DESC LIMIT 100', [c.id]);
  const pays = await Q("SELECT date,amount,note FROM payments WHERE party_type='customer' AND party_id=? ORDER BY id DESC LIMIT 100", [c.id]);
  const rets = await Q("SELECT r.date, r.total, r.sale_id FROM sale_returns r JOIN sales s ON s.id=r.sale_id WHERE s.customer_id=? AND r.refund='balance' ORDER BY r.id DESC LIMIT 100", [c.id]);
  modal('كشف حساب: ' + esc(c.name), `<p>الرصيد الحالي (عليه): <b>${money(c.balance)}</b></p><h4>المشتريات</h4>${table([{ h: 'فاتورة', f: 'id' }, { h: 'التاريخ', f: (s) => ftime(s.date) }, { h: 'الإجمالي', n: 1, f: (s) => money(s.total) }, { h: 'آجل', n: 1, f: (s) => money(s.credit) }], sales)}<h4>المدفوعات</h4>${table([{ h: 'التاريخ', f: (s) => ftime(s.date) }, { h: 'المبلغ', n: 1, f: (s) => money(s.amount) }, { h: 'ملاحظة', f: (s) => esc(s.note || '') }], pays)}${rets.length ? `<h4>مرتجعات خصمت من الحساب</h4>${table([{ h: 'التاريخ', f: (s) => ftime(s.date) }, { h: 'فاتورة', f: 'sale_id' }, { h: 'المبلغ', n: 1, f: (s) => money(s.total) }], rets)}` : ''}`, { wide: true });
};
