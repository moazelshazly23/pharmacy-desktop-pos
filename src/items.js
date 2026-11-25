'use strict';
const ItemsState = { q: '', kind: '', inStock: false };
Views.items = async (el) => {
  el.style.padding = '18px 22px';
  const total = await Q1('SELECT COUNT(*) c, SUM(kind="cosmetic") cos, SUM(barcode IS NOT NULL) bc FROM drugs');
  el.innerHTML = `<div class="row mb"><div class="grow" style="min-width:280px"><input id="iq" style="width:100%;padding:12px" placeholder="ابحث بالاسم، المادة الفعالة، الشركة أو الباركود... (F3)" value="${esc(ItemsState.q)}"></div>
    <select id="ik"><option value="">الكل (أدوية ومستحضرات)</option><option value="drug">أدوية</option><option value="cosmetic">مستحضرات تجميل وعناية</option></select>
    <label class="row small"><input type="checkbox" id="is" ${ItemsState.inStock ? 'checked' : ''}> المتوفر فقط</label>
    <button class="btn" data-act="item-new">+ صنف جديد</button></div>
    <div class="small mute mb">قاعدة البيانات: ${total.c.toLocaleString('en-US')} صنف (منها ${(total.cos || 0).toLocaleString('en-US')} مستحضر تجميل وعناية) · ${(total.bc || 0).toLocaleString('en-US')} صنف بباركود</div><div id="il"></div>`;
  $('#ik').value = ItemsState.kind;
  const load = async () => {
    ItemsState.q = $('#iq').value; ItemsState.kind = $('#ik').value; ItemsState.inStock = $('#is').checked;
    let rows;
    if (ItemsState.q.trim()) rows = await searchDrugs(ItemsState.q, { limit: 150, kind: ItemsState.kind, inStock: ItemsState.inStock });
    else rows = await Q(`SELECT d.*, (SELECT COALESCE(SUM(qty),0) FROM batches b WHERE b.drug_id=d.id) AS stock FROM drugs d WHERE 1=1 ${ItemsState.kind ? `AND d.kind='${ItemsState.kind}'` : ''} ${ItemsState.inStock ? 'AND stock>0' : ''} ORDER BY stock>0 DESC, d.is_custom DESC, d.id DESC LIMIT 100`);
    $('#il').innerHTML = table([
      { h: 'الاسم', f: (d) => `<b>${esc(d.arabic || d.name)}</b><div class="small mute ltr">${esc(d.name || '')}</div>` },
      { h: 'المادة الفعالة', f: (d) => `<span class="small">${esc(d.active || '')}</span>` },
      { h: 'الشركة', f: (d) => `<span class="small">${esc(d.company || '')}</span>` },
      { h: 'السعر', n: 1, f: (d) => money(d.price) },
      { h: 'الرصيد', f: (d) => stockPill(d.stock, d.min_qty) },
      { h: 'باركود', f: (d) => `<span class="small ltr">${esc(d.barcode || '')}</span>` },
      { h: '', f: (d) => `<button class="btn sec sm" data-act="item-open" data-id="${d.id}">فتح</button>` },
    ], rows.map((d) => ({ ...d, _attr: `data-act="item-open" data-id="${d.id}" style="cursor:pointer"` })), { empty: 'مفيش نتائج', maxh: 'calc(100vh - 230px)' });
  };
  const dl = debounce(load, 180);
  $('#iq').oninput = dl; $('#ik').onchange = load; $('#is').onchange = load;
  load(); $('#iq').focus();
};
ACT['item-open'] = (el) => openItem(+el.dataset.id);
ACT['item-new'] = () => openItem(0);

