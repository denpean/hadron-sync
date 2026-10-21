'use strict';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';
import { md, splitBlocks, joinBlocks } from '../shared/blocks';
import { compileSearch, findInText, replaceAllIn, replaceRange } from './search';

const $ = (s) => document.querySelector(s);
const rowsEl = $('#rows');
const scroller = $('#scroller');

/* ------------------------------------------------------------------ */
/* Zustand                                                              */
/* ------------------------------------------------------------------ */
let nextId = 1;
const mkCell = (text) => ({ id: nextId++, md: text });

const state = {
  orig: [], trans: [],           // Zellen: { id, md } – werden nie verändert, nur ersetzt
  origName: '', transName: '',
  projectName: '',
  dirty: false,
  active: -1,
};
let undoStack = [];
let redoStack = [];
let editing = null;              // { editor, i, el, changed }
let suspendCommit = false;

const rowCount = () => Math.max(state.orig.length, state.trans.length);
const col = (side) => (side === 'orig' ? state.orig : state.trans);

function normalize() {
  for (const c of [state.orig, state.trans]) while (c.length && !c[c.length - 1].md.trim()) c.pop();
}
function snapshot() { return { orig: state.orig.slice(), trans: state.trans.slice() }; }
function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 300) undoStack.shift(); redoStack = []; }
function markDirty() { state.dirty = true; syncTitle(); }
function syncTitle() { window.api.setDirty(state.dirty, state.projectName || state.transName || state.origName); }

function mutate(fn) {
  commitEdit();
  pushUndo();
  fn();
  normalize();
  markDirty();
  render();
}
function undo() {
  commitEdit();
  const s = undoStack.pop(); if (!s) return;
  redoStack.push(snapshot());
  state.orig = s.orig; state.trans = s.trans; normalize(); markDirty(); render();
}
function redo() {
  commitEdit();
  const s = redoStack.pop(); if (!s) return;
  undoStack.push(snapshot());
  state.orig = s.orig; state.trans = s.trans; normalize(); markDirty(); render();
}

/* ------------------------------------------------------------------ */
/* Darstellung                                                          */
/* ------------------------------------------------------------------ */
function cellHtml(cell, side) {
  if (!cell || !cell.md.trim()) return `<div class="cell ${side} gap" data-side="${side}"><span class="ph">${side === 'trans' ? 'leer – klicken zum Schreiben' : '—'}</span></div>`;
  return `<div class="cell ${side}" data-side="${side}">${md.render(cell.md)}</div>`;
}
function rowHtml(i) {
  return `<div class="row${i === state.active ? ' active' : ''}" data-i="${i}">${cellHtml(state.orig[i], 'orig')}${cellHtml(state.trans[i], 'trans')}</div>`;
}
function render() {
  const top = scroller.scrollTop;
  const n = rowCount();
  if (state.active >= n) state.active = n - 1;
  const parts = new Array(n);
  for (let i = 0; i < n; i++) parts[i] = rowHtml(i);
  rowsEl.innerHTML = parts.join('');
  $('#empty').hidden = n > 0;
  scroller.scrollTop = top;
  $('#headOrig').textContent = 'Original (schreibgeschützt)' + (state.origName ? ' – ' + state.origName : '');
  $('#headTrans').textContent = 'Übersetzung' + (state.transName ? ' – ' + state.transName : '');
  updateStatus();
  if (search.open) refreshSearch(false); else applyHighlights();
}
function cellEl(i, side) { const r = rowsEl.children[i]; return r ? r.querySelector('.cell.' + side) : null; }
function setActive(i) {
  if (i === state.active) return;
  const old = rowsEl.children[state.active]; if (old) old.classList.remove('active');
  state.active = i;
  const r = rowsEl.children[i]; if (r) r.classList.add('active');
  updateStatus();
}
function updateStatus() {
  const o = state.orig.filter((c) => c.md.trim()).length; const t = state.trans.filter((c) => c.md.trim()).length;
  const warn = state.orig.length && state.trans.length && o !== t;
  $('#status').innerHTML = `Zeile ${state.active >= 0 ? state.active + 1 : '–'} / ${rowCount()} · Original: ${o} Absätze · Übersetzung: ${t} Absätze` +
    (warn ? ` · <span class="warn">Absatzzahlen weichen ab – Zuordnung bei Bedarf per Rechtsklick korrigieren</span>` : '') + (state.dirty ? ' · ungespeichert' : '');
}

