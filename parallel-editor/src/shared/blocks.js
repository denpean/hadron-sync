'use strict';
const MarkdownIt = require('markdown-it');

const md = new MarkdownIt({ html: false, linkify: false });

/**
 * Zerlegt Markdown in Top-Level-Blöcke (Absatz, Überschrift, Liste, Zitat,
 * Codeblock, Tabelle ...). Rückgabe: Array von Markdown-Strings (Quelltext).
 */
function splitBlocks(source) {
  const text = String(source).replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const tokens = md.parse(text, {});
  const blocks = [];
  for (const t of tokens) {
    if (t.level !== 0 || !t.map || t.nesting === -1) continue;
    const chunk = lines.slice(t.map[0], t.map[1]).join('\n').replace(/\s+$/, '');
    if (chunk.trim()) blocks.push(chunk);
  }
  return blocks;
}

/** Fügt Zellen wieder zu einem Markdown-Dokument zusammen (leere Zellen entfallen). */
function joinBlocks(cells) {
  return cells.filter((c) => c && c.trim()).map((c) => c.replace(/\s+$/, '')).join('\n\n') + '\n';
}

module.exports = { splitBlocks, joinBlocks, md };
