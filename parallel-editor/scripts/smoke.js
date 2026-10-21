'use strict';
// Rauchtest unter Xvfb:  xvfb-run -a npx electron scripts/smoke.js --no-sandbox
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const out = process.env.SMOKE_OUT || '/tmp/smoke.png';
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1300, height: 800, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'), contextIsolation: true } });
  const errors = [];
  win.webContents.on('preload-error', (_e, _p, err) => errors.push(String(err)));
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) errors.push(msg); });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  const run = (code) => win.webContents.executeJavaScript(code);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const result = await run(`(async () => {
    const pe = window.__pe; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const long = 'Dies ist ein sehr langer Absatz, der mehrere Zeilen einnimmt. '.repeat(12);
    pe.state.orig = [ '# Titel', long, 'Kurz.', '- a\\n- b' ].map(pe.mkCell);
    pe.state.trans = [ '# Title', 'Short.', long, 'Mid.' ].map(pe.mkCell);
    pe.state.active = 1; pe.render();
    const log = {};
    const rows = [...document.querySelectorAll('.row')];
    log.rows = rows.length;
    log.sameHeight = rows.every((r) => { const c = r.querySelectorAll('.cell'); return Math.abs(c[0].getBoundingClientRect().height - c[1].getBoundingClientRect().height) < 1 && Math.abs(c[0].getBoundingClientRect().top - c[1].getBoundingClientRect().top) < 1; });
    log.activeBoth = [...rows[1].querySelectorAll('.cell')].map((c) => getComputedStyle(c).backgroundImage !== 'none');
    // Bearbeiten
    pe.startEdit(1);
    await wait(100);
    log.editing = !!document.querySelector('.cell.editing .ProseMirror');
    log.origEditable = !!document.querySelector('.cell.orig [contenteditable=true]');
    const ed = document.querySelector('.cell.editing .ProseMirror');
    window.addEventListener('error', (e) => { window.__err = e.error && e.error.stack; });
    pe.editing().editor.chain().focus('end').insertContent(' neu').run();
    await wait(100);
    pe.commitEdit();
    log.afterEdit = pe.state.trans[1].md; log.err = window.__err;
    // Suche
    pe.openSearch(false);
    const q = document.querySelector('#q'); q.value = 'Short'; q.dispatchEvent(new Event('input'));
    await wait(100);
    log.hits = document.querySelector('#hits').textContent;
    document.querySelector('#rep').value = 'Kurz';
    document.querySelector('#replace1').click();
    await wait(100);
    log.afterReplace = pe.state.trans[1].md;
    return log;
  })()`);
  await wait(300);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
  console.log(JSON.stringify({ result, errors }, null, 1));
  app.quit();
});