/* ------------------------------------------------------------------ */
/* WYSIWYG-Bearbeitung der Übersetzung                                  */
/* ------------------------------------------------------------------ */
function startEdit(i, clickPoint) {
  if (editing && editing.i === i) return;
  commitEdit();
  while (state.trans.length <= i) state.trans.push(mkCell(''));
  const el = cellEl(i, 'trans');
  if (!el) return;
  el.classList.remove('gap');
  el.innerHTML = '';
  el.classList.add('editing');
  const editor = new Editor({
    element: el,
    extensions: [
      StarterKit, Link.configure({ openOnClick: false, autolink: false }),
      Table, TableRow, TableHeader, TableCell,
      Markdown.configure({ html: false, tightLists: true, bulletListMarker: '-', linkify: false, breaks: false, transformPastedText: false }),
    ],
    content: state.trans[i].md,
    onUpdate: () => { if (editing) editing.changed = true; },
    onSelectionUpdate: updateFmtState, onTransaction: updateFmtState,
  });
  editing = { editor, i, el, changed: false };
  setActive(i);
  if (clickPoint) {
    const pos = editor.view.posAtCoords({ left: clickPoint.x, top: clickPoint.y });
    if (pos) editor.commands.setTextSelection(pos.pos);
    editor.commands.focus();
  } else editor.commands.focus('end');
  el.addEventListener('focusout', onFocusOut);
  updateFmtState();
}
function onFocusOut(e) {
  if (suspendCommit) return;
  if (editing && e.relatedTarget && editing.el.contains(e.relatedTarget)) return;
  setTimeout(() => { if (!suspendCommit && editing && !editing.el.contains(document.activeElement)) commitEdit(); }, 0);
}
function commitEdit() {
  if (!editing) return;
  const { editor, i, el, changed } = editing;
  editing = null;
  const text = changed ? editor.storage.markdown.getMarkdown().trim() : null;
  el.removeEventListener('focusout', onFocusOut);
  editor.destroy();
  if (changed && text !== (state.trans[i] ? state.trans[i].md : '')) {
    pushUndo();
    state.trans[i] = mkCell(text);
    markDirty();
  }
  const before = rowCount();
  normalize();
  if (rowCount() !== before) render();
  else {
    const row = rowsEl.children[i];
    if (row) { const tmp = document.createElement('div'); tmp.innerHTML = cellHtml(state.trans[i], 'trans'); row.replaceChild(tmp.firstChild, el); }
    updateStatus();
    applyHighlights();
  }
  updateFmtState();
}