async function openItem(id, afterClose) {
  const d = id ? await getDrug(id) : { id: 0, name: '', arabic: '', active: '', company: '', price: 0, barcode: '', strips: 1, min_qty: 0, kind: 'drug', uses: '', category: '', stock: 0 };
  const canEdit = App.user.role !== 'cashier';
  const m = modal(id ? esc(d.arabic || d.name) : 'صنف جديد', '<div id="ib"></div>', { wide: true, onClose: afterClose });
  const render = async () => {
    const batches = id ? await Q('SELECT * FROM batches WHERE drug_id=? ORDER BY expiry IS NULL, expiry', [id]) : [];
    const alts = id ? await alternativesOf(d, 20) : [];
    $('#ib', m).innerHTML = `<div class="grid g2">
     <div><div class="grid g2">
      <div class="field" style="grid-column:1/3"><label>الاسم بالعربي</label><input id="f_ar" value="${esc(d.arabic)}" ${canEdit ? '' : 'readonly'}></div>
      <div class="field" style="grid-column:1/3"><label>الاسم بالإنجليزي</label><input id="f_en" class="ltr" value="${esc(d.name)}" ${canEdit ? '' : 'readonly'}></div>
      <div class="field" style="grid-column:1/3"><label>المادة الفعالة</label><input id="f_ac" class="ltr" value="${esc(d.active)}" ${canEdit ? '' : 'readonly'}></div>
      <div class="field"><label>الشركة</label><input id="f_co" value="${esc(d.company)}" ${canEdit ? '' : 'readonly'}></div>
      <div class="field"><label>النوع</label><select id="f_kd" ${canEdit ? '' : 'disabled'}><option value="drug">دواء</option><option value="cosmetic">مستحضر تجميل/عناية</option><option value="other">أخرى</option></select></div>
      <div class="field"><label>سعر الجمهور (${cur()})</label><input id="f_pr" value="${d.price}" ${canEdit ? '' : 'readonly'}></div>
      <div class="field"><label>الباركود</label><input id="f_bc" class="ltr" value="${esc(d.barcode || '')}" ${canEdit ? '' : 'readonly'}></div>
      <div class="field"><label>حد الطلب (نواقص عند)</label><input id="f_mq" value="${d.min_qty || 0}" ${canEdit ? '' : 'readonly'}></div>
      <div class="field"><label>عدد الأشرطة في العلبة</label><input id="f_st" value="${d.strips || 1}" ${canEdit ? '' : 'readonly'}></div></div>
      ${d.uses ? `<div class="alert info mt"><b>دواعي الاستعمال:</b> ${esc(d.uses)}</div>` : ''}
      ${canEdit ? `<div class="row mt"><button class="btn" data-act="item-save">💾 حفظ</button></div>` : ''}</div>
     <div><div class="row mb"><b>التشغيلات والمخزون</b><span class="grow"></span>${id ? stockPill(d.stock, d.min_qty) : ''}${id && canEdit ? '<button class="btn sec sm" data-act="batch-add">+ رصيد/تشغيلة</button>' : ''}</div>
      ${id ? table([{ h: 'رقم التشغيلة', f: (b) => esc(b.batch_no || '—') }, { h: 'الصلاحية', f: (b) => expiryBadge(b.expiry) }, { h: 'الكمية', n: 1, f: (b) => qtyf(b.qty) }, { h: 'التكلفة', n: 1, f: (b) => money(b.cost) }, { h: '', f: (b) => canEdit ? `<button class="btn sec sm" data-act="batch-adj" data-id="${b.id}">جرد/تعديل</button>` : '' }], batches, { empty: 'لا توجد تشغيلات' }) : '<div class="mute small">احفظ الصنف الأول ثم أضف رصيده.</div>'}
      <div class="mt"><b>🔁 البدائل</b></div>
      <div style="max-height:200px;overflow:auto" class="mt">${alts.length ? alts.map((a) => `<div class="res" data-act="item-open" data-id="${a.id}"><div class="grow"><div class="nm">${esc(a.arabic || a.name)}</div><div class="en">${esc(a.company || '')}</div></div>${stockPill(a.stock)}<div class="pr">${money(a.price)}</div></div>`).join('') : '<div class="mute small">لا توجد بدائل</div>'}</div></div></div>`;
    $('#f_kd', m).value = d.kind || 'drug';
  };
  await render();
  m.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'item-open') { e.stopPropagation(); m.close(); return openItem(+b.dataset.id); }
    if (b.dataset.act === 'item-save') {
      e.stopPropagation();
      const v = (s) => $(s, m).value.trim();
      if (!v('#f_ar') && !v('#f_en')) return toast('اكتب اسم الصنف', 'err');
      const bc = v('#f_bc');
      if (bc) { const ex = await Q1('SELECT id,arabic FROM drugs WHERE barcode=? AND id<>?', [bc, d.id]); if (ex) return toast('الباركود ده مسجل على صنف تاني: ' + (ex.arabic || ''), 'err'); }
      const search = normAr([v('#f_ar'), v('#f_en'), v('#f_ac'), bc, v('#f_co')].join(' '));
      const vals = [v('#f_en'), v('#f_ar'), v('#f_ac'), v('#f_co'), num(v('#f_pr')), bc || null, Math.max(1, Math.round(num(v('#f_st')) || 1)), num(v('#f_mq')), $('#f_kd', m).value, search];
      if (id) await X('UPDATE drugs SET name=?,arabic=?,active=?,company=?,price=?,barcode=?,strips=?,min_qty=?,kind=?,search=? WHERE id=?', [...vals, id]);
      else { const r = await X('INSERT INTO drugs(name,arabic,active,company,price,barcode,strips,min_qty,kind,search,is_custom) VALUES(?,?,?,?,?,?,?,?,?,?,1)', vals); id = r.id; }
      Object.assign(d, await getDrug(id)); toast('تم الحفظ', 'ok'); await render(); refreshBadges();
    }
    if (b.dataset.act === 'batch-add') { e.stopPropagation(); await batchForm(id, null, render); }
    if (b.dataset.act === 'batch-adj') { e.stopPropagation(); const bt = await Q1('SELECT * FROM batches WHERE id=?', [b.dataset.id]); await batchForm(id, bt, async () => { Object.assign(d, await getDrug(id)); await render(); }); }
  });
  return m;
}
function monthToDate(v) { // "2027-03" -> last day of month; full date passes through
  v = String(v || '').trim(); if (!v) return null;
  if (/^\d{4}-\d{2}$/.test(v)) { const [y, mo] = v.split('-').map(Number); return `${y}-${pad(mo)}-${pad(new Date(y, mo, 0).getDate())}`; }
  const m = v.match(/^(\d{1,2})[\/\-](\d{4})$/); if (m) return monthToDate(`${m[2]}-${pad(+m[1])}`);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
async function batchForm(drugId, b, done) {
  const m = modal(b ? 'جرد / تعديل تشغيلة' : 'إضافة رصيد افتتاحي / تشغيلة', `<div class="grid g2">
    <div class="field"><label>رقم التشغيلة</label><input id="b_no" value="${esc(b?.batch_no || '')}"></div>
    <div class="field"><label>تاريخ الصلاحية (شهر/سنة مثل 2027-03)</label><input id="b_ex" class="ltr" value="${b?.expiry ? esc(b.expiry.slice(0, 7)) : ''}"></div>
    <div class="field"><label>${b ? 'الكمية الفعلية (بعد الجرد)' : 'الكمية (علب)'}</label><input id="b_q" value="${b ? qtyf(b.qty) : ''}"></div>
    <div class="field"><label>سعر التكلفة للعلبة</label><input id="b_c" value="${b ? b.cost : ''}"></div>
    ${b ? '<div class="field" style="grid-column:1/3"><label>سبب التعديل</label><input id="b_r" value="جرد"></div>' : ''}</div><div class="err" id="b_e"></div>`,
    { footer: `<button class="btn" id="b_ok">حفظ</button>${b ? '<button class="btn danger" id="b_del">حذف التشغيلة</button>' : ''}` });
  $('#b_ok', m).onclick = async () => {
    const ex = monthToDate($('#b_ex', m).value); if ($('#b_ex', m).value.trim() && !ex) return ($('#b_e', m).textContent = 'صيغة الصلاحية غلط، اكتبها مثل 2027-03');
    const q = num($('#b_q', m).value), c = num($('#b_c', m).value);
    if (b) {
      await api.tx([{ sql: 'UPDATE batches SET batch_no=?,expiry=?,qty=?,cost=? WHERE id=?', params: [$('#b_no', m).value.trim(), ex, q, c, b.id] },
        { sql: 'INSERT INTO stock_adjustments(date,drug_id,batch_id,old_qty,new_qty,reason,user_id) VALUES(?,?,?,?,?,?,?)', params: [nowISO(), drugId, b.id, b.qty, q, $('#b_r', m).value, App.user.id] }]);
    } else {
      if (q <= 0) return ($('#b_e', m).textContent = 'اكتب كمية أكبر من صفر');
      await api.tx([{ sql: 'INSERT INTO batches(drug_id,batch_no,expiry,qty,cost,created_at) VALUES(?,?,?,?,?,?)', params: [drugId, $('#b_no', m).value.trim(), ex, q, c, nowISO()] },
        { sql: 'INSERT INTO stock_adjustments(date,drug_id,batch_id,old_qty,new_qty,reason,user_id) VALUES(?,?,?,?,?,?,?)', params: [nowISO(), drugId, '@0', 0, q, 'رصيد افتتاحي', App.user.id] }]);
      if (c > 0) await X('UPDATE drugs SET cost=? WHERE id=?', [c, drugId]);
    }
    m.close(); toast('تم الحفظ', 'ok'); done && done(); refreshBadges();
  };
  if (b) $('#b_del', m).onclick = async () => { if (await confirmBox('حذف التشغيلة نهائياً؟', 'حذف', true)) { await X('DELETE FROM batches WHERE id=?', [b.id]); m.close(); done && done(); refreshBadges(); } };
}
