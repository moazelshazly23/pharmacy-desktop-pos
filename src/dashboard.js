'use strict';
// Home dashboard (v1.9.0): today at a glance
Views.home = async (el) => {
  el.style.padding = '18px 22px';
  const d = today(), f = d + 'T00:00:00', t = d + 'T23:59:59';
  const days = num(App.settings.expiry_days || 90), lim = addDays(d, days);
  const S = await Q1('SELECT COUNT(*) n, COALESCE(SUM(total),0) total, COALESCE(SUM(cost_total),0) cost, COALESCE(SUM(cash),0) cash FROM sales WHERE date BETWEEN ? AND ?', [f, t]);
  const R = await Q1('SELECT COALESCE(SUM(total),0) total, COALESCE(SUM(cost_total),0) cost FROM sale_returns WHERE date BETWEEN ? AND ?', [f, t]);
  const net = S.total - R.total, profit = net - (S.cost - R.cost);
  const shortN = (await Q1('SELECT COUNT(*) c FROM drugs d WHERE d.min_qty>0 AND (SELECT COALESCE(SUM(qty),0) FROM batches b WHERE b.drug_id=d.id)<=d.min_qty')).c;
  const nearN = (await Q1('SELECT COUNT(*) c FROM batches WHERE qty>0 AND expiry IS NOT NULL AND expiry>=? AND expiry<=?', [d, lim])).c;
  const expN = (await Q1('SELECT COUNT(*) c FROM batches WHERE qty>0 AND expiry IS NOT NULL AND expiry<?', [d])).c;
  const cd = (await Q1('SELECT COALESCE(SUM(balance),0) t FROM customers WHERE balance>0.001')).t;
  const sd = (await Q1('SELECT COALESCE(SUM(balance),0) t FROM suppliers WHERE balance>0.001')).t;
  const from7 = addDays(d, -6);
  const rows = await Q('SELECT substr(date,1,10) d, SUM(total) total FROM sales WHERE date BETWEEN ? AND ? GROUP BY d', [from7 + 'T00:00:00', t]);
  const rr = await Q('SELECT substr(date,1,10) d, SUM(total) total FROM sale_returns WHERE date BETWEEN ? AND ? GROUP BY d', [from7 + 'T00:00:00', t]);
  const m = {}; rows.forEach((r) => { m[r.d] = (m[r.d] || 0) + r.total; }); rr.forEach((r) => { m[r.d] = (m[r.d] || 0) - r.total; });
  const series = []; for (let i = 6; i >= 0; i--) { const k = addDays(d, -i); series.push({ k, v: Math.max(0, m[k] || 0) }); }
  const mx = Math.max(1, ...series.map((x) => x.v));
  const top = await Q('SELECT d.arabic, d.name, SUM(si.qty - si.returned_qty) q FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN drugs d ON d.id=si.drug_id WHERE s.date BETWEEN ? AND ? GROUP BY si.drug_id HAVING q>0 ORDER BY q DESC LIMIT 5', [f, t]);
  const showProfit = isAdmin() || App.user.role === 'pharmacist';
  const bars = series.map((x) => `<div style="flex:1;text-align:center"><div style="height:110px;display:flex;align-items:flex-end;justify-content:center"><div title="${money(x.v)}" style="width:70%;background:var(--p,#0f9d8a);border-radius:6px 6px 0 0;height:${Math.max(2, Math.round((x.v / mx) * 100))}%"></div></div><div class="small mute">${x.k.slice(5)}</div><div class="small">${money(x.v)}</div></div>`).join('');
  el.innerHTML = `<div class="grid g4 mb"><div class="stat p"><div class="l">صافي مبيعات اليوم (${S.n} فاتورة)</div><div class="v">${money(net)}</div></div>
    <div class="stat g"><div class="l">${showProfit ? 'مجمل ربح اليوم' : 'كاش اليوم'}</div><div class="v">${money(showProfit ? profit : S.cash)}</div></div>
    <div class="stat"><div class="l">مرتجعات اليوم</div><div class="v">${money(R.total)}</div></div>
    <div class="stat"><div class="l">الوردية</div><div class="v" style="font-size:18px">${App.shift ? 'مفتوحة' : 'مفيش وردية مفتوحة'}</div></div></div>
    <div class="grid g4 mb"><div class="stat ${shortN ? 'r' : ''}"><div class="l">أصناف ناقصة</div><div class="v">${shortN}</div><button class="btn sec sm" data-act="home-go" data-v="stock" data-tab="short">عرض</button></div>
    <div class="stat"><div class="l">قربت تنتهي (${days} يوم)</div><div class="v">${nearN}</div><button class="btn sec sm" data-act="home-go" data-v="stock" data-tab="near">عرض</button></div>
    <div class="stat ${expN ? 'r' : ''}"><div class="l">منتهية في المخزون</div><div class="v">${expN}</div><button class="btn sec sm" data-act="home-go" data-v="stock" data-tab="exp">عرض</button></div>
    <div class="stat"><div class="l">مديونيات العملاء / الموردين</div><div class="v" style="font-size:18px">${money(cd)} / ${money(sd)}</div></div></div>
    <div class="grid g2"><div class="card"><b>مبيعات آخر 7 أيام</b><div class="row mt" style="align-items:flex-end;gap:6px">${bars}</div></div>
    <div class="card"><b>أكتر أصناف اتباعت النهارده</b>${top.length ? table([{ h: 'الصنف', f: (r) => esc(r.arabic || r.name) }, { h: 'علب', n: 1, f: (r) => qtyf(r.q) }], top) : '<div class="empty">لسه مفيش مبيعات النهارده</div>'}</div></div>`;
};
ACT['home-go'] = (el) => { if (el.dataset.tab) StockState.tab = el.dataset.tab; go(el.dataset.v); };