const FMT = {
  bold: (c) => c.toggleBold(), italic: (c) => c.toggleItalic(), strike: (c) => c.toggleStrike(),
  h1: (c) => c.toggleHeading({ level: 1 }), h2: (c) => c.toggleHeading({ level: 2 }), h3: (c) => c.toggleHeading({ level: 3 }),
  ul: (c) => c.toggleBulletList(), ol: (c) => c.toggleOrderedList(), quote: (c) => c.toggleBlockquote(),
  code: (c) => c.toggleCodeBlock(), hr: (c) => c.setHorizontalRule(),
};
const FMT_ACTIVE = { bold: 'bold', italic: 'italic', strike: 'strike', ul: 'bulletList', ol: 'orderedList', quote: 'blockquote', code: 'codeBlock', link: 'link' };
function updateFmtState() {
  document.querySelectorAll('#fmtbar [data-fmt]').forEach((b) => {
    const k = b.dataset.fmt;
    let on = false;
    if (editing) {
      if (/^h[123]$/.test(k)) on = editing.editor.isActive('heading', { level: +k[1] });
      else if (FMT_ACTIVE[k]) on = editing.editor.isActive(FMT_ACTIVE[k]);
    }
    b.classList.toggle('on', on);
    b.disabled = !editing;
  });
}
async function applyFormat(k) {
  if (!editing) return;
  const { editor } = editing;
  if (k === 'link') {
    const current = editor.getAttributes('link').href || '';
    suspendCommit = true;
    const url = await askText('Link-Adresse (leer = Link entfernen)', current);
    suspendCommit = false;
    if (url === null) { editor.commands.focus(); return; }
    if (url.trim() === '') editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
    return;
  }
  FMT[k](editor.chain().focus()).run();
}
document.querySelectorAll('#fmtbar [data-fmt]').forEach((b) => {
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', () => applyFormat(b.dataset.fmt));
});

function askText(label, value) {
  const dlg = $('#dlg'); $('#dlgLabel').textContent = label; const input = $('#dlgInput'); input.value = value || '';
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? input.value : null), { once: true });
    dlg.returnValue = 'cancel';
    dlg.showModal(); input.focus(); input.select();
  });
}

/* ------------------------------------------------------------------ */
/* Zuordnung korrigieren (Kontextmenü)                                  */
/* ------------------------------------------------------------------ */
const ctx = $('#ctx');
function showContextMenu(x, y, side, i) {
  const arr = col(side);
  const cell = arr[i];
  const hasCell = !!cell;
  const empty = hasCell && !cell.md.trim();
  const items = [
    { t: side === 'orig' ? 'Original-Spalte (Text bleibt unverändert)' : 'Übersetzungs-Spalte', title: true },
    { t: 'Leere Zelle davor einfügen (diese und folgende rücken nach unten)', ok: i <= arr.length, run: () => mutate(() => { arr.splice(i, 0, mkCell('')); }) },
    { t: 'Leere Zelle entfernen (folgende rücken nach oben)', ok: empty, run: () => mutate(() => { arr.splice(i, 1); }) },
    { t: 'Mit nächster Zelle verbinden', ok: hasCell && i + 1 < arr.length, run: () => mutate(() => { arr.splice(i, 2, mkCell([arr[i].md, arr[i + 1].md].filter((s) => s.trim()).join('\n\n'))); }) },
    { t: 'Mit vorheriger Zelle verbinden', ok: hasCell && i > 0, run: () => mutate(() => { arr.splice(i - 1, 2, mkCell([arr[i - 1].md, arr[i].md].filter((s) => s.trim()).join('\n\n'))); }) },
    { t: 'In einzelne Absätze zerlegen', ok: hasCell && splitBlocks(cell.md).length > 1, run: () => mutate(() => { arr.splice(i, 1, ...splitBlocks(cell.md).map(mkCell)); }) },
  ];
  ctx.innerHTML = '';
  for (const it of items) {
    const d = document.createElement('div'); d.textContent = it.t;
    if (it.title) d.className = 'title'; else if (!it.ok) d.className = 'disabled';
    else d.addEventListener('click', () => { hideContextMenu(); it.run(); });
    ctx.appendChild(d);
  }
  ctx.hidden = false;
  ctx.style.left = Math.min(x, innerWidth - 300) + 'px';
  ctx.style.top = Math.min(y, innerHeight - 230) + 'px';
}
function hideContextMenu() { ctx.hidden = true; }

rowsEl.addEventListener('contextmenu', (e) => {
  const cell = e.target.closest('.cell'); if (!cell) return;
  e.preventDefault();
  const i = +cell.parentElement.dataset.i;
  commitEdit();
  setActive(i);
  showContextMenu(e.clientX, e.clientY, cell.dataset.side, i);
});
document.addEventListener('mousedown', (e) => { if (!ctx.contains(e.target)) hideContextMenu(); });

