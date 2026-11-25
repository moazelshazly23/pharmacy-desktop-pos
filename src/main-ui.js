'use strict';
(async function boot() {
  try { await loadSettings(); renderLogin(); }
  catch (e) { document.body.innerHTML = '<pre style="padding:20px">فشل تشغيل البرنامج: ' + esc(e.message) + '</pre>'; }
})();
