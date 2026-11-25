'use strict';
const RP = { from: null, to: null, tab: 'sum' };
Views.reports = async (el) => {
  el.style.padding = '18px 22px';
  RP.from = RP.from || today(); RP.to = RP.to || today();
  if (RP.from > RP.to) [RP.from, RP.to] = [RP.to, RP.from];
  const f = RP.from + 'T00:00:00', t = RP.to + 'T23:59:59';
  const preset = (a, b) => `data-act="rp-range" data-a="${a}" data-b="${b}"`;
  const d = today(), mStart = d.slice(0, 8) + '01';
  el.innerHTML = `<div class="row mb"><div class="tabs" style="margin:0">${[['sum', 'الملخص والأرباح'], ['items', 'الأصناف الأكثر مبيعاً'], ['users', 'حسب الكاشير'], ['days', 'يومي'], ['inv', 'الفواتير'], ['debts', 'المديونيات']].map(([k, n]) => `<button data-act="rp-tab" data-k="${k}" class="${RP.tab === k ? 'on' : ''}">${n}</button>`).join('')}</div><span class="grow"></span>
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
    const rows = await Q('SELECT d.arabic, d.name, SUM(si.qty - si.returned_qty) q, SUM(si.total * (si.qty - si.returned_qty) / si.qty * (CASE WHEN s.subtotal > 0 THEN s.total / s.subtotal ELSE 1 END)) rev, SUM(si.total * (si.qty - si.returned_qty) / si.qty * (CASE WHEN s.subtotal > 0 THEN s.total / s.subtotal ELSE 1 END) - si.cost * (si.qty - si.returned_qty)) profit FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN drugs d ON d.id=si.drug_id WHERE s.date BETWEEN ? AND ? GROUP BY si.drug_id ORDER BY q DESC LIMIT 100', [f, t]);
    body.innerHTML = `<div class="row mb"><span class="grow"></span><button class="btn sec" data-act="rp-csv-items">⬇ تصدير</button></div>` + table([{ h: 'الصنف', f: (r) => esc(r.arabic || r.name) }, { h: 'الكمية (علب)', n: 1, f: (r) => qtyf(r.q) }, { h: 'الإيراد', n: 1, f: (r) => money(r.rev) }, { h: 'الربح', n: 1, f: (r) => money(r.profit) }], rows, { empty: 'لا توجد مبيعات في الفترة' }); Views._ri = rows;
  } else if (RP.tab === 'users') {
    const rows = await Q(`SELECT u.name, COUNT(*) n, COALESCE(SUM(s.total),0) total, COALESCE(SUM(s.discount),0) disc,
      (SELECT COALESCE(SUM(r.total),0) FROM sale_returns r WHERE r.user_id=s.user_id AND r.date BETWEEN ? AND ?) rets
      FROM sales s LEFT JOIN users u ON u.id=s.user_id WHERE s.date BETWEEN ? AND ? GROUP BY s.user_id ORDER BY total DESC`, [f, t, f, t]);
    body.innerHTML = table([{ h: 'الكاشير', f: (r) => esc(r.name || '—') }, { h: 'عدد الفواتير', n: 1, f: 'n' }, { h: 'المبيعات', n: 1, f: (r) => money(r.total) }, { h: 'المرتجعات', n: 1, f: (r) => money(r.rets) }, { h: 'الصافي', n: 1, f: (r) => money(r.total - r.rets) }, { h: 'الخصومات', n: 1, f: (r) => money(r.disc) }], rows, { empty: 'لا توجد مبيعات' });
  } else if (RP.tab === 'days') {
    const rows = await Q(`SELECT x.d, SUM(x.n) n, SUM(x.total) total, SUM(x.profit) profit FROM (
      SELECT substr(date,1,10) d, COUNT(*) n, SUM(total) total, SUM(total-cost_total) profit FROM sales WHERE date BETWEEN ? AND ? GROUP BY d
      UNION ALL
      SELECT substr(date,1,10) d, 0 n, -SUM(total) total, SUM(cost_total)-SUM(total) profit FROM sale_returns WHERE date BETWEEN ? AND ? GROUP BY d
    ) x GROUP BY x.d ORDER BY x.d DESC`, [f, t, f, t]);
    body.innerHTML = table([{ h: 'اليوم', f: 'd' }, { h: 'فواتير', n: 1, f: 'n' }, { h: 'المبيعات', n: 1, f: (r) => money(r.total) }, { h: 'مجمل الربح', n: 1, f: (r) => money(r.profit) }], rows, { empty: 'لا توجد مبيعات' });
  } else if (RP.tab === 'inv') {
    const q = (RP.q || '').trim();
    const rows = await Q(`SELECT s.id, s.date, s.total, s.discount, c.name cname, u.name uname FROM sales s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN users u ON u.id=s.user_id WHERE s.date BETWEEN ? AND ? AND (?='' OR CAST(s.id AS TEXT)=? OR c.name LIKE ?) ORDER BY s.id DESC LIMIT 300`, [f, t, q, q, '%' + q + '%']);
    body.innerHTML = `<div class="row mb"><input id="rinv" placeholder="رقم الفاتورة أو اسم العميل" value="${esc(q)}" style="width:260px"><button class="btn" data-act="rp-inv-find">بحث</button><span class="mute small">بيعرض آخر 300 فاتورة في الفترة</span></div>` + table([{ h: 'رقم', f: 'id' }, { h: 'الوقت', f: (r) => ftime(r.date) }, { h: 'العميل', f: (r) => esc(r.cname || 'نقدي') }, { h: 'الكاشير', f: (r) => esc(r.uname || '') }, { h: 'الإجمالي', n: 1, f: (r) => money(r.total) }, { h: '', f: (r) => `<button class="btn sec sm" data-act="rp-inv-print" data-id="${r.id}">🖨 طباعة</button> <button class="btn sec sm" data-act="rp-inv-ret" data-id="${r.id}">مرتجع</button>` }], rows, { empty: 'مفيش فواتير' });
    const ri = $('#rinv'); if (ri) ri.addEventListener('keydown', (e) => { if (e.key === 'Enter') ACT['rp-inv-find'](); });
  } else {
    const cs = await Q('SELECT name, phone, balance FROM customers WHERE balance>0.001 ORDER BY balance DESC'), ss = await Q('SELECT name, phone, balance FROM suppliers WHERE balance>0.001 ORDER BY balance DESC');
    const csNeg = await Q('SELECT name, phone, balance FROM customers WHERE balance<-0.001 ORDER BY balance'), ssNeg = await Q('SELECT name, phone, balance FROM suppliers WHERE balance<-0.001 ORDER BY balance');
    Views._debts = { cs, csNeg, ss, ssNeg };
    const cols = [{ h: 'الاسم', f: (r) => esc(r.name) }, { h: 'التليفون', f: (r) => esc(r.phone || '') }, { h: 'المبلغ', n: 1, f: (r) => money(r.balance) }];
    const colsAbs = [{ h: 'الاسم', f: (r) => esc(r.name) }, { h: 'التليفون', f: (r) => esc(r.phone || '') }, { h: 'المبلغ', n: 1, f: (r) => money(-r.balance) }];
    body.innerHTML = `<div class="row mb"><span class="grow"></span><button class="btn sec" data-act="rp-csv-debts">⬇ تصدير المديونيات</button></div><div class="grid g2"><div><b>مديونيات العملاء (لينا)</b>${table(cols, cs, { empty: 'لا توجد' })}${csNeg.length ? `<div class="mt"><b>عملاء لهم فلوس عندنا</b>${table(colsAbs, csNeg)}</div>` : ''}</div><div><b>مستحقات الموردين (علينا)</b>${table(cols, ss, { empty: 'لا توجد' })}${ssNeg.length ? `<div class="mt"><b>موردين لنا عندهم (دفعنا زيادة)</b>${table(colsAbs, ssNeg)}</div>` : ''}</div></div>`;
  }
};
ACT['rp-csv-debts'] = () => { const d = Views._debts || { cs: [], csNeg: [], ss: [], ssNeg: [] }; downloadCSV('debts.csv', ['النوع', 'الاسم', 'التليفون', 'المبلغ'], [...d.cs.map((r) => ['عميل عليه', r.name, r.phone, r.balance]), ...d.csNeg.map((r) => ['عميل له', r.name, r.phone, -r.balance]), ...d.ss.map((r) => ['مورد له', r.name, r.phone, r.balance]), ...d.ssNeg.map((r) => ['مورد عليه', r.name, r.phone, -r.balance])]); };
ACT['rp-tab'] = (el) => { RP.tab = el.dataset.k; go('reports'); };
ACT['rp-range'] = (el) => { RP.from = el.dataset.a; RP.to = el.dataset.b; go('reports'); };
ACT['rp-csv-items'] = () => downloadCSV('top-items.csv', ['الصنف', 'الكمية', 'الإيراد', 'الربح'], (Views._ri || []).map((r) => [r.arabic || r.name, r.q, r.rev, r.profit]));
ACT['rp-inv-find'] = () => { RP.q = $('#rinv').value; go('reports'); };
ACT['rp-inv-print'] = (el) => printReceipt(+el.dataset.id, { force: true });
ACT['rp-inv-ret'] = async (el) => { if (!can('returns')) return; await go('returns'); openReturn(+el.dataset.id); };
