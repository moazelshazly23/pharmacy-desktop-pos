'use strict';
async function shiftSummary(sh) {
  const id = sh.id;
  const s = await Q1('SELECT COALESCE(SUM(total),0) total, COALESCE(SUM(cash),0) cash, COALESCE(SUM(card),0) card, COALESCE(SUM(credit),0) credit, COUNT(*) n FROM sales WHERE shift_id=?', [id]);
  const rc = await Q1("SELECT COALESCE(SUM(total),0) t FROM sale_returns WHERE shift_id=? AND refund='cash'", [id]);
  const pc = await Q1("SELECT COALESCE(SUM(amount),0) t FROM payments WHERE shift_id=? AND party_type='customer' AND method='drawer'", [id]);
  const ps = await Q1("SELECT COALESCE(SUM(amount),0) t FROM payments WHERE shift_id=? AND party_type='supplier' AND method='drawer'", [id]);
  const ex = await Q1('SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE shift_id=?', [id]);
  const expected = r2(sh.opening_cash + s.cash + pc.t - rc.t - ps.t - ex.t);
  return { ...s, returnsCash: rc.t, custPay: pc.t, supPay: ps.t, expenses: ex.t, expected };
}
Views.cash = async (el) => {
  el.style.padding = '18px 22px';
  await currentShift();
  const exps = await Q('SELECT e.*, u.name uname FROM expenses e LEFT JOIN users u ON u.id=e.user_id ORDER BY e.id DESC LIMIT 60');
  const shifts = await Q('SELECT s.*, u.name uname FROM shifts s LEFT JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 30');
  let sh = '';
  if (App.shift) {
    const t = await shiftSummary(App.shift);
    sh = `<div class="card mb"><div class="row mb"><b style="font-size:16px">الوردية الحالية</b><span class="pill">فُتحت ${ftime(App.shift.opened_at)}</span><span class="grow"></span><button class="btn danger" data-act="shift-close">إقفال الوردية وجرد الدرج</button></div>
    <div class="grid g4"><div class="stat"><div class="l">مبيعات الوردية (${t.n} فاتورة)</div><div class="v">${money(t.total)}</div></div><div class="stat"><div class="l">كاش</div><div class="v">${money(t.cash)}</div></div><div class="stat"><div class="l">فيزا</div><div class="v">${money(t.card)}</div></div><div class="stat p"><div class="l">المتوقع في الدرج</div><div class="v">${money(t.expected)}</div></div></div>
    <div class="small mute mt">المتوقع = رصيد الافتتاح ${money(App.shift.opening_cash)} + كاش المبيعات + التحصيلات − مرتجعات كاش − المصروفات − سداد الموردين</div></div>`;
  } else sh = `<div class="card mb row"><b>لا توجد وردية مفتوحة</b><span class="mute small">افتح وردية عشان كل العمليات تتحسب على الدرج.</span><span class="grow"></span><button class="btn lg" data-act="shift-open">فتح وردية</button></div>`;
  el.innerHTML = sh + `<div class="grid g2"><div><div class="row mb"><b style="font-size:16px">المصروفات</b><span class="grow"></span><button class="btn" data-act="exp-new">+ مصروف</button></div>${table([{ h: 'التاريخ', f: (e) => ftime(e.date) }, { h: 'البند', f: (e) => esc(e.category || '') }, { h: 'المبلغ', n: 1, f: (e) => money(e.amount) }, { h: 'ملاحظة', f: (e) => esc(e.note || '') }], exps, { empty: 'لا توجد مصروفات' })}</div>
   <div><div class="row mb"><b style="font-size:16px">سجل الورديات</b></div>${table([{ h: '#', f: 'id' }, { h: 'الكاشير', f: (s) => esc(s.uname || '') }, { h: 'الفتح', f: (s) => ftime(s.opened_at) }, { h: 'الإقفال', f: (s) => ftime(s.closed_at) || '<span class="pill">مفتوحة</span>' }, { h: 'المتوقع', n: 1, f: (s) => (s.expected_cash == null ? '' : money(s.expected_cash)) }, { h: 'الفعلي', n: 1, f: (s) => (s.counted_cash == null ? '' : money(s.counted_cash)) }, { h: 'الفرق', n: 1, f: (s) => (s.counted_cash == null ? '' : `<span class="pill ${Math.abs(s.counted_cash - s.expected_cash) < 0.01 ? '' : 'red'}">${money(s.counted_cash - s.expected_cash)}</span>`) }], shifts, { empty: 'لا توجد ورديات' })}</div></div>`;
};
ACT['shift-open'] = async () => {
  const v = await promptBox('فتح وردية', 'رصيد الدرج الافتتاحي (كاش)', '0', 'number'); if (v === null) return;
  const r = await X('INSERT INTO shifts(user_id,opened_at,opening_cash) VALUES(?,?,?)', [App.user.id, nowISO(), num(v)]);
  await currentShift(); await audit('فتح وردية', `رصيد ${money(num(v))}`); toast('تم فتح الوردية', 'ok'); go('cash');
};
ACT['shift-close'] = async () => {
  const t = await shiftSummary(App.shift);
  const m = modal('إقفال الوردية', `<div class="grid g2"><div class="stat"><div class="l">المتوقع في الدرج</div><div class="v">${money(t.expected)}</div></div><div class="field"><label>الكاش الفعلي في الدرج (جرد)</label><input id="cc" inputmode="decimal" autofocus></div></div><div id="cd" class="mt b"></div><div class="field mt"><label>ملاحظات</label><input id="cn"></div>`, { footer: '<button class="btn danger" id="cok">إقفال نهائي</button>' });
  $('#cc', m).oninput = () => { const d = num($('#cc', m).value) - t.expected; $('#cd', m).innerHTML = `الفرق: <span style="color:${Math.abs(d) < 0.01 ? 'var(--ok)' : 'var(--danger)'}">${money(d)}</span> ${d > 0.01 ? '(زيادة)' : d < -0.01 ? '(عجز)' : '(مظبوط)'}`; };
  $('#cok', m).onclick = async () => {
    if ($('#cc', m).value.trim() === '') return toast('اكتب الكاش الفعلي', 'err');
    await X('UPDATE shifts SET closed_at=?, expected_cash=?, counted_cash=?, note=? WHERE id=?', [nowISO(), t.expected, num($('#cc', m).value), $('#cn', m).value, App.shift.id]);
    await audit('إقفال وردية', `متوقع ${money(t.expected)} فعلي ${money(num($('#cc', m).value))}`); App.shift = null; m.close(); toast('تم إقفال الوردية', 'ok'); go('cash');
  };
};
ACT['exp-new'] = async () => {
  const m = modal('مصروف جديد', `<div class="grid g2"><div class="field"><label>البند</label><input id="ec" list="cats" placeholder="إيجار، كهرباء، مرتبات..."><datalist id="cats"><option>إيجار</option><option>كهرباء ومياه</option><option>مرتبات</option><option>نظافة</option><option>مستلزمات</option><option>أخرى</option></datalist></div><div class="field"><label>المبلغ</label><input id="ea" inputmode="decimal"></div><div class="field" style="grid-column:1/3"><label>ملاحظة</label><input id="en"></div></div>`, { footer: '<button class="btn" id="eok">حفظ</button>' });
  $('#eok', m).onclick = async () => {
    const a = num($('#ea', m).value); if (a <= 0) return toast('اكتب المبلغ', 'err');
    await X('INSERT INTO expenses(date,category,amount,note,user_id,shift_id) VALUES(?,?,?,?,?,?)', [nowISO(), $('#ec', m).value, a, $('#en', m).value, App.user.id, App.shift?.id || null]);
    await audit('مصروف', `${$('#ec', m).value} ${money(a)}`); m.close(); go('cash');
  };
};
