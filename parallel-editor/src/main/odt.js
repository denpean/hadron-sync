'use strict';
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const { md } = require('../shared/blocks');

const NS = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ------------------------------------------------------------------ */
/* ODT -> Markdown                                                      */
/* ------------------------------------------------------------------ */

function kids(el) { return Array.from(el.childNodes || []); }
function isEl(n, ns, name) { return n.nodeType === 1 && n.namespaceURI === ns && n.localName === name; }
function attr(el, ns, name) { return el.getAttributeNS(ns, name) || ''; }

function collectStyles(docs) {
  // Name -> { bold, italic, strike, code, quote, listStyleName, parent }
  const styles = {};
  const lists = {};
  const all = (ns, n) => docs.flatMap((d) => Array.from(d.getElementsByTagNameNS(ns, n)));
  for (const el of all(NS.style, 'style')) {
    const name = attr(el, NS.style, 'name');
    const s = { parent: attr(el, NS.style, 'parent-style-name') };
    for (const p of kids(el)) {
      if (p.nodeType !== 1) continue;
      if (p.localName === 'text-properties') {
        if (attr(p, NS.fo, 'font-weight') === 'bold') s.bold = true;
        if (attr(p, NS.fo, 'font-style') === 'italic') s.italic = true;
        if (attr(p, NS.style, 'text-line-through-style') && attr(p, NS.style, 'text-line-through-style') !== 'none') s.strike = true;
        const font = attr(p, NS.style, 'font-name');
        if (/mono|courier|consolas/i.test(font)) s.code = true;
      }
    }
    styles[name] = s;
  }
  for (const el of all(NS.text, 'list-style')) {
    const name = attr(el, NS.style, 'name');
    const first = kids(el).find((k) => k.nodeType === 1);
    lists[name] = first && first.localName === 'list-level-style-number' ? 'ordered' : 'bullet';
  }
  return { styles, lists };
}

function resolveStyle(ctx, name) {
  const out = {};
  let n = name; let guard = 0;
  while (n && guard++ < 10) {
    if (/^(Quotations?|Block_20_Quotation)$/.test(n)) out.quote = true;
    if (/^Preformatted/.test(n) || n === 'Source_20_Text') out.code = true;
    const s = ctx.styles[n];
    if (!s) break;
    out.bold = out.bold || s.bold; out.italic = out.italic || s.italic; out.strike = out.strike || s.strike; out.code = out.code || s.code;
    n = s.parent;
  }
  return out;
}

function wrapMarks(text, st) {
  if (!text) return '';
  const lead = text.match(/^\s*/)[0]; const trail = text.match(/\s*$/)[0];
  let core = text.slice(lead.length, text.length - trail.length);
  if (!core) return text;
  if (st.code) core = '`' + core + '`';
  if (st.strike) core = '~~' + core + '~~';
  if (st.bold && st.italic) core = '***' + core + '***';
  else if (st.bold) core = '**' + core + '**';
  else if (st.italic) core = '*' + core + '*';
  return lead + core + trail;
}