rowsEl.addEventListener('click', (e) => {
  if (e.target.closest('a')) e.preventDefault();
  const cell = e.target.closest('.cell'); if (!cell) return;
  const i = +cell.parentElement.dataset.i;
  if (cell.dataset.side === 'trans') startEdit(i, { x: e.clientX, y: e.clientY });
  else { commitEdit(); setActive(i); }
});

/* ------------------------------------------------------------------ */
/* Tastatur                                                             */
/* ------------------------------------------------------------------ */
function gotoRow(i, edit) {
  if (i < 0 || i >= rowCount()) return;
  if (edit) startEdit(i); else { commitEdit(); setActive(i); }
  const r = rowsEl.children[i]; if (r) r.scrollIntoView({ block: 'nearest' });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!ctx.hidden) hideContextMenu();
    else if (search.open && document.activeElement.closest('#searchbar')) closeSearch();
    else if (editing) { commitEdit(); }
    return;
  }
  if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && state.active >= -1) {
    e.preventDefault();
    const from = editing ? editing.i : state.active;
    gotoRow(from + (e.key === 'ArrowDown' ? 1 : -1), !!editing || true);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !editing && !document.activeElement.closest('#searchbar, dialog')) {
    if (e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (e.key === 'y') { e.preventDefault(); redo(); }
  }
});

/* ------------------------------------------------------------------ */
/* Suchen & Ersetzen                                                    */
/* ------------------------------------------------------------------ */
const search = { open: false, matches: [], cur: -1, error: '' };
const sq = $('#q'), srep = $('#rep'), sscope = $('#scope'), scs = $('#cs'), sre = $('#re');
function searchOpts() { return { query: sq.value, caseSensitive: scs.checked, regex: sre.checked }; }

