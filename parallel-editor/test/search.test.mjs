import test from 'node:test';
import assert from 'node:assert';
import { compileSearch, findInText, replaceRange, replaceAllIn } from '../src/renderer/search.js';

test('Suche: Groß/Klein und Regex', () => {
  assert.strictEqual(findInText('Haus haus HAUS', compileSearch({ query: 'haus', caseSensitive: false, regex: false })).length, 3);
  assert.strictEqual(findInText('Haus haus HAUS', compileSearch({ query: 'haus', caseSensitive: true, regex: false })).length, 1);
  assert.strictEqual(findInText('a1 b22', compileSearch({ query: '\\d+', caseSensitive: false, regex: true })).length, 2);
  assert.strictEqual(findInText('a.b', compileSearch({ query: '.', caseSensitive: false, regex: false })).length, 1);
});

test('Ersetzen: Platzhalter nur im Regex-Modus', () => {
  const lit = compileSearch({ query: 'a', caseSensitive: false, regex: false });
  assert.strictEqual(replaceAllIn('aa', lit, '$&x', false).text, '$&x$&x');
  const re = compileSearch({ query: '(\\w)(\\d)', caseSensitive: false, regex: true });
  assert.strictEqual(replaceAllIn('a1 b2', re, '$2$1', true).text, '1a 2b');
  const xx = compileSearch({ query: 'xx', caseSensitive: false, regex: false });
  const m = findInText('xx yy xx', xx)[1];
  assert.strictEqual(replaceRange('xx yy xx', { start: m.index, end: m.index + 2 }, xx, 'Q', false), 'xx yy xx'.replace(/xx$/, 'Q'));
});
