// The source behind the source. Record pages often show data they take from a public
// register the page links to by the record's ID (a national business register, a
// charity register). That register's own API usually answers many records per request,
// far faster than loading every page of a slow site, and its response is better
// evidence. Muse Spark proposes the API from what the page links to and what it knows;
// Dapi uses it only once it returns the sample's own values.

import { chat } from '../meta.js';
import { findRecords, at } from './data.js';
import { request } from './http.js';
import { loose } from '../compare.js';

const PROMPT = `You help a data extraction tool find where a record page gets its data.
You get the record's ID, the page's outbound links that carry that ID, the columns still to fill with this record's values for them (as the page shows them), and the record's entry in the site's list.
If those values come from a public register with an open JSON API you know (a national business register, a charity or company registry), give the API: "single", a URL for one record with {id} where the ID goes, and "batch", a URL for several records with {ids} for a comma-separated list, with "maxIds", the most IDs it accepts per request (and a page size big enough to return them all). Batches matter most: a job may need hundreds of records, and most registers' search endpoints accept a list of IDs in a query parameter. Give batch null only if you know the register has no such endpoint. Some registers keep different kinds of records in different endpoints (main units and sub-units): give each as its own entry. Only APIs that are public and need no key. Return an empty list if you don't know one.`;

const SCHEMA = {
  type: 'object',
  properties: {
    apis: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          single: { type: 'string' },
          batch: { type: ['string', 'null'] },
          maxIds: { type: ['integer', 'null'] },
          why: { type: 'string' },
        },
        required: ['name', 'single', 'batch', 'maxIds', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['apis'],
  additionalProperties: false,
};

// Share of a value's words found in a response: "9. Etasje, Youngstorget 2 B, 0181 OSLO
// Oslo" is there when "Youngstorget", "0181" and "OSLO" are, whatever the layout.
function present(value, text) {
  const words = String(value).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  if (!words.length) return false;
  const hay = text.toLowerCase();
  return words.filter((w) => hay.includes(w.toLowerCase())).length / words.length >= 0.6;
}

const get = async (url) => {
  const res = await request(url, { headers: { accept: 'application/json' }, timeoutMs: 30_000 }).catch(() => null);
  if (!res?.ok) return null;
  const text = await res.text();
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return null;
  }
};

// links: the record page's outline links; id: the record's ID; columns: [{ name, value }]
// still to fill, with the sample's site-language values; examples: [{ id, values }] for
// the sample and other records whose pages Dapi opened (values as each page shows them),
// so columns the sample leaves blank can be checked too; names: the list's records by
// ID, so an ID in the register's answer (a parent unit) counts as that record's name.
export async function findUpstream({ id, links, columns, record, examples, names, count }) {
  const ids = examples.map((e) => e.id).filter((x) => x !== id);
  const withId = links.filter((l) => l.url.includes(id)).slice(0, 10);
  if (!withId.length || !columns.length) return null;
  const { content, usage } = await chat({
    reasoningEffort: 'low',
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: JSON.stringify({ id, links: withId, columns, listRecord: record }) },
    ],
    schema: { name: 'upstream_apis', schema: SCHEMA },
  });
  count(usage);

  // A response's text, with the names of list records whose IDs it mentions.
  const expand = (text) => text + ' ' + [...text.matchAll(/\b\d{6,}\b/g)].map(([n]) => names.get(n) ?? '').join(' ');
  const apis = [];
  const covered = new Set();
  for (const api of content.apis.slice(0, 4)) {
    if (!/^https:\/\/[^/]+\//.test(api.single) || !api.single.includes('{id}')) continue;
    // Every example record it answers for: a sub-units endpoint answers only for them.
    const cols = new Set();
    let answered = 0;
    for (const example of examples.slice(0, 4)) {
      const got = await get(api.single.replace('{id}', encodeURIComponent(example.id)));
      if (!got) continue;
      answered++;
      const text = expand(got.text);
      for (const c of columns) {
        const value = example.values[c.name];
        if (value && !/^[-–—\s,]*$/.test(value) && present(value, text)) cols.add(c.name);
      }
    }
    if (!answered) continue;
    cols.forEach((c) => covered.add(c));
    // Many records at once, when the API says it can.
    let batch = null;
    if (api.batch?.includes('{ids}')) {
      const some = [id, ...ids.slice(0, 4)];
      const got = await get(api.batch.replace('{ids}', some.map(encodeURIComponent).join(',')));
      const records = got && findRecords(got.json);
      if (records && records.count >= 1) batch = { url: api.batch, maxIds: api.maxIds ?? 50, recordsPath: records.path, sampleRecord: records.records[0] };
    }
    apis.push({ name: api.name, single: api.single, batch, why: api.why, columns: [...cols] });
  }
  if (!apis.length || !covered.size) return null;
  return { apis, columns: [...covered], idField: null, proposed: content.apis };
}

// Detail columns whose value was the same on every record page Dapi opened: they likely
// depend on a list field (a status), so one page per distinct value of it is enough.
export function sameOnAllPages(fields, pages, select) {
  const out = [];
  for (const [column, f] of Object.entries(fields)) {
    const selector = f.keys?.[0];
    if (!selector || pages.length < 3) continue;
    const values = pages.map(($) => {
      try {
        const v = select($, selector);
        return Array.isArray(v) ? v.join(' | ') : v;
      } catch {
        return null;
      }
    });
    if (values.every((v) => v && loose(v) === loose(values[0]))) out.push(column);
  }
  return out;
}

export { at };
