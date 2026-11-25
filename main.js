const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

if (process.env.PH_USERDATA) app.setPath('userData', process.env.PH_USERDATA);
// Only one instance: two copies open at once would overwrite each other's data.
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
let SQL, db, win, dbFile, saveTimer = null, dirty = false;

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
    const d = new Date().toISOString().slice(0, 10);
    const f = path.join(dir, `pharmacy-${d}.db`);
    if (fs.existsSync(dbFile)) fs.copyFileSync(dbFile, f); // refreshed on start, hourly and on exit, so the day's backup is current
    const files = fs.readdirSync(dir).filter((x) => x.endsWith('.db')).sort();
    while (files.length > 14) fs.unlinkSync(path.join(dir, files.shift()));
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
  db = new SQL.Database(fs.readFileSync(dbFile));
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
  flush(); fs.copyFileSync(dbFile, dbFile + '.before-restore');
  db.close(); db = new SQL.Database(buf); dirty = true; flush();
  db.run(fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8'));
  return { ok: true };
});
ipcMain.handle('app:info', () => ({ version: app.getVersion(), dbFile, backups: path.join(app.getPath('userData'), 'backups') }));
ipcMain.handle('app:openBackups', () => shell.openPath(path.join(app.getPath('userData'), 'backups')));
ipcMain.handle('app:print', async () => { win.webContents.print({ silent: false, printBackground: true }); return true; });

function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 820, minWidth: 1024, minHeight: 640, show: false, backgroundColor: '#f4f6f8',
    title: 'نظام الصيدلية', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(async () => {
  await openDb();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', () => { clearTimeout(saveTimer); try { flush(); autoBackup(); } catch (e) {} });
app.on('window-all-closed', () => { try { flush(); } catch (e) {} app.quit(); });
