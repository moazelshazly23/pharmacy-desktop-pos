'use strict';
// قواعد تنبيه التفاعلات الدوائية الشائعة (للاستئناس فقط، المراجعة النهائية للصيدلي).
const NSAIDS = ['ibuprofen', 'diclofenac', 'naproxen', 'ketorolac', 'meloxicam', 'piroxicam', 'celecoxib', 'indomethacin', 'etoricoxib', 'ketoprofen', 'lornoxicam', 'nimesulide', 'aspirin', 'acetylsalicylic'];
const NITRATES = ['isosorbide', 'nitroglycerin', 'glyceryl trinitrate', 'nicorandil'];
const PDE5 = ['sildenafil', 'tadalafil', 'vardenafil'];
const STATINS = ['simvastatin', 'atorvastatin', 'lovastatin'];
const MACROLIDES = ['clarithromycin', 'erythromycin'];
const ACE_ARB = ['lisinopril', 'enalapril', 'captopril', 'perindopril', 'ramipril', 'losartan', 'valsartan', 'candesartan', 'irbesartan', 'telmisartan', 'olmesartan', 'benazepril'];
const K_SPARING = ['spironolactone', 'amiloride', 'eplerenone', 'triamterene', 'potassium'];
const QUINOLONES = ['ciprofloxacin', 'levofloxacin', 'moxifloxacin', 'ofloxacin'];
const CATIONS = ['aluminium', 'aluminum', 'magnesium', 'calcium', 'ferrous', 'iron', 'zinc'];
const SSRI = ['sertraline', 'fluoxetine', 'paroxetine', 'citalopram', 'escitalopram', 'fluvoxamine'];
const BETA = ['propranolol', 'atenolol', 'bisoprolol', 'metoprolol', 'carvedilol', 'nebivolol'];
const CCB_RATE = ['verapamil', 'diltiazem'];
const AZOLES = ['fluconazole', 'ketoconazole', 'itraconazole', 'voriconazole'];
const PPI = ['omeprazole', 'esomeprazole'];
const RULES = [
  { a: ['warfarin'], b: NSAIDS, lvl: 'danger', msg: 'وارفارين مع مضاد التهاب/أسبرين: خطر نزيف مرتفع' },
  { a: ['warfarin'], b: ['metronidazole', ...AZOLES, 'amiodarone'], lvl: 'danger', msg: 'يزيد تأثير الوارفارين ويرفع خطر النزيف، لازم متابعة INR' },
  { a: PDE5, b: NITRATES, lvl: 'danger', msg: 'ممنوع: هبوط حاد وخطير في الضغط (فياجرا/سيالس مع النيترات)' },
  { a: MACROLIDES, b: STATINS, lvl: 'danger', msg: 'خطر التهاب وتحلل في العضلات، يفضل وقف الستاتين أثناء المضاد الحيوي' },
  { a: AZOLES, b: ['simvastatin', 'lovastatin'], lvl: 'danger', msg: 'خطر تحلل العضلات' },
  { a: ACE_ARB, b: K_SPARING, lvl: 'warn', msg: 'خطر ارتفاع البوتاسيوم في الدم' },
  { a: QUINOLONES, b: CATIONS, lvl: 'warn', msg: 'المضاد الحيوي بيقل امتصاصه مع الأملاح والمعادن، افصل بينهم ساعتين على الأقل' },
  { a: ['methotrexate'], b: [...NSAIDS, 'trimethoprim', 'sulfamethoxazole'], lvl: 'danger', msg: 'يرفع سمّية الميثوتريكسات' },
  { a: ['digoxin'], b: ['amiodarone', 'verapamil', 'clarithromycin', 'erythromycin'], lvl: 'danger', msg: 'يرفع مستوى الديجوكسين في الدم' },
  { a: ['tramadol'], b: SSRI, lvl: 'danger', msg: 'خطر تشنجات ومتلازمة السيروتونين' },
  { a: BETA, b: CCB_RATE, lvl: 'warn', msg: 'خطر بطء شديد في القلب وهبوط الضغط' },
  { a: ['clopidogrel'], b: PPI, lvl: 'warn', msg: 'الأوميبرازول/الإيزوميبرازول ممكن يقلل مفعول كلوبيدوجريل' },
  { a: ['lithium'], b: [...NSAIDS, ...ACE_ARB], lvl: 'danger', msg: 'يرفع مستوى الليثيوم ويزود السمّية' },
  { a: ['theophylline'], b: QUINOLONES, lvl: 'warn', msg: 'يرفع مستوى الثيوفيلين' },
  { a: ['allopurinol'], b: ['azathioprine', 'mercaptopurine'], lvl: 'danger', msg: 'يرفع سمّية الدواء ويضعف النخاع العظمي' },
  { a: ['isotretinoin'], b: ['tetracycline', 'doxycycline', 'minocycline'], lvl: 'warn', msg: 'خطر ارتفاع الضغط داخل الجمجمة' },
];
const has = (active, list) => list.some((x) => active.includes(x));
// items: [{id, name, active}] => [{lvl,msg,names}]
function checkInteractions(items) {
  const out = [], seen = new Set();
  const push = (lvl, msg, n1, n2) => { const k = msg + n1 + n2; if (!seen.has(k)) { seen.add(k); out.push({ lvl, msg, names: `${n1} + ${n2}` }); } };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const A = items[i], B = items[j];
      const a = String(A.active || '').toLowerCase(), b = String(B.active || '').toLowerCase();
      if (!a || !b) continue;
      for (const r of RULES) {
        if ((has(a, r.a) && has(b, r.b)) || (has(b, r.a) && has(a, r.b))) push(r.lvl, r.msg, A.name, B.name);
      }
      if (has(a, NSAIDS) && has(b, NSAIDS) && !(a.includes('aspirin') !== b.includes('aspirin') && false)) push('warn', 'مضادين التهاب مع بعض: زيادة خطر قرحة ونزيف المعدة والكلى', A.name, B.name);
      if (a === b) push('info', 'نفس المادة الفعالة مكررة: انتبه لتكرار الجرعة', A.name, B.name);
      else {
        const sa = new Set(a.split('+').map((x) => x.trim())), sb = b.split('+').map((x) => x.trim());
        const common = sb.filter((x) => sa.has(x) && x);
        if (common.length) push('info', `مادة فعالة مشتركة (${common.join(', ')}): انتبه لتكرار الجرعة`, A.name, B.name);
      }
    }
  }
  return out;
}
