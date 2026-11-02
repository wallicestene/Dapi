// The investigation's tools for Muse Wonder: quick, targeted looks that settle a gap
// ("is any business not approved, and what does its page say?", "does this register
// answer for several IDs at once?"). They work from what the investigation found (the
// list feed, the record-page address and selectors, the verified register) and reach
// only hosts the investigation saw or a cited web search result named.

import * as cheerio from 'cheerio';
import { request } from './http.js';
import { findRecords, at } from './data.js';
import { select } from '../select.js';
import { outline } from './record-page.js';
import { mapHtmlDetail } from './html.js';

const clip = (v, n = 2000) => (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, n);

// A JSON answer without hypermedia links, so the fields themselves fit.
function compact(text, n = 5000) {
  try {
    const strip = (v) =>
      Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== '_links').map(([k, x]) => [k, strip(x)])) : v;
    return clip(strip(JSON.parse(text)), n);
  } catch {
    return clip(text.replace(/\s+/g, ' '), Math.min(n, 3000));
  }
}

// Share of a value's words found in a text (see upstream.js).
function present(value, text) {
  const words = String(value).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  if (!words.length) return false;
  const hay = text.toLowerCase();
  return words.filter((w) => hay.includes(w.toLowerCase())).length / words.length >= 0.6;
}

