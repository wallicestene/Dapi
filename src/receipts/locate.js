// Finds a traced value inside the evidence it came from, for the receipt view: the
// JSON record with the value's key, the embedded table row with its cell, or the
// captured page with the matched element outlined. Shared by the local receipt
// server and the web app.

import * as cheerio from 'cheerio';
import { extractEmbedded } from '../embedded.js';

const dig = (value, p) => (p ? p.split('.') : []).reduce((o, k) => (o == null ? undefined : o[k]), value);

// What to show for one path inside one piece of evidence, already focused on the value.
export function locate(evidence, locator) {
  const embedded = locator.match(/^embedded:(s\d+\.\d+)(?:\.(.*))?$/);
  if (embedded) {
    const entry = extractEmbedded(evidence.body).find((e) => e.name === embedded[1]);
    const parts = (embedded[2] ?? '').split('.');
    // Show the whole record the value sits in (its row), with the cell marked.
    const rowPath = parts.slice(0, -1).join('.');
    return {
      kind: 'embedded',
      context: entry?.context ?? '',
      rowPath,
      row: dig(entry?.value, rowPath),
      cell: parts.at(-1),
      value: dig(entry?.value, embedded[2]),
    };
  }
  if (locator.startsWith('css:') || locator.startsWith('css*:')) {
    const all = locator.startsWith('css*:');
    const body = locator.slice(all ? 5 : 4);
    const at = body.lastIndexOf('@');
    const selector = at > 0 && /^[\w-]+$/.test(body.slice(at + 1)) ? body.slice(0, at) : body;
    const $ = cheerio.load(evidence.body);
    const matches = $(selector).length;
    return { kind: 'html', selector, all, matches };
  }
  // JSON: show the whole record the value sits in, with its key marked.
  const parts = locator.split('.');
  const parsed = JSON.parse(evidence.body);
  return { kind: 'json', path: locator, record: dig(parsed, parts.slice(0, -1).join('.')), key: parts.at(-1), value: dig(parsed, locator) };
}

// The captured page as it was, with the elements a selector matched outlined, for
// display only. The raw body stays untouched for the hash check. Scripts are removed
// and a <base> makes the page's own styles load.
export function markedPage(evidence, locator) {
  const all = locator.startsWith('css*:');
  const body = locator.slice(all ? 5 : 4);
  const at = body.lastIndexOf('@');
  const selector = at > 0 && /^[\w-]+$/.test(body.slice(at + 1)) ? body.slice(0, at) : body;
  const $ = cheerio.load(evidence.body);
  $('script').remove();
  const hits = $(selector);
  (all ? hits : hits.first()).attr('data-dapi-hit', '');
  $('head').prepend(`<base href="${evidence.request.url}">`);
  $('head').append('<style>[data-dapi-hit]{outline:3px solid #2f7d4f!important;outline-offset:3px;background:rgba(47,125,79,.14)!important}</style>');
  return $.html();
}
