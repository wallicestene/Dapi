// The checks Muse Wonder asks for while planning: quick, targeted looks that settle a
// gap ("is any business not approved, and what does its page say?"). Each tool works
// only from what the investigation already found (the list feed, the record-page
// address and selectors, the verified register), and reaches only the hosts it saw.

import * as cheerio from 'cheerio';
import { request } from './http.js';
import { findRecords, at } from './data.js';
import { select } from '../select.js';

const clip = (v, n = 2000) => (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, n);

// A register's answer without its hypermedia links, so the fields themselves fit.
function compact(text) {
  try {
    const strip = (v) =>
      Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== '_links').map(([k, x]) => [k, strip(x)])) : v;
    return clip(strip(JSON.parse(text)), 5000);
  } catch {
    return clip(text, 3000);
  }
}

async function getText(url, options = {}) {
  const res = await request(url, { timeoutMs: 60_000, ...options }).catch((err) => ({ ok: false, status: err.code ?? err.name }));
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

// Every list record: the one big page when the list has one, else the first page.
async function listRecords(findings) {
  const list = findings.list;
  if (!list || list.embedded) return list?.sampleRecords ?? [];
  const r = list.paging?.bigPage?.request ?? list.request;
  const text = await getText(r.url, { method: r.method, body: r.payload ?? undefined, headers: r.contentType ? { 'content-type': r.contentType } : {} });
  return findRecords(JSON.parse(text))?.records ?? [];
}

const matches = (record, field, equals) => String(at(record, field)) === String(equals);

export async function runChecks({ checks, findings }) {
  const detail = findings.detail ?? {};
  const upstream = detail.upstream;
  const hosts = new Set(
    [findings.sourceUrl, findings.list?.request?.url, detail.urlTemplate, ...(upstream?.apis ?? []).map((a) => a.single)]
      .filter(Boolean)
      .map((u) => new URL(u.replace(/\{[^}]+\}/g, 'x')).host)
  );
  let records = null;
  const all = async () => (records ??= await listRecords(findings));

  const results = [];
  for (const check of checks.slice(0, 4)) {
    let found;
    try {
      if (check.tool === 'list-values') {
        const counts = new Map();
        for (const r of await all()) {
          const v = String(at(r, check.field));
          counts.set(v, (counts.get(v) ?? 0) + 1);
        }
        found = { records: records.length, values: Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]).slice(0, 25)) };
      } else if (check.tool === 'record-page') {
        if (!detail.urlTemplate) throw new Error('no record-page address was found');
        const record = (await all()).find((r) => matches(r, check.field, check.equals));
        if (!record) throw new Error(`no record has ${check.field} = ${check.equals}`);
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
        found = { url, values, text: clip(($('main').length ? $('main') : $('body')).text().replace(/\s+/g, ' ').trim(), 1500) };
      } else if (check.tool === 'register') {
        if (!upstream) throw new Error('no register was verified');
        let id = check.id;
        if (!id) {
          const record = (await all()).find((r) => matches(r, check.field, check.equals));
          if (!record) throw new Error(`no record has ${check.field} = ${check.equals}`);
          id = String(at(record, upstream.idField));
        }
        found = { id, answers: [] };
        for (const api of upstream.apis) {
          const text = await getText(api.single.replace('{id}', encodeURIComponent(id)), { headers: { accept: 'application/json' } }).catch((err) => `(${err.message})`);
          found.answers.push({ api: api.name, response: text.startsWith('(') ? text : compact(text) });
        }
      } else if (check.tool === 'fetch') {
        const host = new URL(check.url).host;
        if (!hosts.has(host)) throw new Error(`${host} is not a host the investigation found`);
        found = clip((await getText(check.url)).replace(/\s+/g, ' '), 3000);
      }
    } catch (err) {
      found = { error: err.message.split('\n')[0] };
    }
    results.push({ check, found });
  }
  return results;
}
