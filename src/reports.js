'use strict';
const RP = { from: null, to: null, tab: 'sum' };
Views.reports = async (el) => {
  el.style.padding = '18px 22px';
  RP.from = RP.from || today(); RP.to = RP.to || today();
  const f = RP.from + 'T00:00:00', t = RP.to + 'T23:59:59';
  const preset = (a, b) => `data-act="rp-range" data-a="${a}" data-b="${b}"`;
  const d = today(), mStart = d.slice(0, 8) + '01';
  el.innerHTML = `<div class="row mb"><div class="tabs" style="margin:0">${[['sum', 'الملخص والأرباح'], ['items', 'الأصناف الأكثر مبيعاً'], ['users', 'حسب الكاشير'], ['days', 'يومي'], ['debts', 'المديونيات']].map(([k, n]) => `<button data-act="rp-tab" data-k="${k}" class="${RP.tab === k ? 'on' : ''}">${n}</button>`).join('')}</div><span class="grow"></span>
   <button class="btn sec sm" ${preset(d, d)}>اليوم</button><button class="btn sec sm" ${preset(addDays(d, -1), addDays(d, -1))}>أمس</button><button class="btn sec sm" ${preset(addDays(d, -6), d)}>7 أيام</button><button class="btn sec sm" ${preset(mStart, d)}>الشهر</button>
   <input type="date" id="rf" value="${RP.from}"><span>إلى</span><input type="date" id="rt" value="${RP.to}"></div><div id="rb"></div>`;
  $('#rf').onchange = $('#rt').onchange = () => { RP.from = $('#rf').value; RP.to = $('#rt').value; go('reports'); };
  const body = $('#rb');
  const S = await Q1('SELECT COUNT(*) n, COALESCE(SUM(subtotal),0) sub, COALESCE(SUM(discount),0) disc, COALESCE(SUM(total),0) total, COALESCE(SUM(cost_total),0) cost, COALESCE(SUM(cash),0) cash, COALESCE(SUM(card),0) card, COALESCE(SUM(credit),0) credit FROM sales WHERE date BETWEEN ? AND ?', [f, t]);
  const R = await Q1('SELECT COALESCE(SUM(total),0) total, COALESCE(SUM(cost_total),0) cost FROM sale_returns WHERE date BETWEEN ? AND ?', [f, t]);
  const E = await Q1('SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE date BETWEEN ? AND ?', [f, t]);
  if (RP.tab === 'sum') {
    const net = S.total - R.total, gross = net - (S.cost - R.cost), netp = gross - E.t;
    body.innerHTML = `<div class="grid g4 mb"><div class="stat p"><div class="l">صافي المبيعات (${S.n} فاتورة)</div><div class="v">${money(net)}</div></div><div class="stat"><div class="l">مرتجعات</div><div class="v">${money(R.total)}</div></div><div class="stat"><div class="l">خصومات ممنوحة</div><div class="v">${money(S.disc)}</div></div><div class="stat"><div class="l">متوسط الفاتورة</div><div class="v">${S.n ? money(S.total / S.n) : '0.00'}</div></div>
     <div class="stat"><div class="l">تكلفة البضاعة المباعة</div><div class="v">${money(S.cost - R.cost)}</div></div><div class="stat g"><div class="l">مجمل الربح</div><div class="v">${money(gross)}</div></div><div class="stat r"><div class="l">المصروفات</div><div class="v">${money(E.t)}</div></div><div class="stat g"><div class="l">صافي الربح</div><div class="v">${money(netp)}</div></div></div>
     <div class="card"><b>طرق الدفع</b><div class="grid g3 mt"><div class="stat"><div class="l">كاش</div><div class="v">${money(S.cash)}</div></div><div class="stat"><div class="l">فيزا</div><div class="v">${money(S.card)}</div></div><div class="stat"><div class="l">آجل</div><div class="v">${money(S.credit)}</div></div></div></div><div class="small mute mt">الربح محسوب على تكلفة الشراء المسجلة في التشغيلات. الأصناف المباعة بدون تكلفة مسجلة بتتحسب بتكلفة صفر.</div>`;
  } else if (RP.tab === 'items') {
    const rows = await Q('SELECT d.arabic, d.name, SUM(si.qty) q, SUM(si.total) rev, SUM(si.total - si.cost*si.qty) profit FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN drugs d ON d.id=si.drug_id WHERE s.date BETWEEN ? AND ? GROUP BY si.drug_id ORDER BY q DESC LIMIT 100', [f, t]);
    body.innerHTML = `<div class="row mb"><span class="grow"></span><button class="btn sec" data-act="rp-csv-items">⬇ تصدير</button></div>` + table([{ h: 'الصنف', f: (r) => esc(r.arabic || r.name) }, { h: 'الكمية (علب)', n: 1, f: (r) => qtyf(r.q) }, { h: 'الإيراد', n: 1, f: (r) => money(r.rev) }, { h: 'الربح', n: 1, f: (r) => money(r.profit) }], rows, { empty: 'لا توجد مبيعات في الفترة' }); Views._ri = rows;
  } else if (RP.tab === 'users') {
    const rows = await Q('SELECT u.name, COUNT(*) n, SUM(s.total) total, SUM(s.discount) disc FROM sales s LEFT JOIN users u ON u.id=s.user_id WHERE s.date BETWEEN ? AND ? GROUP BY s.user_id ORDER BY total DESC', [f, t]);
    body.innerHTML = table([{ h: 'الكاشير', f: (r) => esc(r.name || '—') }, { h: 'عدد الفواتير', n: 1, f: 'n' }, { h: 'المبيعات', n: 1, f: (r) => money(r.total) }, { h: 'الخصومات', n: 1, f: (r) => money(r.disc) }], rows, { empty: 'لا توجد مبيعات' });
  } else if (RP.tab === 'days') {
    const rows = await Q('SELECT substr(date,1,10) d, COUNT(*) n, SUM(total) total, SUM(total-cost_total) profit FROM sales WHERE date BETWEEN ? AND ? GROUP BY d ORDER BY d DESC', [f, t]);
    body.innerHTML = table([{ h: 'اليوم', f: 'd' }, { h: 'فواتير', n: 1, f: 'n' }, { h: 'المبيعات', n: 1, f: (r) => money(r.total) }, { h: 'مجمل الربح', n: 1, f: (r) => money(r.profit) }], rows, { empty: 'لا توجد مبيعات' });
  } else {
    const cs = await Q('SELECT name, phone, balance FROM customers WHERE balance>0.001 ORDER BY balance DESC'), ss = await Q('SELECT name, phone, balance FROM suppliers WHERE balance>0.001 ORDER BY balance DESC');
    const cols = [{ h: 'الاسم', f: (r) => esc(r.name) }, { h: 'التليفون', f: (r) => esc(r.phone || '') }, { h: 'المبلغ', n: 1, f: (r) => money(r.balance) }];
    body.innerHTML = `<div class="grid g2"><div><b>مديونيات العملاء (لينا)</b>${table(cols, cs, { empty: 'لا توجد' })}</div><div><b>مستحقات الموردين (علينا)</b>${table(cols, ss, { empty: 'لا توجد' })}</div></div>`;
  }
};
ACT['rp-tab'] = (el) => { RP.tab = el.dataset.k; go('reports'); };
ACT['rp-range'] = (el) => { RP.from = el.dataset.a; RP.to = el.dataset.b; go('reports'); };
ACT['rp-csv-items'] = () => downloadCSV('top-items.csv', ['الصنف', 'الكمية', 'الإيراد', 'الربح'], (Views._ri || []).map((r) => [r.arabic || r.name, r.q, r.rev, r.profit]));
