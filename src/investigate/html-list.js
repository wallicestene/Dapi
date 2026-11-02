// The list in the page's own HTML: the most common way a site shows its records, and the
// route when neither a JSON feed nor embedded data holds them. Found from the spec's
// samples: the element that holds a sample value, the repeating element around it (its
// siblings share its tag and classes), and each column as a selector inside that
// element, verified by reading every item and finding the sample again. Paging: a link
// to the next page, or a "Load more" control whose request the agent can watch.

import * as cheerio from 'cheerio';
import { loose } from '../compare.js';

// Classes that name one item (post-123, card-7) don't repeat; leave them out.
const stable = (cls) => cls && !/\d{2,}/.test(cls) && !/^(active|current|selected|first|last|odd|even)$/i.test(cls);
const sig = ($, el) => {
  const classes = ($(el).attr('class') ?? '').split(/\s+/).filter(stable).slice(0, 3);
  return `${el.tagName}${classes.map((c) => `.${c.replace(/([^\w-])/g, '\\$1')}`).join('')}`;
};

// The same value, ignoring spacing, case and a link's own host (a page may link
// relatively to what the sample writes in full).
const path = (v) => loose(v).toLowerCase().replace(/^https?:\/\/[^/]+/, '');
const same = (a, b) => path(a) === path(b);

// The element holding a value, inside `scope` when given (a record already found): a
// link whose href is the value, an attribute that holds it whole (a full title behind a
// shortened one, an image's alt), or the smallest element whose own text is the value.
function holder($, value, scope = null) {
  const want = loose(value).toLowerCase();
  if (!want) return null;
  const all = (sel) => (scope ? $(scope).find(sel).addBack(sel) : $(sel)).toArray();
  for (const a of all('a[href]')) if (same($(a).attr('href') ?? '', value)) return { el: a, attr: 'href' };
  for (const el of all('[title], [alt], [aria-label], [content], [data-title], [data-name]')) {
    for (const attr of ['title', 'alt', 'aria-label', 'content', 'data-title', 'data-name']) {
      if ($(el).attr(attr) !== undefined && loose($(el).attr(attr)).toLowerCase() === want) return { el, attr };
    }
  }
  for (const el of all('*')) {
    if (['script', 'style', 'noscript', 'head', 'title', 'meta'].includes(el.tagName) || $(el).children().length > 3) continue;
    if (loose($(el).text()).toLowerCase() === want) return { el, attr: null };
  }
  return null;
}

// The record element: among the holder's ancestors that repeat (at least two siblings of
// the same shape), the lowest one holding the most of the sample's values: a table's row
// rather than its cell. Its selector is narrowed by its parents until it matches only
// its own group (a bare "tr" would match every table on the page).
function recordOf($, el, values = []) {
  let best = null;
  for (let node = el; node && node.tagName && node.tagName !== 'body'; node = node.parent) {
    const parent = node.parent;
    if (!parent) break;
    const s = sig($, node);
    const same = $(parent)
      .children()
      .toArray()
      .filter((c) => c.tagName && sig($, c) === s);
    if (same.length < 3) continue;
    const holds = values.filter((v) => holder($, v, node)).length;
    if (!best || holds > best.holds) best = { el: node, parent, s, count: same.length, holds };
  }
  if (!best) return null;
  let selector = best.s;
  for (let up = best.parent, depth = 0; up && up.tagName && depth < 3 && $(selector).length > best.count * 1.5; up = up.parent, depth++) {
    selector = `${sig($, up)} > ${selector}`;
  }
  return { el: best.el, selector, count: best.count };
}

// The path from the record element down to the holder, as a selector inside the
// record; a step whose siblings share its shape (a row's cells) carries its position.
function pathWithin($, record, el) {
  if (record === el) return '';
  const steps = [];
  for (let node = el; node && node !== record; node = node.parent) {
    const s = sig($, node);
    const kin = $(node.parent).children().toArray();
    const twins = kin.filter((c) => c.tagName && sig($, c) === s);
    steps.unshift(twins.length > 1 ? `${s}:nth-child(${kin.indexOf(node) + 1})` : s);
  }
  return steps.join(' > ');
}

