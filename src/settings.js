'use strict';
Views.settings = async (el) => {
  el.style.padding = '18px 22px';
  const S = App.settings, users = await Q('SELECT * FROM users ORDER BY id'), info = await api.info();
  const cnt = await Q1('SELECT COUNT(*) c FROM drugs');
  el.innerHTML = `<div class="grid g2"><div class="card"><b style="font-size:16px">بيانات الصيدلية والفاتورة</b><div class="grid g2 mt">
    <div class="field"><label>اسم الصيدلية</label><input id="s_name" value="${esc(S.pharmacy_name)}"></div><div class="field"><label>التليفون</label><input id="s_ph" value="${esc(S.phone)}"></div>
    <div class="field" style="grid-column:1/3"><label>العنوان</label><input id="s_ad" value="${esc(S.address)}"></div><div class="field" style="grid-column:1/3"><label>تذييل الفاتورة</label><input id="s_ft" value="${esc(S.receipt_footer)}"></div>
    <div class="field"><label>تنبيه الصلاحية قبل (يوم)</label><input id="s_ex" value="${esc(S.expiry_days)}"></div><div class="field"><label>الشكل</label><select id="s_th"><option value="light">فاتح</option><option value="dark">داكن</option></select></div>
    <div class="field"><label>قفل الشاشة تلقائياً بعد (دقيقة، 0 = إيقاف)</label><input id="s_idle" value="${esc(S.idle_lock ?? '10')}"></div><label class="row" style="grid-column:1/3"><input type="checkbox" id="s_neg" ${S.allow_negative !== '0' ? 'checked' : ''}> السماح بالبيع حتى لو الرصيد غير كافٍ (مفيد وقت إدخال الأرصدة)</label></div><button class="btn mt" data-act="set-save">💾 حفظ الإعدادات</button></div>
   <div class="card"><b style="font-size:16px">النسخ الاحتياطي</b><p class="mute small">النظام بيعمل نسخة احتياطية تلقائية يومياً (آخر 14 يوم) في:<br><span class="ltr">${esc(info.backups)}</span></p>
    <div class="row"><button class="btn" data-act="set-backup">⬇ حفظ نسخة احتياطية الآن</button><button class="btn sec" data-act="set-restore">⬆ استرجاع نسخة</button><button class="btn sec" data-act="set-open-bk">فتح مجلد النسخ</button></div>
    <p class="small mute mt">الإصدار ${esc(info.version)} · قاعدة الأدوية: ${cnt.c.toLocaleString('en-US')} صنف<br>بيانات الأدوية: <span class="ltr">github.com/mahmoudfalous/eg-drugs</span> (رخصة CC BY 4.0). الأسعار مرجعية وممكن تتغير، راجع أسعار الجمهور الرسمية.</p></div></div>
   <div class="card mt"><div class="row mb"><b style="font-size:16px">المستخدمين والصلاحيات</b><span class="grow"></span><button class="btn" data-act="user-new">+ مستخدم</button></div>${table([{ h: 'الاسم', f: (u) => esc(u.name) }, { h: 'الصلاحية', f: (u) => ROLE_NAMES[u.role] }, { h: 'الحالة', f: (u) => (u.active ? '<span class="pill">نشط</span>' : '<span class="pill gray">موقوف</span>') }, { h: '', f: (u) => `<button class="btn sec sm" data-act="user-edit" data-id="${u.id}">تعديل / تغيير الرقم السري</button>` }], users)}
    <div class="small mute mt">مدير: كل شيء · صيدلي: المبيعات والمخزون والمشتريات والتقارير · كاشير: المبيعات والعملاء والمرتجعات والوردية فقط.</div></div>`;
  const log = await Q('SELECT * FROM audit_log ORDER BY id DESC LIMIT 150');
  el.insertAdjacentHTML('beforeend', `<div class="card mt"><div class="row mb"><b style="font-size:16px">سجل العمليات (آخر 150)</b><span class="grow"></span><button class="btn sec sm" data-act="audit-csv">تصدير CSV</button></div>${table([{ h: 'الوقت', f: (a) => ftime(a.ts) }, { h: 'المستخدم', f: (a) => esc(a.user_name) }, { h: 'العملية', f: (a) => esc(a.action) }, { h: 'تفاصيل', f: (a) => esc(a.detail) }], log, { empty: 'السجل فاضي', maxh: '320px' })}</div>`);
  $('#s_th').value = S.theme || 'light';
};
ACT['set-save'] = async () => {
  const v = (s) => $(s).value.trim();
  await setSetting('pharmacy_name', v('#s_name') || 'صيدليتي'); await setSetting('phone', v('#s_ph')); await setSetting('address', v('#s_ad')); await setSetting('receipt_footer', v('#s_ft'));
  await setSetting('expiry_days', Math.max(1, num(v('#s_ex')) || 90)); await setSetting('theme', $('#s_th').value); await setSetting('idle_lock', Math.max(0, num(v('#s_idle')))); await audit('تعديل الإعدادات'); await setSetting('allow_negative', $('#s_neg').checked ? '1' : '0');
  document.documentElement.dataset.theme = App.settings.theme === 'dark' ? 'dark' : 'light'; toast('تم حفظ الإعدادات', 'ok'); renderShell(); go('settings');
};
ACT['set-backup'] = async () => { const r = await api.backup(); if (r.ok) await audit('نسخة احتياطية يدوية'); if (r.ok) toast('تم حفظ النسخة الاحتياطية', 'ok'); };
ACT['set-open-bk'] = () => api.openBackups();
ACT['set-restore'] = async () => {
  if (!(await confirmBox('استرجاع نسخة هيستبدل كل البيانات الحالية بالنسخة المختارة (بتتحفظ نسخة من الحالي تلقائي). متابعة؟', 'استرجاع', true))) return;
  const r = await api.restore(); if (r.ok) { await audit('استرجاع نسخة احتياطية'); toast('تم الاسترجاع. سجّل الدخول من جديد', 'ok'); await loadSettings(); logout(); } else if (r.error) toast(r.error, 'err');
};
async function userForm(u) {
  const m = modal(u ? 'تعديل مستخدم' : 'مستخدم جديد', `<div class="grid g2"><div class="field"><label>الاسم</label><input id="u_n" value="${esc(u?.name || '')}"></div><div class="field"><label>الصلاحية</label><select id="u_r"><option value="cashier">كاشير</option><option value="pharmacist">صيدلي</option><option value="admin">مدير</option></select></div>
   <div class="field"><label>${u ? 'رقم سري جديد (اتركه فاضي لو مش هتغيره)' : 'الرقم السري'}</label><input id="u_p" type="password" inputmode="numeric"></div>${u ? '<label class="row"><input type="checkbox" id="u_a" ' + (u.active ? 'checked' : '') + '> نشط</label><label class="row"><input type="checkbox" id="u_ul"> فتح الحساب لو مقفول بعد محاولات غلط</label>' : ''}</div><div class="err" id="u_e"></div>`, { footer: '<button class="btn" id="u_ok">حفظ</button>' });
  $('#u_r', m).value = u?.role || 'cashier';
  $('#u_ok', m).onclick = async () => {
    const n = $('#u_n', m).value.trim(), p = $('#u_p', m).value; if (!n) return ($('#u_e', m).textContent = 'اكتب الاسم');
    if ((!u || p) && weakPin(p)) return ($('#u_e', m).textContent = WEAK_MSG);
    try {
      if (u) {
        if (u.id === App.user.id && (!$('#u_a', m).checked || $('#u_r', m).value !== 'admin')) return ($('#u_e', m).textContent = 'مينفعش توقف أو تنزّل صلاحية حسابك الحالي');
        const admins = await Q1("SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1");
        if (u.role === 'admin' && u.active && admins.c <= 1 && ($('#u_r', m).value !== 'admin' || !$('#u_a', m).checked)) return ($('#u_e', m).textContent = 'مينفعش تشيل صلاحية أو توقف آخر مدير نشط في النظام');
        await X('UPDATE users SET name=?, role=?, active=? WHERE id=?', [n, $('#u_r', m).value, $('#u_a', m).checked ? 1 : 0, u.id]);
        if (p) await X('UPDATE users SET pin_hash=?, must_change=0 WHERE id=?', [await hashPin(p), u.id]);
        if ($('#u_ul', m)?.checked) await X('UPDATE users SET failed_count=0, locked_until=0 WHERE id=?', [u.id]);
        await audit('تعديل مستخدم', `${n} (${$('#u_r', m).value})${p ? ' - تغيير رقم سري' : ''}`);
      } else { await X('INSERT INTO users(name,pin_hash,role) VALUES(?,?,?)', [n, await hashPin(p), $('#u_r', m).value]); await audit('مستخدم جديد', `${n} (${$('#u_r', m).value})`); }
      m.close(); go('settings');
    } catch (e) { $('#u_e', m).textContent = 'الاسم مستخدم قبل كده'; }
  };
}
ACT['user-new'] = () => userForm(null);
ACT['user-edit'] = async (el) => userForm(await Q1('SELECT * FROM users WHERE id=?', [el.dataset.id]));
ACT['audit-csv'] = async () => { const r = await Q('SELECT ts,user_name,action,detail FROM audit_log ORDER BY id DESC'); downloadCSV('audit-log.csv', ['الوقت', 'المستخدم', 'العملية', 'تفاصيل'], r.map((a) => [a.ts, a.user_name, a.action, a.detail])); };