function collectMatches() {
  search.matches = []; search.error = '';
  if (!sq.value) return;
  let rx;
  try { rx = compileSearch(searchOpts()); } catch (err) { search.error = 'Ungültiger regulärer Ausdruck'; return; }
  const scope = sscope.value;
  const n = rowCount();
  for (let i = 0; i < n; i++) {
    for (const side of ['orig', 'trans']) {
      if (scope !== 'both' && scope !== side) continue;
      const cell = col(side)[i]; if (!cell) continue;
      findInText(cell.md, rx).forEach((m, k) => search.matches.push({ side, i, k, start: m.index, end: m.index + m[0].length }));
    }
  }
}
function refreshSearch(jump) {
  commitEdit();
  collectMatches();
  if (!search.matches.length) search.cur = -1;
  else if (search.cur < 0 || search.cur >= search.matches.length) search.cur = 0;
  if (jump && search.cur >= 0) showMatch();
  $('#hits').textContent = search.error || (sq.value ? (search.matches.length ? `${search.cur + 1} / ${search.matches.length}` : 'keine Treffer') : '');
  applyHighlights();
}
function showMatch() {
  const m = search.matches[search.cur]; if (!m) return;
  setActive(m.i);
  const r = rowsEl.children[m.i]; if (r) r.scrollIntoView({ block: 'center' });
}
function stepMatch(d) {
  if (!search.matches.length) { refreshSearch(true); return; }
  search.cur = (search.cur + d + search.matches.length) % search.matches.length;
  $('#hits').textContent = `${search.cur + 1} / ${search.matches.length}`;
  showMatch(); applyHighlights();
}
function textRanges(el, rx) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = []; let text = ''; let node;
  while ((node = walker.nextNode())) { nodes.push({ node, start: text.length }); text += node.nodeValue; }
  const locate = (pos, preferEnd) => {
    for (let j = nodes.length - 1; j >= 0; j--) if (pos >= nodes[j].start && (preferEnd ? pos > nodes[j].start || j === 0 : true)) return [nodes[j].node, pos - nodes[j].start];
    return [nodes[0].node, 0];
  };
  if (!nodes.length) return [];
  return findInText(text, rx).map((m) => {
    const r = new Range(); const [sn, so] = locate(m.index, false); const [en, eo] = locate(m.index + m[0].length, true);
    r.setStart(sn, so); r.setEnd(en, eo); return r;
  });
}
function applyHighlights() {
  if (!window.CSS || !CSS.highlights) return;
  CSS.highlights.delete('hit'); CSS.highlights.delete('hit-cur');
  if (!search.open || !search.matches.length) return;
  let rx; try { rx = compileSearch(searchOpts()); } catch { return; }
  const hits = [], cur = [];
  const groups = new Map();
  search.matches.forEach((m, idx) => { const key = m.side + ':' + m.i; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(idx); });
  if (groups.size > 3000) return;
  for (const [key, idxs] of groups) {
    const [side, i] = key.split(':'); const el = cellEl(+i, side); if (!el || el.classList.contains('editing')) continue;
    const ranges = textRanges(el, rx);
    ranges.forEach((r, k) => { (idxs[k] === search.cur ? cur : hits).push(r); });
  }
  CSS.highlights.set('hit', new Highlight(...hits));
  CSS.highlights.set('hit-cur', new Highlight(...cur));
}
function openSearch(withReplace) {
  search.open = true; $('#searchbar').hidden = false;
  srep.style.display = sq.style.display = ''; 
  const sel = String(window.getSelection() || '').trim();
  if (sel && !sel.includes('\n')) sq.value = sel;
  (withReplace ? sq : sq).focus(); sq.select();
  refreshSearch(true);
}
function closeSearch() { search.open = false; $('#searchbar').hidden = true; applyHighlights(); }
function replaceCurrent() {
  const m = search.matches[search.cur]; if (!m) return;
  if (m.side !== 'trans') { $('#hits').textContent = 'Original ist schreibgeschützt'; stepMatch(1); return; }
  const rx = compileSearch(searchOpts());
  const keep = search.cur;
  mutate(() => { state.trans[m.i] = mkCell(replaceRange(state.trans[m.i].md, m, rx, srep.value, sre.checked)); });
  collectMatches();
  search.cur = Math.min(keep, search.matches.length - 1);
  while (search.cur >= 0 && search.matches[search.cur].side !== 'trans' && sscope.value === 'both') { if (++search.cur >= search.matches.length) { search.cur = search.matches.length - 1; break; } }
  $('#hits').textContent = search.matches.length ? `${search.cur + 1} / ${search.matches.length}` : 'keine Treffer';
  if (search.cur >= 0) showMatch();
  applyHighlights();
}
function replaceAll() {
  if (!sq.value) return;
  let rx; try { rx = compileSearch(searchOpts()); } catch { return; }
  let count = 0;
  mutate(() => {
    state.trans = state.trans.map((c) => {
      const res = replaceAllIn(c.md, rx, srep.value, sre.checked);
      if (res.count) { count += res.count; return mkCell(res.text); }
      return c;
    });
  });
  refreshSearch(false);
  $('#hits').textContent = `${count} Ersetzung(en) in der Übersetzung`;
}
sq.addEventListener('input', () => { search.cur = -1; refreshSearch(true); });
[sscope, scs, sre].forEach((el) => el.addEventListener('change', () => { search.cur = -1; refreshSearch(true); }));
sq.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); stepMatch(e.shiftKey ? -1 : 1); } });
srep.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); replaceCurrent(); } });
$('#next').addEventListener('click', () => stepMatch(1));
$('#prev').addEventListener('click', () => stepMatch(-1));
$('#replace1').addEventListener('click', replaceCurrent);
$('#replaceAll').addEventListener('click', replaceAll);
$('#closeSearch').addEventListener('click', closeSearch);

