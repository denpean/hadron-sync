'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { markdownToOdt, odtToMarkdown } = require('../src/main/odt');
const { splitBlocks, joinBlocks } = require('../src/shared/blocks');

const SAMPLE = `# Titel

Ein Absatz mit **fett**, *kursiv* und ~~durch~~ sowie [Link](https://example.org).

## Liste

- Eins
- Zwei
  - Zwei-a

1. Erst
2. Dann

> Zitat

\`\`\`
code
\`\`\`

| A | B |
| --- | --- |
| 1 | 2 |
`;

test('splitBlocks zerlegt in Top-Level-Blöcke', () => {
  const b = splitBlocks(SAMPLE);
  assert.strictEqual(b.length, 8);
  assert.strictEqual(b[0], '# Titel');
  assert.ok(b[3].startsWith('- Eins'));
  assert.ok(b[3].includes('Zwei-a'));
  assert.strictEqual(splitBlocks(joinBlocks(b)).length, 8);
});

test('Markdown -> ODT -> Markdown behält Struktur', async () => {
  const odt = await markdownToOdt(SAMPLE);
  const back = await odtToMarkdown(odt);
  assert.match(back, /^# Titel/);
  assert.match(back, /\*\*fett\*\*/);
  assert.match(back, /\*kursiv\*/);
  assert.match(back, /~~durch~~/);
  assert.match(back, /\[Link\]\(https:\/\/example.org\)/);
  assert.match(back, /^## Liste/m);
  assert.match(back, /^- Eins/m);
  assert.match(back, /^ {2}- Zwei-a/m);
  assert.match(back, /^1\. Erst/m);
  assert.match(back, /^> Zitat/m);
  assert.match(back, /```\ncode\n```/);
  assert.match(back, /\| A \| B \|/);
});
