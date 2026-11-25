'use strict';
const StockState = { tab: 'short' };
Views.stock = async (el) => {
  el.style.padding = '18px 22px';
  const days = num(App.settings.expiry_days || 90), lim = addDays(today(), days);
  const exp = await Q('SELECT b.*, d.arabic, d.name, d.company FROM batches b JOIN drugs d ON d.id=b.drug_id WHERE b.qty>0 AND b.expiry IS NOT NULL AND b.expiry<? ORDER BY b.expiry', [today()]);
  const near = await Q('SELECT b.*, d.arabic, d.name, d.company FROM batches b JOIN drugs d ON d.id=b.drug_id WHERE b.qty>0 AND b.expiry IS NOT NULL AND b.expiry>=? AND b.expiry<=? ORDER BY b.expiry', [today(), lim]);
  const short = await Q('SELECT d.*, (SELECT COALESCE(SUM(qty),0) FROM batches b WHERE b.drug_id=d.id) AS stock FROM drugs d WHERE d.min_qty>0 AND stock<=d.min_qty ORDER BY stock');
  const val = await Q1('SELECT COALESCE(SUM(b.qty*b.cost),0) cost, COALESCE(SUM(b.qty*d.price),0) retail, COUNT(DISTINCT b.drug_id) items FROM batches b JOIN drugs d ON d.id=b.drug_id WHERE b.qty>0');
  const tabs = [['short', `نواقص (${short.length})`], ['near', `قرب الانتهاء (${near.length})`], ['exp', `منتهية (${exp.length})`], ['all', 'كل المخزون']];
  el.innerHTML = `<div class="grid g4 mb"><div class="stat p"><div class="l">أصناف في المخزون</div><div class="v">${val.items}</div></div><div class="stat"><div class="l">قيمة المخزون بالتكلفة</div><div class="v">${money(val.cost)}</div></div><div class="stat g"><div class="l">قيمة المخزون بسعر الجمهور</div><div class="v">${money(val.retail)}</div></div><div class="stat r"><div class="l">تنبيهات (نواقص + انتهاء)</div><div class="v">${short.length + near.length + exp.length}</div></div></div>
   <div class="tabs">${tabs.map(([k, t]) => `<button data-act="stock-tab" data-k="${k}" class="${StockState.tab === k ? 'on' : ''}">${t}</button>`).join('')}</div><div id="sb"></div>`;
  const body = $('#sb');
  const batchCols = [{ h: 'الصنف', f: (b) => `<b>${esc(b.arabic || b.name)}</b><div class="small mute">${esc(b.company || '')}</div>` }, { h: 'التشغيلة', f: (b) => esc(b.batch_no || '—') }, { h: 'الصلاحية', f: (b) => expiryBadge(b.expiry) }, { h: 'الكمية', n: 1, f: (b) => qtyf(b.qty) }, { h: 'قيمة التكلفة', n: 1, f: (b) => money(b.qty * b.cost) }, { h: '', f: (b) => `<button class="btn sec sm" data-act="item-open" data-id="${b.drug_id}">فتح</button>` }];
  if (StockState.tab === 'short') {
    body.innerHTML = `<div class="row mb"><span class="mute small">الأصناف اللي رصيدها وصل لحد الطلب أو أقل. حدد حد الطلب لكل صنف من شاشة الصنف.</span><span class="grow"></span><button class="btn sec" data-act="short-csv">⬇ تصدير قائمة النواقص</button></div>` + table([{ h: 'الصنف', f: (d) => `<b>${esc(d.arabic || d.name)}</b><div class="small mute">${esc(d.company || '')}</div>` }, { h: 'الرصيد', f: (d) => stockPill(d.stock, d.min_qty) }, { h: 'حد الطلب', n: 1, f: (d) => qtyf(d.min_qty) }, { h: 'المطلوب', n: 1, f: (d) => qtyf(suggestQty(d)) }, { h: '', f: (d) => `<button class="btn sec sm" data-act="item-open" data-id="${d.id}">فتح</button>` }], short, { empty: 'مفيش نواقص 👌' });
    Views._short = short;
  } else if (StockState.tab === 'near') body.innerHTML = table(batchCols, near, { empty: `مفيش أصناف تنتهي خلال ${days} يوم` });
  else if (StockState.tab === 'exp') body.innerHTML = `<div class="alert danger">الأصناف دي منتهية ولازم تتسحب من الرف ومترجعش للبيع (النظام بيتجاهلها تلقائي في البيع).</div>` + table(batchCols, exp, { empty: 'مفيش أصناف منتهية 👌' });
  else {
    const all = await Q('SELECT d.*, (SELECT COALESCE(SUM(qty),0) FROM batches b WHERE b.drug_id=d.id) AS stock, (SELECT MIN(expiry) FROM batches b WHERE b.drug_id=d.id AND b.qty>0) AS nearest FROM drugs d WHERE stock<>0 ORDER BY d.arabic');
    body.innerHTML = `<div class="row mb"><span class="mute small">كل الأصناف اللي ليها رصيد</span><span class="grow"></span><button class="btn sec" data-act="stock-csv">⬇ تصدير الجرد</button></div>` + (all.length > 600 ? `<div class="small mute mb">بيعرض أول 600 صنف من ${all.length}. التصدير بيشمل الكل.</div>` : '') + table([{ h: 'الصنف', f: (d) => `<b>${esc(d.arabic || d.name)}</b>` }, { h: 'الرصيد', f: (d) => stockPill(d.stock, d.min_qty) }, { h: 'أقرب صلاحية', f: (d) => expiryBadge(d.nearest) }, { h: 'التكلفة', n: 1, f: (d) => money(d.cost) }, { h: 'السعر', n: 1, f: (d) => money(d.price) }, { h: '', f: (d) => `<button class="btn sec sm" data-act="item-open" data-id="${d.id}">فتح/جرد</button>` }], all.slice(0, 600), { empty: 'المخزون فاضي. أضف الأرصدة من شاشة الأصناف أو من المشتريات.' });
    Views._all = all;
  }
};
ACT['stock-tab'] = (el) => { StockState.tab = el.dataset.k; go('stock'); };
const suggestQty = (d) => Math.max(1, Math.ceil(d.min_qty * 2 - d.stock));
ACT['short-csv'] = () => downloadCSV('shortages.csv', ['الصنف', 'الشركة', 'الرصيد', 'حد الطلب', 'الكمية المقترحة للطلب'], (Views._short || []).map((d) => [d.arabic || d.name, d.company, d.stock, d.min_qty, suggestQty(d)]));
ACT['stock-csv'] = () => downloadCSV('stock.csv', ['الصنف', 'الرصيد', 'التكلفة', 'السعر', 'أقرب صلاحية'], (Views._all || []).map((d) => [d.arabic || d.name, d.stock, d.cost, d.price, d.nearest]));