/* ------------------------------------------------------------------ */
/* Import / Export / Projekt                                            */
/* ------------------------------------------------------------------ */
function alertMsg(msg) { $('#status').textContent = msg; }

async function importSide(side) {
  commitEdit();
  const res = await window.api.importFile();
  if (!res) return;
  if (res.error) { alert(res.error); return; }
  const arr = col(side);
  if (arr.some((c) => c.md.trim()) && !confirm(`Vorhandene ${side === 'orig' ? 'Original' : 'Übersetzungs'}-Absätze (inkl. Zuordnung) werden ersetzt. Fortfahren?`)) return;
  pushUndo();
  const cells = splitBlocks(res.markdown).map(mkCell);
  if (side === 'orig') { state.orig = cells; state.origName = res.name; } else { state.trans = cells; state.transName = res.name; }
  state.active = cells.length ? 0 : -1;
  markDirty(); render();
}

function projectData() {
  return { version: 1, orig: state.orig.map((c) => c.md), trans: state.trans.map((c) => c.md), origName: state.origName, transName: state.transName };
}
async function save(saveAs) {
  commitEdit();
  const res = await window.api.saveProject(projectData(), !!saveAs);
  if (!res) return false;
  if (res.error) { alert(res.error); return false; }
  state.projectName = res.name; state.dirty = false; syncTitle(); updateStatus();
  return true;
}
async function openProject() {
  commitEdit();
  if (state.dirty && !confirm('Ungespeicherte Änderungen verwerfen und anderes Projekt öffnen?')) return;
  const res = await window.api.openProject();
  if (!res) return;
  if (res.error) { alert(res.error); return; }
  const d = res.data;
  state.orig = d.orig.map(mkCell); state.trans = d.trans.map(mkCell);
  state.origName = d.origName || ''; state.transName = d.transName || ''; state.projectName = res.name;
  undoStack = []; redoStack = []; state.active = rowCount() ? 0 : -1; state.dirty = false;
  syncTitle(); render();
}
async function exportSide({ side, format }) {
  commitEdit();
  const arr = col(side);
  if (!arr.some((c) => c.md.trim())) { alert('Diese Seite enthält keinen Text.'); return; }
  const base = ((side === 'orig' ? state.origName : state.transName) || (side === 'orig' ? 'original' : 'uebersetzung')).replace(/\.[^.]+$/, '');
  const name = side === 'trans' && !state.transName ? 'uebersetzung' : base;
  const res = await window.api.exportFile(joinBlocks(arr.map((c) => c.md)), `${name}.${format}`);
  if (!res) return;
  if (res.error) alert(res.error); else alertMsg(`Exportiert: ${res.name}`);
}

const COMMANDS = {
  'import-orig': () => importSide('orig'), 'import-trans': () => importSide('trans'),
  save: () => save(false), 'save-as': () => save(true),
  'export-md': () => exportSide({ side: 'trans', format: 'md' }), 'export-odt': () => exportSide({ side: 'trans', format: 'odt' }),
  find: () => openSearch(false), undo, redo,
};
document.querySelectorAll('#toolbar [data-cmd]').forEach((b) => {
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', () => COMMANDS[b.dataset.cmd]());
});

window.api.onMenu(async (cmd, arg) => {
  switch (cmd) {
    case 'import': return importSide(arg);
    case 'open-project': return openProject();
    case 'save': return save(false);
    case 'save-as': return save(true);
    case 'export': return exportSide(arg);
    case 'undo-structure': return undo();
    case 'redo-structure': return redo();
    case 'find': return openSearch(false);
    case 'replace': return openSearch(true);
    case 'save-and-close': if (await save(false)) window.api.closeNow(); return undefined;
    default: return undefined;
  }
});

/* Testzugriff für automatisierte Prüfung */
window.__pe = { editing: () => editing, state, render, mkCell, startEdit, commitEdit, openSearch, refreshSearch, search };

updateFmtState();
syncTitle();
render();
