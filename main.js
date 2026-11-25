const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

if (process.env.PH_USERDATA) app.setPath('userData', process.env.PH_USERDATA);
// Only one instance: two copies open at once would overwrite each other's data.
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
let SQL, db, win, dbFile, saveTimer = null, dirty = false, recoveredFrom = null;
const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
function getCfg() { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch (e) { return {}; } }
function setCfg(patch) { try { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify({ ...getCfg(), ...patch })); } catch (e) { console.error('config save failed', e); } }
// A database file is usable only if it opens and passes SQLite's own integrity check.
function tryOpen(buf) {
  try {
    const d = new SQL.Database(buf);
    const r = d.exec('PRAGMA integrity_check');
    if (!r.length || r[0].values[0][0] !== 'ok') { d.close(); return null; }
    d.exec('SELECT count(*) FROM drugs'); d.exec('SELECT count(*) FROM users');
    return d;
  } catch (e) { return null; }
}

function seedPath() {
  const p = path.join(process.resourcesPath || '', 'pharmacy.seed.db');
  return fs.existsSync(p) ? p : path.join(__dirname, 'data', 'pharmacy.seed.db');
}
function flush() {
  if (!db || !dirty) return;
  const buf = Buffer.from(db.export());
  const tmp = dbFile + '.tmp';
  fs.writeFileSync(tmp, buf);
  try { fs.renameSync(tmp, dbFile); }
  catch (e) { fs.copyFileSync(tmp, dbFile); try { fs.unlinkSync(tmp); } catch (_) {} } // antivirus can lock the rename on Windows
  dirty = false;
}
// Never throws: after COMMIT the data is already in memory, so a failed disk write must not look like a failed sale (that causes duplicate invoices). Retries until it works.
function safeFlush() {
  try { flush(); } catch (e) { console.error('save failed, retrying', e); clearTimeout(saveTimer); saveTimer = setTimeout(safeFlush, 3000); }
}
function scheduleSave(now) {
  dirty = true;
  clearTimeout(saveTimer);
  if (now) { safeFlush(); return; }
  saveTimer = setTimeout(safeFlush, 700);
}
function autoBackup() {
  try {
    const dir = path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const nd = new Date(), d = `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-${String(nd.getDate()).padStart(2, '0')}`;
    const f = path.join(dir, `pharmacy-${d}.db`);
    if (fs.existsSync(dbFile)) fs.copyFileSync(dbFile, f); // refreshed on start, hourly and on exit, so the day's backup is current
    const prune = (p) => { const files = fs.readdirSync(p).filter((x) => /^pharmacy-\d{4}-\d{2}-\d{2}\.db$/.test(x)).sort(); while (files.length > 14) fs.unlinkSync(path.join(p, files.shift())); };
    prune(dir);
    const ext = getCfg().backupDir; // optional second copy on another drive / USB / synced folder
    if (ext && fs.existsSync(dbFile)) { try { fs.mkdirSync(ext, { recursive: true }); fs.copyFileSync(dbFile, path.join(ext, `pharmacy-${d}.db`)); prune(ext); } catch (e) { console.error('external backup failed', e); } }
  } catch (e) { console.error('backup failed', e); }
}
function all(sql, params = []) {
  const st = db.prepare(sql);
  try { st.bind(params); const rows = []; while (st.step()) rows.push(st.getAsObject()); return rows; }
  finally { st.free(); }
}
function run(sql, params = []) {
  db.run(sql, params);
  const r = db.exec('SELECT last_insert_rowid() AS id, changes() AS n');
  return { id: r[0].values[0][0], changes: r[0].values[0][1] };
}
async function openDb() {
  SQL = await initSqlJs();
  dbFile = path.join(app.getPath('userData'), 'pharmacy.db');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  if (!fs.existsSync(dbFile)) fs.copyFileSync(seedPath(), dbFile);
  db = tryOpen(fs.readFileSync(dbFile));
  if (!db) { // damaged file (power cut, disk error): fall back to the newest healthy automatic backup instead of failing to start
    const dir = path.join(app.getPath('userData'), 'backups');
    const cands = fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.db')).sort().reverse() : [];
    for (const c of cands) { const d = tryOpen(fs.readFileSync(path.join(dir, c))); if (d) { db = d; recoveredFrom = c; break; } }
    if (!db) throw new Error('ملف البيانات تالف ومفيش نسخة احتياطية سليمة. ابعت الملف للدعم: ' + dbFile);
    try { fs.copyFileSync(dbFile, dbFile + '.corrupt-' + Date.now()); } catch (e) {}
    dirty = true; flush();
  }
  db.run('PRAGMA foreign_keys = OFF');
  db.run(fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8')); // creates missing tables only
  migrate();
  autoBackup();
  setInterval(() => { try { flush(); autoBackup(); } catch (e) {} }, 60 * 60 * 1000);
}
// Schema upgrades for future versions: add columns here (CREATE IF NOT EXISTS does not add columns).
function migrate() {
  const has = (t, c) => all(`PRAGMA table_info(${t})`).some((r) => r.name === c);
  const add = (t, c, def) => { if (!has(t, c)) db.run(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };
  add('users', 'failed_count', 'INTEGER NOT NULL DEFAULT 0'); add('users', 'locked_until', 'INTEGER NOT NULL DEFAULT 0');
  add('customers', 'credit_limit', 'REAL NOT NULL DEFAULT 0');
  add('payments', 'method', "TEXT NOT NULL DEFAULT 'drawer'"); // drawer = in/out of the cash drawer, external = card/transfer: excluded from the shift count
  add('payments', 'purchase_id', 'INTEGER'); // drawer payment created by a purchase invoice, so deleting the invoice can reverse it
  scheduleSave(true);
}

ipcMain.handle('db:all', (_e, sql, params) => all(sql, params));
ipcMain.handle('db:run', (_e, sql, params) => { const r = run(sql, params); scheduleSave(); return r; });
// Atomic transaction. ops: [{sql, params}], params may contain "@last" (id of previous insert) or "@N" (id of Nth op).
ipcMain.handle('db:tx', (_e, ops) => {
  const ids = []; let last = null;
  db.run('BEGIN');
  try {
    for (const op of ops) {
      const params = (op.params || []).map((p) => {
        if (p === '@last') return last;
        if (typeof p === 'string' && /^@\d+$/.test(p)) return ids[+p.slice(1)];
        return p;
      });
      const r = run(op.sql, params); ids.push(r.id); if (/^\s*insert/i.test(op.sql)) last = r.id;
    }
    db.run('COMMIT');
  } catch (err) { try { db.run('ROLLBACK'); } catch (_) {} throw err; }
  scheduleSave(true);
  return ids;
});
ipcMain.handle('app:backup', async () => {
  flush();
  const r = await dialog.showSaveDialog(win, { defaultPath: `pharmacy-backup-${new Date().toISOString().slice(0, 10)}.db`, filters: [{ name: 'Database', extensions: ['db'] }] });
  if (r.canceled) return { ok: false };
  fs.copyFileSync(dbFile, r.filePath);
  return { ok: true, path: r.filePath };
});
ipcMain.handle('app:restore', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Database', extensions: ['db'] }] });
  if (r.canceled) return { ok: false };
  const buf = fs.readFileSync(r.filePaths[0]);
  const test = new SQL.Database(buf);
  try { test.exec('SELECT count(*) FROM drugs'); test.exec('SELECT count(*) FROM users'); } catch (e) { return { ok: false, error: 'الملف ده مش نسخة احتياطية صحيحة' }; }
  test.close();
  if (!tryOpen(buf)) return { ok: false, error: 'النسخة دي تالفة (فشل فحص السلامة)' };
  flush(); fs.copyFileSync(dbFile, dbFile + '.before-restore');
  db.close(); db = new SQL.Database(buf); dirty = true; flush();
  db.run(fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8')); migrate();
  return { ok: true };
});
ipcMain.handle('app:info', () => ({ version: app.getVersion(), dbFile, backups: path.join(app.getPath('userData'), 'backups'), backupDir: getCfg().backupDir || '' }));
ipcMain.handle('app:chooseBackupDir', async (_e, clear) => {
  if (clear) { setCfg({ backupDir: '' }); return { ok: true, dir: '' }; }
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  try { fs.accessSync(r.filePaths[0], fs.constants.W_OK); } catch (e) { return { ok: false, error: 'المجلد ده مش قابل للكتابة' }; }
  setCfg({ backupDir: r.filePaths[0] }); autoBackup(); return { ok: true, dir: r.filePaths[0] };
});
ipcMain.handle('app:openBackups', () => shell.openPath(path.join(app.getPath('userData'), 'backups')));
ipcMain.handle('app:print', (_e, silent) => new Promise((res) => { win.webContents.print({ silent: !!silent, printBackground: true }, (ok, why) => res({ ok, why })); }));

function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 820, minWidth: 1024, minHeight: 640, show: false, backgroundColor: '#f4f6f8',
    title: 'نظام الصيدلية', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  if (recoveredFrom) win.webContents.once('did-finish-load', () => dialog.showMessageBox(win, { type: 'warning', message: 'ملف البيانات كان تالف واتسترجعت آخر نسخة احتياطية سليمة (' + recoveredFrom + '). راجع آخر العمليات.', buttons: ['تمام'] }));
}

app.whenReady().then(async () => {
  await openDb();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', () => { clearTimeout(saveTimer); try { flush(); autoBackup(); } catch (e) {} });
app.on('window-all-closed', () => { try { flush(); } catch (e) {} app.quit(); });