function escText(t) { return t.replace(/([\\`*_[\]<>])/g, '\\$1'); }

function inline(ctx, el) {
  let out = '';
  for (const n of kids(el)) {
    if (n.nodeType === 3) { out += escText(n.nodeValue.replace(/\s+/g, ' ')); continue; }
    if (n.nodeType !== 1) continue;
    const name = n.localName;
    if (n.namespaceURI === NS.text) {
      if (name === 'span') out += wrapMarks(inline(ctx, n), resolveStyle(ctx, attr(n, NS.text, 'style-name')));
      else if (name === 'a') out += '[' + inline(ctx, n) + '](' + attr(n, NS.xlink, 'href') + ')';
      else if (name === 'line-break') out += '  \n';
      else if (name === 'tab') out += ' ';
      else if (name === 's') out += ' '.repeat(parseInt(attr(n, NS.text, 'c') || '1', 10));
      else if (name === 'note' || name === 'bookmark' || name === 'bookmark-start' || name === 'bookmark-end') continue;
      else out += inline(ctx, n);
    }
  }
  return out;
}

function paragraphText(ctx, el) {
  const own = resolveStyle(ctx, attr(el, NS.text, 'style-name'));
  let t = inline(ctx, el).replace(/ +\n/g, '\n');
  if (!own.quote && !own.code && (own.bold || own.italic)) t = wrapMarks(t, { bold: own.bold, italic: own.italic });
  return { text: t, st: own };
}

function listBlocks(ctx, el, depth, inheritedStyle) {
  const styleName = attr(el, NS.text, 'style-name') || inheritedStyle;
  const ordered = ctx.lists[styleName] === 'ordered';
  const lines = [];
  let i = 1;
  for (const item of kids(el)) {
    if (!isEl(item, NS.text, 'list-item') && !isEl(item, NS.text, 'list-header')) continue;
    const marker = (ordered ? `${i++}.` : '-');
    const pad = ' '.repeat(depth * (ordered ? 3 : 2));
    let first = true;
    for (const c of kids(item)) {
      if (isEl(c, NS.text, 'p') || isEl(c, NS.text, 'h')) {
        const { text } = paragraphText(ctx, c);
        lines.push(first ? `${pad}${marker} ${text.replace(/\n/g, ' ')}` : `${pad}  ${text.replace(/\n/g, ' ')}`);
        first = false;
      } else if (isEl(c, NS.text, 'list')) {
        if (first) { lines.push(`${pad}${marker}`); first = false; }
        lines.push(...listBlocks(ctx, c, depth + 1, styleName));
      }
    }
  }
  return lines;
}

function tableBlock(ctx, el) {
  const rows = [];
  const walk = (node) => {
    for (const c of kids(node)) {
      if (isEl(c, NS.table, 'table-row')) {
        rows.push(kids(c).filter((x) => isEl(x, NS.table, 'table-cell')).map((cell) =>
          kids(cell).filter((x) => isEl(x, NS.text, 'p') || isEl(x, NS.text, 'h')).map((p) => inline(ctx, p).replace(/\s*\n\s*/g, ' ').trim()).join(' ').replace(/\|/g, '\\|')));
      } else if (c.nodeType === 1 && /^table-(header-rows|rows|row-group)$/.test(c.localName)) walk(c);
    }
  };
  walk(el);
  if (!rows.length) return null;
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => Array.from({ length: width }, (_, i) => r[i] || '');
  const line = (r) => '| ' + pad(r).join(' | ') + ' |';
  return [line(rows[0]), '| ' + Array(width).fill('---').join(' | ') + ' |', ...rows.slice(1).map(line)].join('\n');
}

function odtContentToMarkdown(xml, stylesXml) {
  const parse = (x) => new DOMParser({ onError: () => {} }).parseFromString(x, 'text/xml');
  const doc = parse(xml);
  const ctx = collectStyles(stylesXml ? [parse(stylesXml), doc] : [doc]);
  const body = doc.getElementsByTagNameNS(NS.office, 'text')[0];
  if (!body) throw new Error('Keine Textinhalte in der ODT-Datei gefunden.');
  const blocks = [];
  const walk = (parent) => {
    for (const n of kids(parent)) {
      if (n.nodeType !== 1) continue;
      if (n.namespaceURI === NS.text && n.localName === 'h') {
        const level = Math.min(6, Math.max(1, parseInt(attr(n, NS.text, 'outline-level') || '1', 10)));
        const t = inline(ctx, n).replace(/\s*\n\s*/g, ' ').trim();
        if (t) blocks.push('#'.repeat(level) + ' ' + t);
      } else if (n.namespaceURI === NS.text && n.localName === 'p') {
        const { text, st } = paragraphText(ctx, n);
        const t = text.trim();
        if (!t) continue;
        if (st.code) blocks.push('```\n' + t.replace(/\\([\\`*_[\]<>])/g, '$1') + '\n```');
        else if (st.quote) blocks.push(t.split('\n').map((l) => '> ' + l).join('\n'));
        else blocks.push(t);
      } else if (n.namespaceURI === NS.text && n.localName === 'list') {
        const l = listBlocks(ctx, n, 0, '');
        if (l.length) blocks.push(l.join('\n'));
      } else if (n.namespaceURI === NS.table && n.localName === 'table') {
        const t = tableBlock(ctx, n); if (t) blocks.push(t);
      } else if (n.namespaceURI === NS.text && /^(section|index-body|table-of-content|index-title)$/.test(n.localName)) walk(n);
      else if (n.namespaceURI === NS.text && n.localName === 'table-of-content') continue;
    }
  };
  walk(body);
  return blocks.join('\n\n') + '\n';
}

async function odtToMarkdown(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const f = zip.file('content.xml');
  if (!f) throw new Error('Ungültige ODT-Datei (content.xml fehlt).');
  const st = zip.file('styles.xml');
  return odtContentToMarkdown(await f.async('string'), st ? await st.async('string') : '');
}

/* ------------------------------------------------------------------ */
/* Markdown -> ODT                                                      */
/* ------------------------------------------------------------------ */

function renderInline(children) {
  let out = '';
  const stack = [];
  for (const t of children || []) {
    switch (t.type) {
      case 'text': out += esc(t.content).replace(/ {2,}/g, (m) => ' <text:s text:c="' + (m.length - 1) + '"/>'); break;
      case 'softbreak': out += ' '; break;
      case 'hardbreak': out += '<text:line-break/>'; break;
      case 'code_inline': out += '<text:span text:style-name="Code">' + esc(t.content) + '</text:span>'; break;
      case 'strong_open': out += '<text:span text:style-name="Bold">'; stack.push('span'); break;
      case 'em_open': out += '<text:span text:style-name="Italic">'; stack.push('span'); break;
      case 's_open': out += '<text:span text:style-name="Strike">'; stack.push('span'); break;
      case 'strong_close': case 'em_close': case 's_close': out += '</text:span>'; stack.pop(); break;
      case 'link_open': out += `<text:a xlink:type="simple" xlink:href="${esc(t.attrGet('href') || '')}">`; break;
      case 'link_close': out += '</text:a>'; break;
      case 'image': out += esc(t.content || ''); break;
      default: break;
    }
  }
  return out;
}

function tokensToOdt(tokens) {
  let out = '';
  let listStack = []; // 'ordered' | 'bullet'
  let inItemPara = false;
  let quote = 0;
  let tableRowHead = false;
  const para = (inlineTok, style) => `<text:p text:style-name="${style}">${renderInline(inlineTok.children)}</text:p>`;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t.type) {
      case 'heading_open': {
        const lvl = parseInt(t.tag.slice(1), 10);
        out += `<text:h text:style-name="Heading_20_${lvl}" text:outline-level="${lvl}">${renderInline(tokens[i + 1].children)}</text:h>`;
        i += 2; break;
      }
      case 'paragraph_open': {
        const style = listStack.length ? 'List_20_Contents' : quote ? 'Quotations' : 'Text_20_body';
        out += para(tokens[i + 1], style);
        i += 2; break;
      }
      case 'bullet_list_open': out += `<text:list text:style-name="${listStack.length ? 'L_Bullet' : 'L_Bullet'}">`; listStack.push('bullet'); break;
      case 'ordered_list_open': out += '<text:list text:style-name="L_Number">'; listStack.push('ordered'); break;
      case 'bullet_list_close': case 'ordered_list_close': out += '</text:list>'; listStack.pop(); break;
      case 'list_item_open': out += '<text:list-item>'; break;
      case 'list_item_close': out += '</text:list-item>'; break;
      case 'blockquote_open': quote++; break;
      case 'blockquote_close': quote--; break;
      case 'fence': case 'code_block':
        for (const line of t.content.replace(/\n$/, '').split('\n'))
          out += `<text:p text:style-name="Preformatted_20_Text">${esc(line).replace(/ {2,}/g, (m) => '<text:s text:c="' + m.length + '"/>').replace(/\t/g, '<text:tab/>')}</text:p>`;
        break;
      case 'hr': out += '<text:p text:style-name="Horizontal_20_Line"/>'; break;
      case 'table_open': out += '<table:table table:name="Tabelle' + i + '">'; break;
      case 'table_close': out += '</table:table>'; break;
      case 'thead_open': tableRowHead = true; break;
      case 'thead_close': tableRowHead = false; break;
      case 'tr_open': {
        // Spaltenzahl bei erster Zeile deklarieren
        if (!out.includes('table:table-column', out.lastIndexOf('<table:table '))) {
          let cols = 0;
          for (let j = i + 1; tokens[j].type !== 'tr_close'; j++) if (/^t[hd]_open$/.test(tokens[j].type)) cols++;
          out += `<table:table-column table:number-columns-repeated="${cols}"/>`;
        }
        out += '<table:table-row>'; break;
      }
      case 'tr_close': out += '</table:table-row>'; break;
      case 'th_open': case 'td_open':
        out += '<table:table-cell office:value-type="string">' + `<text:p text:style-name="${tableRowHead ? 'Table_20_Heading' : 'Table_20_Contents'}">${renderInline(tokens[i + 1].children)}</text:p></table:table-cell>`;
        i += 2; break;
      default: break;
    }
  }
  void inItemPara;
  return out;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="${NS.office}" xmlns:style="${NS.style}" xmlns:text="${NS.text}" xmlns:fo="${NS.fo}" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3">
<office:font-face-decls><style:font-face style:name="Liberation Serif" svg:font-family="'Liberation Serif'"/><style:font-face style:name="Liberation Mono" svg:font-family="'Liberation Mono'" style:font-pitch="fixed"/></office:font-face-decls>
<office:styles>
<style:default-style style:family="paragraph"><style:text-properties style:font-name="Liberation Serif" fo:font-size="12pt" fo:language="de" fo:country="DE"/></style:default-style>
<style:style style:name="Standard" style:family="paragraph" style:class="text"/>
<style:style style:name="Text_20_body" style:display-name="Text body" style:family="paragraph" style:parent-style-name="Standard" style:class="text"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.25cm"/></style:style>
<style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Text_20_body" style:class="text"><style:paragraph-properties fo:margin-top="0.42cm" fo:margin-bottom="0.21cm" fo:keep-with-next="always"/><style:text-properties fo:font-weight="bold"/></style:style>
${[1, 2, 3, 4, 5, 6].map((n) => `<style:style style:name="Heading_20_${n}" style:display-name="Heading ${n}" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="${n}" style:class="text"><style:text-properties fo:font-size="${[22, 18, 15, 13, 12, 12][n - 1]}pt" fo:font-weight="bold"/></style:style>`).join('\n')}
<style:style style:name="List_20_Contents" style:display-name="List Contents" style:family="paragraph" style:parent-style-name="Standard" style:class="list"/>
<style:style style:name="Quotations" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:paragraph-properties fo:margin-left="1cm" fo:margin-right="1cm" fo:margin-bottom="0.25cm"/><style:text-properties fo:font-style="italic"/></style:style>
<style:style style:name="Preformatted_20_Text" style:display-name="Preformatted Text" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:text-properties style:font-name="Liberation Mono" fo:font-size="10pt"/></style:style>
<style:style style:name="Horizontal_20_Line" style:display-name="Horizontal Line" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:border-bottom="0.5pt solid #000000" fo:padding="0cm"/></style:style>
<style:style style:name="Table_20_Contents" style:display-name="Table Contents" style:family="paragraph" style:parent-style-name="Standard"/>
<style:style style:name="Table_20_Heading" style:display-name="Table Heading" style:family="paragraph" style:parent-style-name="Table_20_Contents"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="Bold" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="Italic" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
<style:style style:name="Strike" style:family="text"><style:text-properties style:text-line-through-style="solid"/></style:style>
<style:style style:name="Code" style:family="text"><style:text-properties style:font-name="Liberation Mono"/></style:style>
<text:list-style style:name="L_Bullet">${[1, 2, 3, 4, 5, 6].map((n) => `<text:list-level-style-bullet text:level="${n}" text:bullet-char="•"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${0.6 * n}cm" fo:text-indent="-0.5cm" fo:margin-left="${0.6 * n}cm"/></style:list-level-properties></text:list-level-style-bullet>`).join('')}</text:list-style>
<text:list-style style:name="L_Number">${[1, 2, 3, 4, 5, 6].map((n) => `<text:list-level-style-number text:level="${n}" style:num-suffix="." style:num-format="1"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${0.7 * n}cm" fo:text-indent="-0.6cm" fo:margin-left="${0.7 * n}cm"/></style:list-level-properties></text:list-level-style-number>`).join('')}</text:list-style>
</office:styles>
</office:document-styles>`;

async function markdownToOdt(markdown, title = 'Dokument') {
  const body = tokensToOdt(md.parse(String(markdown), {}));
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="${NS.office}" xmlns:text="${NS.text}" xmlns:style="${NS.style}" xmlns:table="${NS.table}" xmlns:xlink="${NS.xlink}" xmlns:fo="${NS.fo}" office:version="1.3"><office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  const meta = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="${NS.office}" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.3"><office:meta><dc:title>${esc(title)}</dc:title><meta:generator>Parallel Editor</meta:generator></office:meta></office:document-meta>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;
  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  zip.file('META-INF/manifest.xml', manifest);
  zip.file('content.xml', content);
  zip.file('styles.xml', STYLES_XML);
  zip.file('meta.xml', meta);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', mimeType: 'application/vnd.oasis.opendocument.text' });
}

module.exports = { odtToMarkdown, markdownToOdt, odtContentToMarkdown };
