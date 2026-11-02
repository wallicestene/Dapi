// What the site's own data says about one row's record, read back from the evidence its
// receipt points to. The tester judges a sample that disagrees with a row against it
// (see settleWithEvidence in compare.js).

import * as cheerio from 'cheerio';
import { extractEmbedded } from '../embedded.js';
import { loose } from '../compare.js';

const dig = (value, keys) => keys.reduce((o, key) => (o == null ? undefined : o[key]), value);

function leavesOf(value, path, out) {
  if (value === null || value === undefined) return out;
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) leavesOf(v, path ? `${path}.${k}` : k, out);
  } else if (String(value).trim()) {
    out.push({ path, value: String(value) });
  }
  return out;
}

// Every value a page shows, without the site's own chrome (a footer holds the site's
// address, not the record's), and with `scripts`, the quoted strings in its scripts
// (config blocks that map codes to names).
function pageValues(html, path, { scripts = false } = {}) {
  const $ = cheerio.load(html);
  const out = [];
  if (scripts) {
    $('script').each((_, s) => {
      for (const m of $(s).text().matchAll(/"((?:[^"\\]|\\.){1,200})"/g)) out.push({ path: `${path} script`, value: m[1] });
    });
  }
  $('script, style, noscript, header, footer, nav, aside, [role=banner], [role=contentinfo], [role=navigation]').remove();
  ($('main').length ? $('main') : $('body'))
    .find('*')
    .contents()
    .each((_, node) => {
      if (node.type === 'text' && $(node).text().trim()) out.push({ path, value: $(node).text().trim() });
    });
  return out;
}

// The part of a response a row's values were traced from: the deepest path its cells
// share (certificates.3 in a page of fifteen), so other records' values stay out.
function shared(paths) {
  let prefix = paths[0].slice(0, -1);
  for (const p of paths) {
    let n = 0;
    while (n < prefix.length && n < p.length - 1 && prefix[n] === p[n]) n++;
    prefix = prefix.slice(0, n);
  }
  return prefix;
}

// load(key) returns a captured response ({ body, request }).
export async function recordData(receipt, load) {
  const byKey = new Map();
  for (const cell of Object.values(receipt ?? {})) {
    if (cell?.evidence) byKey.set(cell.evidence, [...(byKey.get(cell.evidence) ?? []), ...(cell.paths ?? [])]);
  }
  const leaves = [];
  for (const [key, paths] of byKey) {
    const record = await load(key);
    if (!record) continue;
    let json = null;
    try {
      json = JSON.parse(record.body);
    } catch {
      // a page
    }
    const plain = paths.filter((p) => !/^(css\*?|embedded):/.test(p)).map((p) => p.split('.'));
    const embedded = paths.map((p) => p.match(/^embedded:(s\d+\.\d+)\.(.*)$/)).filter(Boolean);
    if (json !== null && plain.length) {
      const prefix = shared(plain);
      leavesOf(dig(json, prefix), prefix.join('.'), leaves);
    } else if (embedded.length && embedded.every((m) => m[1] === embedded[0][1])) {
      const prefix = shared(embedded.map((m) => m[2].split('.')));
      const value = extractEmbedded(record.body).find((e) => e.name === embedded[0][1])?.value;
      leavesOf(dig(value, prefix), `embedded:${embedded[0][1]}.${prefix.join('.')}`, leaves);
    } else {
      leaves.push(...pageValues(record.body, record.request?.url ?? key));
    }
  }
  return { leaves, text: leaves.map((l) => l.value).join(' ') };
}

// Every value in every response the test captured, for a sample value that comes from
// a lookup elsewhere (a county name in the search page's config).
export async function valuesIn(keys, load) {
  const all = new Set();
  for (const key of keys) {
    const record = await load(key);
    if (!record) continue;
    let json = null;
    try {
      json = JSON.parse(record.body);
    } catch {
      // a page
    }
    const values = json !== null ? leavesOf(json, '', []) : pageValues(record.body, '', { scripts: true });
    for (const v of values) all.add(loose(v.value).toLowerCase());
  }
  return all;
}
