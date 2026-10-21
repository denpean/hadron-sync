'use strict';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function compileSearch({ query, caseSensitive, regex }) {
  return new RegExp(regex ? query : escapeRe(query), caseSensitive ? 'gu' : 'giu');
}

/** Alle (nicht leeren) Treffer in einem Text. */
export function findInText(text, rx) {
  const re = new RegExp(rx.source, rx.flags);
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    if (m[0] === '') { re.lastIndex++; continue; }
    out.push(m);
  }
  return out;
}

const literal = (rep) => rep.replace(/\$/g, '$$$$');

/** Ersetzt genau den Treffer `range` ({start,end}) im Text. */
export function replaceRange(text, range, rx, rep, isRegex) {
  const single = new RegExp(rx.source, rx.flags.replace('g', ''));
  const matched = text.slice(range.start, range.end);
  const replaced = matched.replace(single, isRegex ? rep : literal(rep));
  return text.slice(0, range.start) + replaced + text.slice(range.end);
}

export function replaceAllIn(text, rx, rep, isRegex) {
  const ms = findInText(text, rx);
  if (!ms.length) return { text, count: 0 };
  const re = new RegExp(rx.source, rx.flags);
  return { text: text.replace(re, isRegex ? rep : literal(rep)), count: ms.length };
}
