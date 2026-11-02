// The investigation's test suite: sites built in different ways, each run through the
// first pass, so a change is checked against every kind of site rather than the last
// spec. Five are real client jobs; the rest are sites made for practising extraction
// (toscrape.com) and a Wikipedia table. Pass = the first pass never crashes, and finds
// the list where one of its routes can (a site it can't read must hand over to the agent,
// not fail).
//
// Usage: node src/investigate/suite.js [name ...]   (no Apify reach check: fast, free)

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { investigate } from '../investigate.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fromJob = (id) => JSON.parse(fs.readFileSync(`${root}jobs/${id}/spec.json`, 'utf8'));
const spec = (title, sourceUrl, rowUnit, sample) => ({
  title,
  sourceUrl,
  rowUnit,
  columns: Object.keys(sample).map((name) => ({ name, instructions: '', constant: null })),
  samples: [{ label: 'Sample 1', values: sample }],
  rules: [],
  questions: [],
});

// expect: the route a good first pass takes ('feed', 'embedded', 'html'), or 'agent' when
// the first pass is expected to hand over.
export const CASES = [
  { name: 'betterwork', kind: 'JSON feed (POST), detail behind a click', spec: () => fromJob('0006'), expect: 'feed' },
  { name: 'gptw', kind: 'tables embedded in the page', spec: () => fromJob('0002'), expect: 'embedded' },
  { name: 'arbeidstilsynet', kind: "one record's page, list above it", spec: () => fromJob('0016'), expect: 'feed' },
  { name: 'fssc', kind: 'paged JSON feed (WordPress ajax)', spec: () => fromJob('0024'), expect: 'feed' },
  { name: 'climate', kind: 'HTML list with Load more (WordPress)', spec: () => fromJob('0027'), expect: 'html' },
  { name: 'books', kind: 'HTML list with next pages', spec: () => spec('Books to Scrape', 'https://books.toscrape.com/', 'book', { Title: 'A Light in the Attic', Price: '£51.77' }), expect: 'html' },
  {
    name: 'quotes-scroll',
    kind: 'infinite scroll over a JSON API',
    spec: () => spec('Quotes (scroll)', 'https://quotes.toscrape.com/scroll', 'quote', { Quote: '“The world as we have created it is a process of our thinking. It cannot be changed without changing our thinking.”', Author: 'Albert Einstein' }),
    expect: 'feed',
  },
  {
    name: 'quotes-js',
    kind: 'records in a script, rendered by JavaScript',
    spec: () => spec('Quotes (JavaScript)', 'https://quotes.toscrape.com/js/', 'quote', { Quote: '“The world as we have created it is a process of our thinking. It cannot be changed without changing our thinking.”', Author: 'Albert Einstein' }),
    expect: 'embedded',
  },
  { name: 'wikipedia', kind: 'an HTML table', spec: () => spec('Chemical elements', 'https://en.wikipedia.org/wiki/List_of_chemical_elements', 'element', { Element: 'Hydrogen', Symbol: 'H' }), expect: 'html' },
];

const routeOf = (f) => (!f.list ? 'agent' : f.list.html ? 'html' : f.list.embedded ? 'embedded' : 'feed');

async function main() {
  const only = process.argv.slice(2);
  const results = [];
  for (const c of CASES.filter((x) => !only.length || only.includes(x.name))) {
    const started = Date.now();
    let f = null;
    let crash = null;
    try {
      f = await investigate(c.spec(), { checkReach: false });
    } catch (err) {
      crash = String(err?.message ?? err).split('\n')[0];
    }
    const route = f ? routeOf(f) : 'crash';
    const mapped = f ? f.spec && (c.spec().columns.length - (f.unmapped?.length ?? 0)) : 0;
    const r = {
      name: c.name,
      kind: c.kind,
      expect: c.expect,
      route,
      ok: !crash && route === c.expect,
      records: f?.list?.recordCount ?? null,
      mapped: `${mapped}/${c.spec().columns.length}`,
      handover: f?.stoppedShort ?? null,
      seconds: Math.round((Date.now() - started) / 1000),
      crash,
    };
    results.push(r);
    console.log(`${r.ok ? 'PASS' : crash ? 'CRASH' : 'MISS'}  ${r.name.padEnd(16)} ${route.padEnd(9)} (expect ${c.expect})  records ${String(r.records ?? '-').padEnd(6)} columns ${r.mapped}  ${r.seconds}s${r.handover ? `  hands over: ${r.handover}` : ''}${crash ? `  ${crash}` : ''}`);
  }
  fs.mkdirSync(`${root}storage`, { recursive: true });
  fs.writeFileSync(`${root}storage/investigate-suite.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} as expected; ${results.filter((r) => r.crash).length} crashed.`);
  process.exit(results.some((r) => r.crash) ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
