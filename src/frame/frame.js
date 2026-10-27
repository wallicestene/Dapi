// The fixed frame. A site part (written by hand or by Muse Spark) only knows its
// site: where to start, and how to turn each response into rows. The frame does the
// rest the same way every time: requests and retries (Crawlee), a hashed copy of
// every response kept as evidence, where each value came from, the completeness
// count, and the check against the spec's sample rows.
// The caller owns Actor.init() and Actor.exit(): run.js locally, actor-main.js on Apify.

import { createHash } from 'node:crypto';
import { Actor } from 'apify';
import { HttpCrawler, log, LogLevel } from 'crawlee';
import { compareSamples, formatReport } from '../compare.js';

export async function runFrame({ site, spec }) {
  const columns = spec.columns.map((c) => c.name);

  log.setLevel(LogLevel.WARNING);
  // Named, so the evidence outlives the run: unnamed stores expire after 7 days.
  const evidenceStore = await Actor.openKeyValueStore('dapi-evidence');

  const rows = [];
  const receipts = [];
  const expected = {}; // kind -> how many the source says exist
  const emitted = {}; // kind -> how many rows we produced
  const failed = []; // requests that failed every retry
  const skipped = []; // requests robots.txt ruled out
  const columnProblems = new Set();
  let captures = 0;

  const sha256 = (data) => createHash('sha256').update(data).digest('hex');

  // Keeps the server's exact response, hashed and timestamped at the moment of capture.
  async function capture(request, response, body) {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const record = {
      capturedAt: new Date().toISOString(),
      request: { method: request.method, url: request.url, payload: request.payload ?? null },
      response: { status: response.statusCode, contentType: response.headers['content-type'] ?? null },
      bodySha256: sha256(bytes),
      body: bytes.toString('utf8'),
    };
    // Every capture gets its own key; the hash covers the request, the time and the body.
    const key = `ev-${sha256(JSON.stringify(record))}`;
    await evidenceStore.setValue(key, record);
    captures++;
    return key;
  }

  // A traced value carries where it came from: the evidence key and the path(s)
  // inside that response. trace('Data.3.Name'), or trace([a, b], (a, b) => ...) for
  // a value built from several fields.
  function makeTracer(json, evidence) {
    const at = (p) => p.split('.').reduce((o, key) => (o == null ? undefined : o[key]), json);
    return (paths, derive) => {
      const list = Array.isArray(paths) ? paths : [paths];
      const values = list.map(at);
      return {
        $traced: true,
        value: derive ? derive(...values) : values[0],
        evidence,
        paths: list,
        derived: Boolean(derive),
      };
    };
  }

  // Splits each cell into the plain value for the dataset and its receipt.
  function emit(row, kind) {
    const plain = {};
    const receipt = {};
    for (const [column, cell] of Object.entries(row)) {
      if (cell?.$traced) {
        plain[column] = cell.value ?? '';
        receipt[column] = { evidence: cell.evidence, paths: cell.paths, derived: cell.derived };
      } else {
        plain[column] = cell ?? '';
        receipt[column] = { constant: true };
      }
    }
    for (const c of columns) if (!(c in plain)) columnProblems.add(`rows are missing column "${c}"`);
    for (const c of Object.keys(plain)) {
      if (!columns.includes(c)) columnProblems.add(`rows have column "${c}", which the spec doesn't list`);
    }

    // Spec column order, so the dataset reads like the spec.
    rows.push(Object.fromEntries(columns.map((c) => [c, plain[c] ?? ''])));
    receipts.push(receipt);
    emitted[kind] = (emitted[kind] ?? 0) + 1;
  }

  // Requests to the same URL with different bodies are different requests
  // (Better Work posts every detail call to one URL), so the method and body
  // go into the unique key.
  function toRequest({ label, note, userData, ...options }) {
    return { ...options, useExtendedUniqueKey: true, userData: { ...userData, label, note } };
  }

  const crawler = new HttpCrawler({
    maxConcurrency: 4, // gentle on public sites
    maxRequestRetries: 3,
    respectRobotsTxtFile: true,
    onSkippedRequest: ({ url, reason }) => {
      skipped.push({ url, reason });
    },
    async requestHandler({ request, response, body, json }) {
      const evidence = await capture(request, response, body);
      const queued = [];
      await site.handle({
        request,
        json,
        body: Buffer.isBuffer(body) ? body.toString('utf8') : body,
        trace: makeTracer(json, evidence),
        enqueue: (...requests) => queued.push(...requests),
        emit,
        expect: (kind, count) => {
          expected[kind] = (expected[kind] ?? 0) + count;
        },
      });
      if (queued.length) await crawler.addRequests(queued.map(toRequest));
    },
    async failedRequestHandler({ request }, error) {
      failed.push({ what: request.userData.note ?? request.url, error: error.message.split('\n')[0] });
    },
  });

  const started = Date.now();
  await crawler.run(site.start.map(toRequest));

  // The dataset: clean rows, each carrying its receipt in a hidden "#receipt" field
  // that Apify's clean exports leave out.
  await Actor.pushData(rows.map((row, i) => ({ ...row, '#receipt': receipts[i] })));

  const kinds = [...new Set([...Object.keys(expected), ...Object.keys(emitted)])];
  const completeness = kinds.map((kind) => ({ kind, expected: expected[kind] ?? null, got: emitted[kind] ?? 0 }));
  const samples = compareSamples(rows, spec.samples);
  const report = { rows: rows.length, captures, completeness, failed, skipped, columnProblems: [...columnProblems], samples };
  await Actor.setValue('REPORT', report);

  console.log(`\n=== ${spec.title} ===`);
  console.log(`Rows: ${rows.length}   Responses kept as evidence: ${captures}   Time: ${Math.round((Date.now() - started) / 1000)} s`);
  console.log('\nCompleteness:');
  for (const c of completeness) {
    const mark = c.expected === null ? '?' : c.got === c.expected ? 'ok' : 'SHORT';
    console.log(`  ${mark.padEnd(5)} ${c.kind.padEnd(36)} ${c.got} of ${c.expected ?? 'unknown'}`);
  }
  console.log(`\nFailed requests: ${failed.length ? '' : 'none'}`);
  for (const f of failed) console.log(`  ${f.what}: ${f.error}`);
  console.log(`Skipped by robots.txt: ${skipped.length || 'none'}`);
  console.log(`Columns: ${columnProblems.size ? [...columnProblems].join('; ') : 'match the spec'}`);
  console.log(`\nSamples (${samples.length}):\n${formatReport(samples)}`);

  return report;
}
