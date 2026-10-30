// The fixed frame. A site part (written by hand or by Muse Spark) only knows its
// site: where to start, and how to turn each response into rows. The frame does the
// rest the same way every time: requests and retries (Crawlee), a hashed copy of
// every response kept as evidence, where each value came from, rows streamed to the
// dataset as they are found, state saved so a resurrected run continues where it
// stopped, the completeness count, and the check against the spec's sample rows.
// The caller owns Actor.init() and Actor.exit(): run.js locally, actor-main.js on Apify.

import { createHash } from 'node:crypto';
import { Actor } from 'apify';
import * as cheerio from 'cheerio';
import { HttpCrawler, log, LogLevel } from 'crawlee';
import { compareSamples, formatReport } from '../compare.js';
import { extractEmbedded } from '../embedded.js';
import { select } from '../select.js';

// Saved in the run's default key-value store with every push. Apify keeps that store
// when a run is resurrected or migrated, so the run reloads it and carries on.
const STATE_KEY = 'DAPI_FRAME_STATE';

// Rows reach the dataset in batches: a batch goes when it is full, when its first
// row has waited FLUSH_AFTER_MS (so the first rows show up within seconds), when it
// passes MAX_BATCH_BYTES, or when the platform says the run is about to stop. Batch
// size follows the source's own total: ~1/200 of it, between 50 and 500 rows. Apify
// takes 400 pushes a second per dataset and items under 9 MB, so the limit that
// matters is size, not rate.
const FLUSH_AFTER_MS = 2000;
const MAX_BATCH_BYTES = 5 * 1024 * 1024;
const batchSizeFor = (total) => (total ? Math.min(500, Math.max(50, Math.ceil(total / 200))) : 100);

