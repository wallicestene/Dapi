// When a spec points at one record's page instead of the list (a client copies the
// URL of the record their sample came from), Dapi goes up to the list the way a
// freelancer would, and uses that record's page to learn two things: what the
// sample's values are in the site's own words (specs are often read through a browser
// translation, or formatted by hand), and how each record's page URL is built.

import * as cheerio from 'cheerio';
import { chat } from '../meta.js';

// What Muse Spark reads of a page: its title, visible text and links, numbered.
export function outline(html, baseUrl) {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe').remove();
  const title = $('title').text().trim();
  const root = $('main').length ? $('main') : $('body');
  const text = root.text().replace(/\s+/g, ' ').trim().slice(0, 6000);
  const seen = new Set();
  const links = [];
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    let url;
    try {
      url = new URL(href, baseUrl).href;
    } catch {
      return;
    }
    if (seen.has(url) || !/^https?:/.test(url)) return;
    seen.add(url);
    const label = $(a).text().replace(/\s+/g, ' ').trim().slice(0, 80) || $(a).attr('aria-label') || '';
    if (label) links.push({ id: links.length, text: label, url });
  });
  return { title, text, links: links.slice(0, 120) };
}

const UP_PROMPT = `You help a data extraction tool find the list a spec's rows come from.
You get a screenshot of the page the spec names, its title, text and links (numbered), and the spec's columns, row unit and sample rows. Samples may be written in another language than the page (read through a browser translation) or formatted differently.
Decide whether this page shows ONE record (one business, one product, one person: a detail page) rather than a list of records. If it does, choose the link most likely to lead to the list or search of all such records: a breadcrumb, a "back to list", "find …", "search …", "register", "overview" link.
If it is a home, section or landing page instead (the spec named a site, not the list), recordPage is false, but still choose the link most likely to lead toward the list of the records the spec wants: a register, a search, a section named for them.
Answer link null only if this page is itself the list, or if no link leads toward one.`;

const UP_SCHEMA = {
  type: 'object',
  properties: {
    recordPage: { type: 'boolean' },
    link: { type: ['integer', 'null'] },
    reason: { type: 'string' },
  },
  required: ['recordPage', 'link', 'reason'],
  additionalProperties: false,
};

export async function findListLink({ screenshot, page, spec }) {
  const { content, usage } = await chat({
    reasoningEffort: 'low',
    messages: [
      { role: 'system', content: UP_PROMPT },
      {
        role: 'user',
        content: [
          ...(screenshot ? [{ type: 'image_url', image_url: { url: `data:image/png;base64,${screenshot.toString('base64')}` } }] : []),
          {
            type: 'text',
            text: JSON.stringify({
              page,
              spec: { title: spec.title, rowUnit: spec.rowUnit, columns: spec.columns.map((c) => ({ name: c.name, instructions: c.instructions })), samples: spec.samples },
            }),
          },
        ],
      },
    ],
    schema: { name: 'list_link', schema: UP_SCHEMA },
  });
  if (content.link !== null && !page.links[content.link]) content.link = null;
  return { ...content, url: content.link === null ? null : page.links[content.link].url, usage };
}

const ALIGN_PROMPT = `You compare a spec's sample row with the record page it was taken from.
The person who wrote the spec may have read the page through a browser translation, retyped values, or made mistakes. For each sample column, find the page's own text for that value, character for character as the page shows it (its language, its spacing), or the URL for a link, and say how the sample relates to it:
- "same": identical;
- "formatted": the same value written differently (spaces, punctuation, capitals, a label dropped);
- "translated": the sample is a translation of the page's text;
- "differs": the page holds this column but with a different value (a mistyped number, another record's link); give the page's value;
- "absent": the page doesn't show this column; onPage is "";
- "constant": the spec fixes this column for every row; onPage is "".
A blank sample value that the page also leaves blank is "same" with onPage "". Give the page's language and the samples' language as ISO 639-1 codes (e.g. "no", "en"), and which sample (by index) this page is.`;

const ALIGN_SCHEMA = {
  type: 'object',
  properties: {
    sample: { type: 'integer' },
    pageLanguage: { type: 'string' },
    sampleLanguage: { type: 'string' },
    columns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          column: { type: 'string' },
          onPage: { type: 'string' },
          relation: { type: 'string', enum: ['same', 'formatted', 'translated', 'differs', 'absent', 'constant'] },
          note: { type: 'string' },
        },
        required: ['column', 'onPage', 'relation', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['sample', 'pageLanguage', 'sampleLanguage', 'columns'],
  additionalProperties: false,
};

export async function alignSamples({ page, spec }) {
  const { content, usage } = await chat({
    messages: [
      { role: 'system', content: ALIGN_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          page,
          columns: spec.columns.map((c) => ({ name: c.name, instructions: c.instructions, constant: c.constant })),
          samples: spec.samples.map((s, i) => ({ index: i, label: s.label, values: s.values })),
        }),
      },
    ],
    schema: { name: 'sample_alignment', schema: ALIGN_SCHEMA },
  });
  const sample = spec.samples[content.sample] ?? spec.samples[0];
  return { ...content, sample: spec.samples.indexOf(sample), label: sample?.label, usage };
}

// How each record's page URL is built from a list record: the list field whose value
// sits in the record page's URL (e.g. /bhtvirksomhet/971493402 holds the organisation
// number). Prefers longer values, so an ID beats a stray "1".
export function urlTemplate(recordUrl, records) {
  const flat = (obj, prefix = '') =>
    Object.entries(obj ?? {}).flatMap(([k, v]) =>
      v !== null && typeof v === 'object' && !Array.isArray(v) ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]
    );
  let best = null;
  for (const record of records) {
    const pairs = Array.isArray(record) ? record.map((v, i) => [String(i), v]) : flat(record);
    for (const [path, value] of pairs) {
      const text = value === null || value === undefined ? '' : String(value);
      if (text.length < 3 || typeof value === 'object') continue;
      const u = new URL(recordUrl);
      const inPath = u.pathname.split('/').includes(encodeURIComponent(text));
      const inQuery = [...u.searchParams.values()].includes(text);
      if (!inPath && !inQuery) continue;
      if (!best || text.length > best.value.length) best = { field: path, value: text, record };
    }
    if (best) break;
  }
  if (!best) return null;
  const template = recordUrl.replace(encodeURIComponent(best.value), `{${best.field}}`);
  return { template, field: best.field, sampleValue: best.value };
}
