// Builds data/pharmacy.seed.db : schema + Egyptian drug catalog (27k+ items incl. cosmetics, with barcodes)
// Source: https://github.com/mahmoudfalous/eg-drugs (CC BY 4.0). Falls back to data/eg_drugs.csv if present.
const fs = require('fs');
const path = require('path');
const https = require('https');
const initSqlJs = require('sql.js');
const URL = 'https://raw.githubusercontent.com/mahmoudfalous/eg-drugs/main/data/eg_drugs.csv';
const root = path.join(__dirname, '..');
const csvPath = path.join(root, 'data', 'eg_drugs.csv');

function get(url, n = 0) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'pharmacy-system' } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && n < 5) return res(get(r.headers.location, n + 1));
      if (r.statusCode !== 200) return rej(new Error('HTTP ' + r.statusCode));
      const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => res(Buffer.concat(chunks)));
    }).on('error', rej);
  });
}
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const norm = (s) => String(s || '').toLowerCase()
  .replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/\s+/g, ' ').trim();
const COSMETIC = /skin|hair|sun block|sunblock|oral care|massage|vaginal care|whitening|moisturiz|shampoo|soap|deodorant|lotion|cosmetic|anti-acne|baby care|lip|nail|toothpaste|mouth wash|makeup|perfume/i;

(async () => {
  let csv;
  if (fs.existsSync(csvPath)) csv = fs.readFileSync(csvPath, 'utf8');
  else { console.log('downloading catalog...'); csv = (await get(URL)).toString('utf8'); }
  const rows = parseCSV(csv.replace(/^\uFEFF/, ''));
  const head = rows.shift(); const ix = {}; head.forEach((h, i) => (ix[h.trim()] = i));
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(fs.readFileSync(path.join(root, 'db', 'schema.sql'), 'utf8'));
  db.run('BEGIN');
  const st = db.prepare('INSERT INTO drugs (name,arabic,active,company,price,old_price,barcode,units,category,uses,kind,search) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  let n = 0, withBarcode = 0;
  for (const r of rows) {
    if (r.length < 5) continue;
    const g = (k) => (r[ix[k]] || '').trim();
    const name = g('name'), arabic = g('arabic');
    if (!name && !arabic) continue;
    const bc = g('barcode_valid') === '1' ? g('barcode') : '';
    if (bc) withBarcode++;
    const cat = g('description');
    const kind = COSMETIC.test(cat) ? 'cosmetic' : 'drug';
    const price = parseFloat(g('price')) || 0, old = parseFloat(g('oldprice'));
    st.run([name, arabic, g('active'), g('company'), price, isNaN(old) ? null : old, bc || null,
      parseInt(g('units')) || null, cat, g('uses'), kind, norm([arabic, name, g('active'), bc, g('company')].join(' '))]);
    n++;
  }
  st.free();
  // default settings + admin user (PIN 1234, must change on first login)
  const hash = (pin) => { let h = 5381; const s = 'ph1:' + pin; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(16); };
  db.run("INSERT INTO users (name,pin_hash,role,must_change) VALUES ('المدير',?, 'admin', 1)", [hash('1234')]);
  const defs = { pharmacy_name: 'صيدليتي', address: '', phone: '', receipt_footer: 'شكراً لزيارتكم، مع تمنياتنا بالشفاء العاجل', expiry_days: '90', allow_negative: '1', currency: 'ج.م', theme: 'light' };
  for (const [k, v] of Object.entries(defs)) db.run('INSERT INTO settings VALUES (?,?)', [k, v]);
  db.run('COMMIT');
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'pharmacy.seed.db'), Buffer.from(db.export()));
  console.log(`seed db built: ${n} items (${withBarcode} with barcode)`);
})().catch((e) => { console.error(e); process.exit(1); });