const readIn = ($, item, field) => {
  const target = field.path ? $(item).find(field.path).first() : $(item);
  return field.attr ? (target.attr(field.attr) ?? '').trim() : target.text().replace(/\s+/g, ' ').trim();
};

const PAGING = /^(next|next page|older|older posts|more|load more|show more|view more|›|»|→)$/i;

export function htmlList({ html, url, spec }) {
  const $ = cheerio.load(html);
  const columns = spec.columns.filter((c) => c.constant === null);
  const sample = spec.samples[0];
  if (!sample) return null;
  // A record element found from the first sample value that's on the page.
  let record = null;
  const fields = {};
  for (const c of columns) {
    const value = sample.values[c.name];
    if (!value) continue;
    // Once a record is found, later columns are looked for inside it.
    const h = (record && holder($, value, record.el)) ?? (record ? null : holder($, value));
    if (!h) continue;
    const r = record ?? recordOf($, h.el, Object.values(sample.values).filter((v) => v && v !== value));
    if (!r) continue;
    record = r;
    fields[c.name] = { path: pathWithin($, r.el, h.el), attr: h.attr };
  }
  if (!record) return null;
  const items = $(record.selector).toArray();
  const rows = items.map((item) => Object.fromEntries(Object.entries(fields).map(([c, f]) => [c, readIn($, item, f)])));
  // Verified: the sample's own values come back from one of the items, and most items
  // have every mapped column.
  const back = rows.some((row) => Object.keys(fields).every((c) => same(row[c], sample.values[c])));
  const full = rows.filter((row) => Object.values(row).every(Boolean)).length;
  if (!back || full < 2) return null;
  // Paging: a "next" link, or a control that loads more in place.
  let next = $('a[rel="next"]').attr('href') ?? null;
  let loadMore = null;
  $('a, button').each((_, el) => {
    const label = $(el).text().replace(/\s+/g, ' ').trim();
    if (!PAGING.test(label)) return;
    const href = $(el).attr('href');
    if (!next && href && !href.startsWith('#') && !href.startsWith('javascript')) next = href;
    else if (!href || href.startsWith('#')) loadMore ??= label;
  });
  if (!loadMore && $('[class*="load-more"], [class*="loadmore"]').length) loadMore = $('[class*="load-more"], [class*="loadmore"]').first().text().replace(/\s+/g, ' ').trim() || 'Load more';
  const abs = (u) => (u ? new URL(u, url).href : null);
  return {
    html: true,
    capture: { url, method: 'GET', payload: null },
    request: { url, method: 'GET', payload: null, contentType: null },
    item: { selector: record.selector },
    records: { count: items.length, records: rows.slice(0, 5), path: null },
    recordCount: items.length,
    total: null,
    fields: Object.fromEntries(columns.map((c) => [c.name, fields[c.name] ? { keys: [`${fields[c.name].path}${fields[c.name].attr ? `@${fields[c.name].attr}` : ''}`], how: 'inside each item' } : { keys: [], how: 'not found inside the items' }])),
    paging: { html: true, next: abs(next), loadMore, pageSize: items.length },
    reason: `The records are in the page's own HTML: ${items.length} items like the sample's (${record.selector}).`,
  };
}

// The same list without a browser: a plain request, and the items still there.
export async function replayHtml(list, request) {
  const res = await request(list.request.url, { timeoutMs: 60_000 }).catch(() => null);
  if (!res?.ok) return { works: null };
  const $ = cheerio.load(await res.text());
  const n = $(list.item.selector).length;
  return n >= list.recordCount * 0.8 ? { works: 'plain request', items: n } : { works: null, items: n };
}