async function getText(url, options = {}) {
  const res = await request(url, { timeoutMs: 60_000, ...options }).catch((err) => ({ ok: false, status: err.code ?? err.name }));
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

const matches = (record, field, equals) => String(at(record, field)) === String(equals);

export function makeTools(findings) {
  const detail = findings.detail ?? {};
  const upstream = detail.upstream;
  const host = (u) => new URL(u.replace(/\{[^}]+\}/g, 'x')).host;
  const hosts = new Set(
    [findings.sourceUrl, findings.list?.request?.url, detail.urlTemplate, detail.sampleUrl, ...(upstream?.apis ?? []).map((a) => a.single)].filter(Boolean).map(host)
  );
  const allowed = (url) => {
    const h = new URL(url).host;
    if (!hosts.has(h)) throw new Error(`${h} is not a host the investigation found or a cited search result named`);
  };

  let records = null;
  // Every list record: the one big page when the list has one, else the first page.
  async function all() {
    if (records) return records;
    const list = findings.list;
    if (!list || list.embedded) return (records = list?.sampleRecords ?? []);
    const r = list.paging?.bigPage?.request ?? list.request;
    const text = await getText(r.url, { method: r.method, body: r.payload ?? undefined, headers: r.contentType ? { 'content-type': r.contentType } : {}, timeoutMs: 120_000 });
    return (records = findRecords(JSON.parse(text))?.records ?? []);
  }

  return {
    // Hosts named by cited search results become reachable.
    allowHost: (url) => hosts.add(new URL(url).host),

    async list_values({ field }) {
      const counts = new Map();
      for (const r of await all()) {
        const v = String(at(r, field));
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      return { records: records.length, values: Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]).slice(0, 25)) };
    },

    async open_record_page({ field, equals }) {
      if (!detail.urlTemplate) throw new Error('no record-page address was found');
      const record = (await all()).find((r) => matches(r, field, equals));
      if (!record) throw new Error(`no record has ${field} = ${equals}`);
      const url = detail.urlTemplate.replace(`{${detail.urlFrom.listField}}`, encodeURIComponent(String(at(record, detail.urlFrom.listField))));
      const $ = cheerio.load(await getText(url));
      const values = {};
      for (const [column, f] of Object.entries(detail.fields ?? {})) {
        if (!f.keys?.[0]) continue;
        try {
          values[column] = select($, f.keys[0]);
        } catch {
          values[column] = null;
        }
      }
      $('script, style, noscript').remove();
      return { url, values, text: clip(($('main').length ? $('main') : $('body')).text().replace(/\s+/g, ' ').trim(), 1500) };
    },

    async call_register({ id, field, equals }) {
      if (!upstream) throw new Error('no register was verified; find one with web_search and test_endpoint');
      if (!id) {
        const record = (await all()).find((r) => matches(r, field, equals));
        if (!record) throw new Error(`no record has ${field} = ${equals}`);
        id = String(at(record, upstream.idField));
      }
      const answers = [];
      for (const api of upstream.apis) {
        const text = await getText(api.single.replace('{id}', encodeURIComponent(id)), { headers: { accept: 'application/json' } }).catch((err) => `(${err.message})`);
        answers.push({ api: api.name, response: text.startsWith('(') ? text : compact(text) });
      }
      return { id, answers };
    },

    // Find a piece of text anywhere in a page's source, scripts and config blocks
    // included: where a page keeps lookups (codes to names) that its visible text hides.
    async search_page_source({ url, text }) {
      allowed(url);
      const html = await getText(url, { timeoutMs: 120_000 });
      const hits = [];
      const lower = html.toLowerCase();
      for (let i = lower.indexOf(text.toLowerCase()); i !== -1 && hits.length < 6; i = lower.indexOf(text.toLowerCase(), i + text.length)) {
        hits.push(html.slice(Math.max(0, i - 300), i + text.length + 300).replace(/\s+/g, ' '));
      }
      return { url, bytes: html.length, matches: hits.length, snippets: hits };
    },

    async fetch_url({ url }) {
      allowed(url);
      return compact(await getText(url));
    },

    // Tries an endpoint the plan would rely on: its status, how many records it holds,
    // and which of the expected values (known from the sample or a record page) it returns.
    async test_endpoint({ url, method, body, expect }) {
      allowed(url);
      const res = await request(url, { method: method || 'GET', body: body || undefined, headers: { accept: 'application/json' }, timeoutMs: 60_000 }).catch((err) => ({ ok: false, status: err.code ?? err.name }));
      if (!res.ok) return { status: res.status, works: false };
      const text = await res.text();
      let records = null;
      try {
        records = findRecords(JSON.parse(text));
      } catch {
        // not JSON
      }
      const found = (expect ?? []).filter((v) => present(v, text));
      return { status: res.status, works: true, bytes: Buffer.byteLength(text), records: records?.count ?? null, recordsPath: records?.path ?? null, expectedFound: found, expectedMissing: (expect ?? []).filter((v) => !found.includes(v)), sample: compact(text, 1500) };
    },

    // Click something on a page and watch: the data requests the click makes (the feed
    // behind a "View" button), or the page it navigates to.
    async click_and_watch({ url, text }) {
      allowed(url);
      const { openPage } = await import('./browser.js');
      const session = await openPage(url);
      try {
        const target = session.page.getByText(text, { exact: false }).first();
        if (!(await target.count())) throw new Error(`nothing on ${url} says “${text}”`);
        const before = session.page.url();
        const captures = await session.during('click', () => target.click({ timeout: 10_000 }));
        await session.page.waitForLoadState('domcontentloaded').catch(() => {});
        const after = session.page.url();
        const image = await session.page.screenshot().catch(() => null);
        const page = after !== before ? outline(await session.page.content(), after) : null;
        return {
          text: {
            navigatedTo: after !== before ? after : null,
            page: page && { title: page.title, text: page.text.slice(0, 2500) },
            requests: captures.slice(0, 6).map((c) => ({ method: c.method, url: c.url, payload: c.payload, status: c.status, records: findRecords(c.json)?.count ?? null, sample: compact(JSON.stringify(c.json), 1200) })),
          },
          image,
        };
      } finally {
        await session.close();
      }
    },

    // Selectors for columns on a page, each checked against the page: with a value when
    // it's known, by its label when it isn't.
    async map_page_fields({ url, columns }) {
      allowed(url);
      const html = await getText(url, { timeoutMs: 120_000 });
      const { fields } = await mapHtmlDetail({
        html,
        missing: columns.map((c) => ({ name: c.name, instructions: c.hint ?? '' })),
        sample: { label: 'given', values: Object.fromEntries(columns.map((c) => [c.name, c.value ?? ''])) },
        count: () => {},
      });
      return Object.fromEntries(Object.entries(fields).map(([column, f]) => [column, { selector: f.keys[0] ?? '', verified: f.verified, got: f.got, how: f.how }]));
    },

    // The page as a person sees it: a screenshot (with any cookie banner dismissed), its
    // text and links. Multimodal: the screenshot goes to the model with the outline.
    async look_at_page({ url }) {
      allowed(url);
      const { openPage } = await import('./browser.js');
      const session = await openPage(url);
      try {
        await session.page.waitForTimeout(300);
        const image = await session.page.screenshot().catch(() => null);
        const html = await session.page.content();
        const o = outline(html, url);
        return { text: { status: session.status, title: o.title, text: o.text.slice(0, 3000), links: o.links.slice(0, 50) }, image };
      } finally {
        await session.close();
      }
    },
  };
}

// The earlier, code-driven loop's checks, now on the same tools.
export async function runChecks({ checks, findings }) {
  const tools = makeTools(findings);
  const results = [];
  for (const check of checks.slice(0, 4)) {
    let found;
    try {
      if (check.tool === 'list-values') found = await tools.list_values(check);
      else if (check.tool === 'record-page') found = await tools.open_record_page(check);
      else if (check.tool === 'register') found = await tools.call_register(check);
      else if (check.tool === 'fetch') found = await tools.fetch_url(check);
    } catch (err) {
      found = { error: err.message.split('\n')[0] };
    }
    results.push({ check, found });
  }
  return results;
}
