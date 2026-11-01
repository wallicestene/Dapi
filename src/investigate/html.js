// Detail pages that are plain HTML: find the elements that hold a sample record's
// values, ask Muse Spark for selectors that will hold on every record, and check each
// selector against the sample before trusting it.
//
// Selectors use the frame's trace syntax: "css:<selector>" for text,
// "css:<selector>@<attr>" for an attribute, "css*:..." for every match.

import * as cheerio from 'cheerio';
import { chat } from '../meta.js';
import { extractEmbedded } from '../embedded.js';
import { loose } from '../compare.js';
import { select } from '../select.js';

// Every element whose own text or link equals the sample value, with enough context
// (classes, nearby label) for a robust selector.
function locate($, value) {
  const hits = [];
  $('body *').each((_, el) => {
    if (hits.length >= 3) return false;
    const $el = $(el);
    const href = $el.attr('href');
    const text = $el.text().replace(/\s+/g, ' ').trim();
    const byText = text && loose(text) === loose(value) && !$el.children().toArray().some((c) => loose($(c).text()) === loose(value));
    const byHref = href && loose(href) === loose(value);
    if (!byText && !byHref) return undefined;
    const path = $el
      .parents()
      .addBack()
      .toArray()
      .slice(-5)
      .map((p) => p.tagName + (p.attribs?.class ? '.' + p.attribs.class.trim().split(/\s+/).join('.') : ''))
      .join(' > ');
    const label = $el.prev().text().replace(/\s+/g, ' ').trim().slice(0, 60) || $el.parent().prev().text().replace(/\s+/g, ' ').trim().slice(0, 60);
    hits.push({ by: byHref ? 'href' : 'text', path, label, siblings: $el.parent().children().length });
    return undefined;
  });
  return hits;
}

const PROMPT = `You write CSS selectors for a data extraction tool. You get the columns to extract from a detail page, the value each column has on one sample page, and where those values were found on it (element path, nearby label).
For each column, write one selector in this syntax: "css:<selector>" for an element's text, "css:<selector>@<attribute>" for an attribute such as href, "css*:..." when every match is needed. It must work on every record's page, not just this one: prefer classes and nearby labels (e.g. an h6 saying "HQ LOCATION" followed by a p: "css:h6:contains('HQ LOCATION') + p") over positions, and for links of a known kind match the href (e.g. "css:.socialicon a[href*='facebook.com']@href").
If a column needs logic a selector can't express (e.g. the one link that isn't a social network), give the closest css* selector and explain the rule in "how". Give an empty selector if the value isn't on the page. A column whose sample is blank may still have its place on the page, empty or a placeholder (e.g. "---") for this record and filled for others: find it by its label in "pageText" and write the selector anyway.`;

const SCHEMA = {
  type: 'object',
  properties: {
    fields: {
      type: 'array',
      items: {
        type: 'object',
        properties: { column: { type: 'string' }, selector: { type: 'string' }, how: { type: 'string' } },
        required: ['column', 'selector', 'how'],
        additionalProperties: false,
      },
    },
  },
  required: ['fields'],
  additionalProperties: false,
};

export async function mapHtmlDetail({ html, missing, sample, count }) {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();

  const columns = missing.map((c) => ({
    column: c.name,
    instructions: c.instructions,
    sampleValue: sample.values[c.name] ?? '',
    foundAt: sample.values[c.name] ? locate($, sample.values[c.name]) : [],
  }));

  // For columns this sample leaves blank: the page's text, to find their labels by.
  const pageText = columns.some((c) => !c.sampleValue) ? ($('main').length ? $('main') : $('body')).text().replace(/\s+/g, ' ').trim().slice(0, 4000) : undefined;
  const { content, usage } = await chat({
    reasoningEffort: 'low',
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: JSON.stringify({ columns, pageText }) },
    ],
    schema: { name: 'html_selectors', schema: SCHEMA },
  });
  count(usage);

  // Check every selector against the sample page before anyone relies on it, and give
  // Muse Spark one chance to fix the ones that fail, with what they actually matched.
  const $full = cheerio.load(html);
  const fields = Object.fromEntries(content.fields.map((f) => [f.column, check($full, f, sample)]));

  const failing = Object.entries(fields).filter(([, f]) => !f.verified && f.sampleValue);
  if (failing.length) {
    const evidence = failing.map(([column, f]) => {
      const loc = f.keys[0] ?? '';
      let allMatches = [];
      try {
        allMatches = loc ? select($full, loc.replace(/^css:/, 'css*:')).slice(0, 12) : [];
      } catch {
        // invalid selector: the error is already in f.error
      }
      return { column, selector: loc, expected: f.sampleValue, got: f.got, error: f.error, everyMatch: allMatches, foundAt: columns.find((c) => c.column === column)?.foundAt };
    });
    const retry = await chat({
      reasoningEffort: 'low',
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: JSON.stringify({ columns }) },
        { role: 'assistant', content: JSON.stringify(content) },
        { role: 'user', content: `These selectors don't return the sample's value on the sample page. "everyMatch" is what each selector matches, in order. Fix them.\n${JSON.stringify(evidence)}` },
      ],
      schema: { name: 'html_selectors', schema: SCHEMA },
    });
    count(retry.usage);
    for (const f of retry.content.fields) {
      if (!fields[f.column] || fields[f.column].verified) continue;
      const fixed = check($full, f, sample);
      if (fixed.verified) fields[f.column] = { ...fixed, fixedOnRetry: true };
    }
  }

  const jsonLd = extractEmbedded(html).filter((e) => /ld\+json/.test(e.context)).length;
  return { fields, jsonLd };
}

function check($, f, sample) {
  const expected = sample.values[f.column] ?? '';
  let got = '';
  let error = null;
  try {
    got = f.selector ? select($, f.selector) : '';
  } catch (err) {
    error = err.message;
  }
  const gotText = Array.isArray(got) ? got.join(' | ') : got;
  const verified = !Array.isArray(got) && loose(got) === loose(expected);
  return { keys: f.selector ? [f.selector] : [], how: f.how, verified, sampleValue: expected, got: gotText.slice(0, 200), ...(error && { error }) };
}