// testLimit: run every request that mentions a sample's values first, then at most
// this many other follow-up requests. Lets the test loop check samples without
// fetching thousands of detail pages; the full run (no limit) checks completeness.
export async function runFrame({ site, spec, testLimit = null, maxConcurrency = null }) {
  const columns = spec.columns.map((c) => c.name);

  // Speed: the site part proposes a config from the investigator's measurements; the
  // frame clamps it to limits that stay gentle on public sites. A setting given for
  // the run itself wins.
  const clamp = (v, lo, hi, fallback) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback);
  const proposed = site.config ?? {};
  const tuning = {
    maxConcurrency: clamp(maxConcurrency ?? proposed.maxConcurrency, 1, 20, 4),
    maxRequestsPerMinute: clamp(proposed.maxRequestsPerMinute, 30, 1200, 600),
    maxRetries: clamp(proposed.maxRetries, 1, 6, 3),
  };
  console.log(`Speed: ${tuning.maxConcurrency} at a time, at most ${tuning.maxRequestsPerMinute}/min, ${tuning.maxRetries} retries`);

  // Apify Proxy, when the site part asks for it (the investigation showed the site
  // blocks cloud IPs or serves content by country). Recorded in every receipt.
  const proxyAsk = proposed.proxy?.groups?.length ? proposed.proxy : null;
  const proxyConfiguration = proxyAsk
    ? await Actor.createProxyConfiguration({ groups: proxyAsk.groups, countryCode: proxyAsk.countryCode })
    : undefined;
  const via = proxyAsk ? `Apify Proxy ${proxyAsk.groups.join('+')}${proxyAsk.countryCode ? ` (${proxyAsk.countryCode})` : ''}` : 'direct';
  if (proxyAsk) console.log(`Fetching via ${via}`);
  const started = Date.now();

  log.setLevel(LogLevel.WARNING);
  // Named, so the evidence outlives the run: unnamed stores expire after 7 days.
  const evidenceStore = await Actor.openKeyValueStore('dapi-evidence');

  const state = (await Actor.getValue(STATE_KEY)) ?? {
    expected: {}, // kind -> how many the source says exist
    emitted: {}, // kind -> rows already pushed to the dataset
    failed: [], // requests that failed every retry
    skipped: [], // requests robots.txt ruled out
    partial: [], // rows delivered without their detail, and why
    columnProblems: [],
    captures: 0,
    pushed: 0,
    resumed: 0,
    delivered: [], // requests whose rows are all in the dataset (short hashes)
  };
  if (state.pushed > 0 || Object.keys(state.expected).length) {
    state.resumed++;
    console.log(`Resuming: ${state.pushed} rows were already delivered before this run stopped.`);
  }
  const columnProblems = new Set(state.columnProblems);
  const delivered = new Set(state.delivered);
  const save = () => Actor.setValue(STATE_KEY, { ...state, columnProblems: [...columnProblems], delivered: [...delivered] });

  // ---- Streaming rows to the dataset ----
  const buffer = [];
  let bufferBytes = 0;
  let bufferSince = 0;
  let flushing = Promise.resolve();

  // One push at a time, in order. Counts move into the saved state only once their
  // rows are in the dataset, so after any crash the two agree.
  function flush() {
    flushing = flushing.then(async () => {
      if (!buffer.length) return;
      const batch = buffer.splice(0);
      bufferBytes = 0;
      bufferSince = 0;
      await Actor.pushData(batch);
      for (const item of batch) {
        delivered.add(item['#request']);
        state.emitted[item['#kind']] = (state.emitted[item['#kind']] ?? 0) + 1;
        if (item['#partial']) state.partial.push({ what: item['#partial'], row: Object.values(item).slice(0, 2) });
      }
      state.pushed += batch.length;
      await save();
    });
    return flushing;
  }
  const timer = setInterval(() => {
    if (buffer.length && Date.now() - bufferSince >= FLUSH_AFTER_MS) flush();
  }, 500);
  // The platform gives a few seconds' warning before it moves or stops a run.
  for (const event of ['migrating', 'aborting', 'persistState']) Actor.on(event, () => flush());

  // A live line in the Apify console, so the user watching the run sees progress.
  let lastStatus = 0;
  function status(force = false) {
    if (!force && Date.now() - lastStatus < 10_000) return;
    lastStatus = Date.now();
    const total = Object.values(state.expected).reduce((a, b) => a + b, 0);
    const delivered = state.pushed + buffer.length;
    Actor.setStatusMessage(
      `${delivered.toLocaleString()} rows delivered${total ? ` of ${total.toLocaleString()} the source lists` : ''}` +
        ` · ${state.failed.length} failed requests`
    ).catch(() => {});
  }

  const sha256 = (data) => createHash('sha256').update(data).digest('hex');

  // Keeps the server's exact response, hashed and timestamped at the moment of capture.
  async function capture(request, response, body) {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const record = {
      capturedAt: new Date().toISOString(),
      via,
      request: { method: request.method, url: request.url, payload: request.payload ?? null },
      response: { status: response.statusCode, contentType: response.headers['content-type'] ?? null },
      bodySha256: sha256(bytes),
      body: bytes.toString('utf8'),
    };
    // Every capture gets its own key; the hash covers the request, the time and the body.
    const key = `ev-${sha256(JSON.stringify(record))}`;
    await evidenceStore.setValue(key, record);
    state.captures++;
    return key;
  }

  // A traced value carries where it came from: the evidence key and the path(s)
  // inside that response. trace('Data.3.Name'), or trace([a, b], (a, b) => ...) for
  // a value built from several fields. A path is one of:
  //   'Data.3.Name'                   inside the JSON response
  //   'embedded:s7.0.data.17.0'       inside data embedded in the HTML
  //   'css:<selector>[@attr]'         the first match on the HTML page ('css*:' for all)
  function makeTracer(page, evidence) {
    const dig = (value, path) => (path ? path.split('.') : []).reduce((o, key) => (o == null ? undefined : o[key]), value);
    const resolve = (p) => {
      if (p.startsWith('css:') || p.startsWith('css*:')) return select(page.$, p);
      const embedded = p.match(/^embedded:(s\d+\.\d+)(?:\.(.*))?$/);
      if (embedded) return dig(page.embedded.find((e) => e.name === embedded[1])?.value, embedded[2]);
      return dig(page.json, p);
    };
    return (paths, derive) => {
      const list = Array.isArray(paths) ? paths : [paths];
      const values = list.map(resolve);
      return {
        $traced: true,
        value: derive ? derive(...values) : values[0],
        evidence,
        paths: list,
        derived: Boolean(derive),
      };
    };
  }

  // Splits each cell into the plain value for the dataset and its receipt, and queues
  // the row for the next push. With `unavailable` (a fallback row after a failed
  // detail request), columns the row doesn't have are left blank, and their receipts
  // say why.
  function emit(requestKey, row, kind, unavailable = null) {
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
    if (unavailable) {
      for (const c of columns.filter((col) => !(col in plain))) {
        plain[c] = '';
        receipt[c] = { unavailable };
      }
    }
    for (const c of columns) if (!(c in plain)) columnProblems.add(`rows are missing column "${c}"`);
    for (const c of Object.keys(plain)) {
      if (!columns.includes(c)) columnProblems.add(`rows have column "${c}", which the spec doesn't list`);
    }

    // Spec column order, so the dataset reads like the spec. Fields starting with "#"
    // are hidden: Apify's clean exports leave them out.
    const item = {
      ...Object.fromEntries(columns.map((c) => [c, plain[c] ?? ''])),
      '#receipt': receipt,
      '#kind': kind,
      ...(unavailable && { '#partial': unavailable }),
      '#request': requestKey,
    };
    if (!buffer.length) bufferSince = Date.now();
    buffer.push(item);
    bufferBytes += JSON.stringify(item).length;
    status();
  }

  // Full batches go at request boundaries, so one request's rows are never split
  // between pushes (see `delivered`).
  function flushIfFull() {
    const total = Object.values(state.expected).reduce((a, b) => a + b, 0);
    if (buffer.length >= batchSizeFor(total) || bufferBytes >= MAX_BATCH_BYTES) flush();
  }

  const keyOf = (request) => sha256(request.uniqueKey).slice(0, 16);

  // Requests to the same URL with different bodies are different requests
  // (Better Work posts every detail call to one URL), so the method and body
  // go into the unique key.
  function toRequest({ label, note, userData, fallback, ...options }) {
    return { ...options, useExtendedUniqueKey: true, userData: { ...userData, label, note, fallback } };
  }

  // Test mode: a request is the samples' if its URL, body or carried data mentions a
  // sample's identifying value: its first column, which in specs is nearly always the
  // record's name. Other values ("Vietnam", an industry) are shared by hundreds.
  const firstColumn = spec.columns[0].name;
  const sampleValues = spec.samples.map((s) => s.values[firstColumn] ?? '').filter((v) => v.length >= 4);
  const mentionsSample = (r) => {
    const text = JSON.stringify([r.url, r.payload, r.userData]);
    return sampleValues.some((v) => text.includes(v));
  };
  let testBudget = testLimit;
  let testSkipped = 0;

  async function addRequests(requests) {
    if (testLimit === null) return crawler.addRequests(requests.map(toRequest));
    const first = requests.filter(mentionsSample);
    const others = requests.filter((r) => !mentionsSample(r));
    const allowed = others.slice(0, Math.max(0, testBudget));
    testBudget -= allowed.length;
    testSkipped += others.length - allowed.length;
    if (first.length) await crawler.addRequests(first.map(toRequest), { forefront: true });
    if (allowed.length) await crawler.addRequests(allowed.map(toRequest));
  }

  const crawler = new HttpCrawler({
    proxyConfiguration,
    maxConcurrency: tuning.maxConcurrency,
    maxRequestsPerMinute: tuning.maxRequestsPerMinute,
    maxRequestRetries: tuning.maxRetries,
    // Slow government servers: a 2 MB page can take minutes.
    navigationTimeoutSecs: 300,
    requestHandlerTimeoutSecs: 120,
    respectRobotsTxtFile: true,
    onSkippedRequest: ({ url, reason }) => {
      state.skipped.push({ url, reason });
    },
    async requestHandler({ request, response, body, json }) {
      const evidence = await capture(request, response, body);
      const text = Buffer.isBuffer(body) ? body.toString('utf8') : body;
      // Parsed only if the site part asks: most responses need one or the other.
      let $;
      let embedded;
      const page = {
        json,
        get $() {
          return ($ ??= cheerio.load(text));
        },
        get embedded() {
          return (embedded ??= extractEmbedded(text));
        },
      };
      const queued = [];
      let expectedChanged = false;
      // A request whose rows were already delivered before a resurrect runs again only
      // to re-add its follow-ups (the queue ignores repeats); its rows and counts are
      // already in, so it emits and counts nothing.
      const requestKey = keyOf(request);
      const again = delivered.has(requestKey);
      await site.handle({
        request,
        json,
        body: text,
        get $() {
          return page.$;
        },
        get embedded() {
          return page.embedded;
        },
        trace: makeTracer(page, evidence),
        enqueue: (...requests) => queued.push(...requests),
        emit: (row, kind) => {
          if (!again) emit(requestKey, row, kind);
        },
        expect: (kind, count) => {
          if (again) return;
          state.expected[kind] = (state.expected[kind] ?? 0) + count;
          expectedChanged = true;
        },
      });
      flushIfFull();
      // The source's totals are saved at once: after a resurrect, the list page that
      // gave them is already done and won't run again.
      if (expectedChanged) await save();
      if (queued.length) await addRequests(queued);
    },
    // A detail request that failed every retry still owes its rows: the site part can
    // attach them as `fallback` (list columns only), and they come out with the
    // missing columns blank and marked unavailable in their receipts.
    async failedRequestHandler({ request }, error) {
      const reason = error.message.split('\n')[0];
      const what = request.userData.note ?? request.url;
      state.failed.push({ what, error: reason });
      const requestKey = keyOf(request);
      if (delivered.has(requestKey)) return;
      for (const { row, kind } of request.userData.fallback ?? []) emit(requestKey, row, kind, `${what} failed: ${reason}`);
      flushIfFull();
    },
  });

  status(true);
  // On a resurrected run Crawlee's request queue already knows which requests are
  // done, so the start requests are skipped and the queue carries on.
  await crawler.run(site.start.map(toRequest));
  clearInterval(timer);
  await flush();

  // The checks read the dataset back, so they cover rows delivered before a resurrect.
  const rows = [];
  const receipts = [];
  await (await Actor.openDataset()).forEach((item) => {
    const { '#receipt': receipt, '#kind': _kind, '#partial': _partial, '#request': _request, ...row } = item;
    rows.push(row);
    receipts.push(receipt);
  });

  const kinds = [...new Set([...Object.keys(state.expected), ...Object.keys(state.emitted)])];
  const completeness = kinds.map((kind) => ({ kind, expected: state.expected[kind] ?? null, got: state.emitted[kind] ?? 0 }));
  const samples = compareSamples(rows, spec.samples);
  // Rows identical in every column. If their receipts point to the same place in the
  // evidence too, the site part read the same data twice: a bug. If they come from
  // different places, the source itself lists the record twice: a fact to report,
  // not to hide.
  const byValues = new Map();
  rows.forEach((r, i) => {
    const key = JSON.stringify(r);
    byValues.set(key, [...(byValues.get(key) ?? []), i]);
  });
  let duplicateRows = 0;
  const sourceDuplicates = [];
  for (const group of byValues.values()) {
    if (group.length < 2) continue;
    const places = new Set(group.map((i) => JSON.stringify(receipts[i])));
    duplicateRows += group.length - places.size;
    if (places.size > 1) sourceDuplicates.push({ row: rows[group[0]], times: places.size });
  }
  const report = {
    rows: rows.length,
    duplicateRows,
    sourceDuplicates,
    partial: state.partial,
    captures: state.captures,
    resumed: state.resumed,
    completeness,
    failed: state.failed,
    skipped: state.skipped,
    columnProblems: [...columnProblems],
    samples,
    testMode: testLimit === null ? null : { limit: testLimit, skippedRequests: testSkipped },
  };
  await Actor.setValue('REPORT', report);

  const short = completeness.filter((c) => c.expected !== null && c.got < c.expected);
  await Actor.setStatusMessage(
    `Done: ${rows.length.toLocaleString()} rows` +
      (short.length ? ` · SHORT: ${short.map((c) => `${c.kind} ${c.got} of ${c.expected}`).join(', ')}` : ' · complete') +
      ` · ${state.failed.length} failed requests`,
    { isStatusMessageTerminal: true }
  ).catch(() => {});

  console.log(`\n=== ${spec.title} ===`);
  console.log(`Rows: ${rows.length}   Responses kept as evidence: ${state.captures}   Time: ${Math.round((Date.now() - started) / 1000)} s${state.resumed ? `   (resumed ${state.resumed}x)` : ''}`);
  console.log('\nCompleteness:');
  for (const c of completeness) {
    const mark = c.expected === null ? '?' : c.got === c.expected ? 'ok' : 'SHORT';
    console.log(`  ${mark.padEnd(5)} ${c.kind.padEnd(36)} ${c.got} of ${c.expected ?? 'unknown'}`);
  }
  console.log(`\nFailed requests: ${state.failed.length ? '' : 'none'}`);
  for (const f of state.failed) console.log(`  ${f.what}: ${f.error}`);
  if (state.partial.length) console.log(`Rows delivered without their detail (receipts say why): ${state.partial.length}`);
  console.log(`Skipped by robots.txt: ${state.skipped.length || 'none'}`);
  if (duplicateRows) console.log(`Rows read twice (same values, same evidence): ${duplicateRows}`);
  for (const d of sourceDuplicates) {
    console.log(`The source lists this record ${d.times} times: ${JSON.stringify(Object.values(d.row).slice(0, 3))}`);
  }
  if (testLimit !== null) console.log(`Test mode: ${testSkipped} follow-up requests not run (limit ${testLimit}), so counts can't be checked`);
  console.log(`Columns: ${columnProblems.size ? [...columnProblems].join('; ') : 'match the spec'}`);
  console.log(`\nSamples (${samples.length}):\n${formatReport(samples)}`);

  return report;
}
