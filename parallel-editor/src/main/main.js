'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { odtToMarkdown, markdownToOdt } = require('./odt');

let win = null;
let dirty = false;
let projectPath = null;

const MD_FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }];
const ODT_FILTERS = [{ name: 'OpenDocument-Text', extensions: ['odt'] }];

function send(cmd, arg) { if (win) win.webContents.send('menu', cmd, arg); }

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, title: 'Parallel Editor',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('close', (e) => {
    if (!dirty) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Abbrechen', 'Verwerfen', 'Speichern'], defaultId: 2, cancelId: 0,
      message: 'Es gibt ungespeicherte Änderungen.', detail: 'Projekt vor dem Schließen speichern?',
    });
    if (choice === 0) e.preventDefault();
    else if (choice === 2) { e.preventDefault(); send('save-and-close'); }
  });
  win.on('closed', () => { win = null; });
}

function buildMenu() {
  const item = (label, cmd, accelerator, arg) => ({ label, accelerator, click: () => send(cmd, arg) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Datei', submenu: [
      item('Original importieren …', 'import', 'CmdOrCtrl+O', 'orig'),
      item('Übersetzung importieren …', 'import', 'CmdOrCtrl+Shift+O', 'trans'),
      { type: 'separator' },
      item('Projekt öffnen …', 'open-project', 'CmdOrCtrl+Alt+O'),
      item('Projekt speichern', 'save', 'CmdOrCtrl+S'),
      item('Projekt speichern unter …', 'save-as', 'CmdOrCtrl+Shift+S'),
      { type: 'separator' },
      { label: 'Exportieren', submenu: [
        item('Übersetzung als Markdown …', 'export', 'CmdOrCtrl+E', { side: 'trans', format: 'md' }),
        item('Übersetzung als ODT …', 'export', 'CmdOrCtrl+Shift+E', { side: 'trans', format: 'odt' }),
        item('Original als Markdown …', 'export', null, { side: 'orig', format: 'md' }),
        item('Original als ODT …', 'export', null, { side: 'orig', format: 'odt' }),
      ] },
      { type: 'separator' },
      { role: 'quit', label: 'Beenden' },
    ] },
    { label: 'Bearbeiten', submenu: [
      item('Zellenänderung rückgängig', 'undo-structure', null),
      item('Zellenänderung wiederholen', 'redo-structure', null),
      { type: 'separator' },
      item('Suchen …', 'find', 'CmdOrCtrl+F'),
      item('Suchen und Ersetzen …', 'replace', 'CmdOrCtrl+H'),
      { type: 'separator' },
      { role: 'cut', label: 'Ausschneiden' }, { role: 'copy', label: 'Kopieren' }, { role: 'paste', label: 'Einfügen' },
    ] },
    { label: 'Ansicht', submenu: [
      { role: 'zoomIn', label: 'Vergrößern' }, { role: 'zoomOut', label: 'Verkleinern' },
      { role: 'resetZoom', label: 'Originalgröße' }, { type: 'separator' },
      { role: 'toggleDevTools', label: 'Entwicklerwerkzeuge' },
    ] },
  ]));
}

function suggestDir() { return projectPath ? path.dirname(projectPath) : app.getPath('documents'); }

ipcMain.handle('import-file', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Datei importieren', defaultPath: suggestDir(),
    filters: [{ name: 'Markdown / OpenDocument', extensions: ['md', 'markdown', 'txt', 'odt'] }, ...MD_FILTERS, ...ODT_FILTERS], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  try {
    const markdown = path.extname(file).toLowerCase() === '.odt'
      ? await odtToMarkdown(fs.readFileSync(file))
      : fs.readFileSync(file, 'utf8');
    return { name: path.basename(file), markdown };
  } catch (err) { return { error: `Import fehlgeschlagen: ${err.message}` }; }
});

ipcMain.handle('open-project', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Projekt öffnen', defaultPath: suggestDir(),
    filters: [{ name: 'Parallel-Editor-Projekt', extensions: ['pep'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  try {
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (!Array.isArray(data.orig) || !Array.isArray(data.trans)) throw new Error('Kein gültiges Projekt.');
    projectPath = r.filePaths[0];
    return { data, name: path.basename(projectPath) };
  } catch (err) { return { error: `Projekt konnte nicht geöffnet werden: ${err.message}` }; }
});

ipcMain.handle('save-project', async (_e, data, saveAs) => {
  let target = projectPath;
  if (!target || saveAs) {
    const r = await dialog.showSaveDialog(win, { title: 'Projekt speichern', defaultPath: path.join(suggestDir(), 'projekt.pep'),
      filters: [{ name: 'Parallel-Editor-Projekt', extensions: ['pep'] }] });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath.endsWith('.pep') ? r.filePath : r.filePath + '.pep';
  }
  try {
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, target);
    projectPath = target;
    return { name: path.basename(target) };
  } catch (err) { return { error: `Speichern fehlgeschlagen: ${err.message}` }; }
});

ipcMain.handle('export-file', async (_e, markdown, suggestedName) => {
  const r = await dialog.showSaveDialog(win, { title: 'Exportieren', defaultPath: path.join(suggestDir(), suggestedName),
    filters: suggestedName.endsWith('.odt') ? ODT_FILTERS : MD_FILTERS });
  if (r.canceled || !r.filePath) return null;
  try {
    if (r.filePath.toLowerCase().endsWith('.odt')) fs.writeFileSync(r.filePath, await markdownToOdt(markdown, path.basename(r.filePath, '.odt')));
    else fs.writeFileSync(r.filePath, markdown);
    return { name: path.basename(r.filePath) };
  } catch (err) { return { error: `Export fehlgeschlagen: ${err.message}` }; }
});

ipcMain.on('set-dirty', (_e, value, name) => {
  dirty = !!value;
  if (win) win.setTitle(`${dirty ? '● ' : ''}${name || 'Unbenannt'} – Parallel Editor`);
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
// Nach "Speichern und Schließen" aus dem Renderer
ipcMain.on('close-now', () => { dirty = false; if (win) win.close(); });
