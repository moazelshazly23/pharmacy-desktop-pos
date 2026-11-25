'use strict';
Views.returns = async (el) => {
  el.style.padding = '18px 22px';
  const sales = await Q('SELECT s.*, c.name cname, u.name uname FROM sales s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 100');
  el.innerHTML = `<div class="row mb"><input id="rq" placeholder="رقم الفاتورة" style="width:180px" inputmode="numeric"><button class="btn" data-act="ret-find">فتح الفاتورة للمرتجع</button><span class="mute small">أو اختار من آخر الفواتير:</span></div>` +
    table([{ h: 'رقم', f: 'id' }, { h: 'الوقت', f: (s) => ftime(s.date) }, { h: 'العميل', f: (s) => esc(s.cname || 'نقدي') }, { h: 'الكاشير', f: (s) => esc(s.uname || '') }, { h: 'الإجمالي', n: 1, f: (s) => money(s.total) }, { h: '', f: (s) => `<button class="btn sec sm" data-act="ret-open" data-id="${s.id}">مرتجع</button> <button class="btn sec sm" data-act="reprint" data-id="${s.id}">🖨</button>` }], sales, { empty: 'لا توجد فواتير' });
  $('#rq').addEventListener('keydown', (e) => { if (e.key === 'Enter') ACT['ret-find'](); });
};
ACT['ret-find'] = () => { const v = $('#rq').value.trim(); if (v) openReturn(+v); };
ACT['ret-open'] = (el) => openReturn(+el.dataset.id);
async function openReturn(saleId) {
  const s = await Q1('SELECT s.*, c.name cname FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.id=?', [saleId]);
  if (!s) return toast('الفاتورة غير موجودة', 'err');
  const items = await Q('SELECT si.*, d.arabic, d.name, d.strips FROM sale_items si JOIN drugs d ON d.id=si.drug_id WHERE si.sale_id=?', [saleId]);
  const m = modal(`مرتجع من فاتورة #${saleId}`, `<div class="small mute mb">${ftime(s.date)} · الإجمالي ${money(s.total)} ${s.cname ? '· ' + esc(s.cname) : ''}</div>` + table([{ h: 'الصنف', f: (i) => esc(i.arabic || i.name) }, { h: 'تشغيلة', f: (i) => i.batch_id || '' }, { h: 'المباع', n: 1, f: (i) => qtyf(i.qty) }, { h: 'سبق إرجاعه', n: 1, f: (i) => qtyf(i.returned_qty) }, { h: 'كمية المرتجع (علب)', f: (i) => `<input data-rq="${i.id}" value="0" style="width:80px" ${i.qty - i.returned_qty <= 0 ? 'disabled' : ''}>` }, { h: 'قيمة العلبة', n: 1, f: (i) => money(i.total / i.qty) }], items) +
    `<div class="row mt"><div class="field"><label>طريقة رد المبلغ</label><select id="r_m"><option value="cash">كاش من الدرج</option><option value="card">رد على الفيزا (مش من الدرج)</option>${s.customer_id ? '<option value="balance">خصم من حساب العميل</option>' : ''}</select></div><span class="grow"></span><div><span class="mute">قيمة المرتجع</span><div id="r_t" style="font-size:26px;font-weight:800;color:var(--danger)">0.00</div></div></div>`,
    { wide: true, footer: '<button class="btn danger" id="r_ok">تأكيد المرتجع</button>' });
  const factor = s.subtotal > 0 ? s.total / s.subtotal : 1; // invoice-level discount shares into each item's refund
  const calc = () => { let t = 0; $$('[data-rq]', m).forEach((i) => { const it = items.find((x) => x.id == i.dataset.rq); const q = Math.min(num(i.value), it.qty - it.returned_qty); t += (it.total / it.qty) * q * factor; }); $('#r_t', m).textContent = money(t); return t; };
  m.addEventListener('input', (e) => e.target.dataset.rq && calc());
  $('#r_ok', m).onclick = async () => {
    const ops = []; let total = 0, cost = 0;
    ops.push({ sql: 'INSERT INTO sale_returns(sale_id,date,user_id,shift_id,total,cost_total,refund) VALUES(?,?,?,?,?,?,?)', params: [saleId, nowISO(), App.user.id, App.shift?.id || null, 0, 0, $('#r_m', m).value] });
    for (const i of $$('[data-rq]', m)) {
      const it = items.find((x) => x.id == i.dataset.rq); const q = Math.min(num(i.value), r2((it.qty - it.returned_qty) * 1000) / 1000); if (q <= 0) continue;
      total += (it.total / it.qty) * q * factor; cost += it.cost * q;
      ops.push({ sql: 'UPDATE sale_items SET returned_qty=returned_qty+? WHERE id=?', params: [q, it.id] });
      if (it.batch_id) ops.push({ sql: 'UPDATE batches SET qty=qty+? WHERE id=?', params: [q, it.batch_id] });
    }
    total = r2(total); if (total <= 0) return toast('حدد كمية المرتجع', 'err');
    ops.push({ sql: 'UPDATE sale_returns SET total=?, cost_total=? WHERE id=?', params: [total, r2(cost), '@0'] });
    if ($('#r_m', m).value === 'balance' && s.customer_id) ops.push({ sql: 'UPDATE customers SET balance=balance-? WHERE id=?', params: [total, s.customer_id] });
    await api.tx(ops); m.close(); toast(`تم المرتجع بقيمة ${money(total)}`, 'ok'); go('returns');
  };
}
