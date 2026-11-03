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
import { HttpCrawler, NonRetryableError, RobotsTxtFile, log, LogLevel } from 'crawlee';
import { compareSamples, formatReport, settleWithEvidence, notOnSite } from '../compare.js';
import { recordData, valuesIn } from './record-data.js';
import { extractEmbedded } from '../embedded.js';
import { select } from '../select.js';
import { classifyBlock } from '../blocks.js';

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
// robotsOverride: robots.txt is obeyed unless the user approved fetching despite it
// for this job (the investigator found no allowed route). Overridden requests are
// counted in the report and marked in their evidence.
export async function runFrame({ site, spec, testLimit = null, maxConcurrency = null, robotsOverride = false }) {
  const columns = spec.columns.map((c) => c.name);

  // Speed: the site part proposes a config from the investigator's measurements; the
  // frame clamps it to limits that stay gentle on public sites. A setting given for
  // the run itself wins.
  const clamp = (v, lo, hi, fallback) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback);
  const proposed = site.config ?? {};
  const tuning = {
    maxConcurrency: clamp(maxConcurrency ?? proposed.maxConcurrency, 1, 20, 4),
    maxRequestsPerMinute: clamp(proposed.maxRequestsPerMinute, 30, 1200, 600),
    // Up to 20: a server that stalls for minutes at a time needs patience, not speed.
    maxRetries: clamp(proposed.maxRetries, 1, 20, 3),
    // How long one request may take, and how long to wait before retrying a failed one.
    timeoutSecs: clamp(proposed.timeoutSecs, 15, 300, 120),
    retryPauseSecs: clamp(proposed.retryPauseSecs, 0, 60, 0),
  };
  // robots.txt's Crawl-delay is kept: one request at a time to that site, that far apart.
  // (Crawlee's parser holds the delay but doesn't expose it, hence the reach inside.)
  if (!robotsOverride && spec.sourceUrl) {
    const robots = await RobotsTxtFile.find(spec.sourceUrl).catch(() => null);
    const delay = Math.min(60, Number(robots?.robots?.getCrawlDelay?.('*')) || 0);
    if (delay) Object.assign(tuning, { maxConcurrency: 1, sameDomainDelaySecs: delay });
  }
  console.log(`Speed: ${tuning.maxConcurrency} at a time, at most ${tuning.maxRequestsPerMinute}/min, ${tuning.maxRetries} retries, ${tuning.timeoutSecs} s timeout${tuning.retryPauseSecs ? `, ${tuning.retryPauseSecs} s pause before a retry` : ''}${tuning.sameDomainDelaySecs ? `, ${tuning.sameDomainDelaySecs} s between requests (robots.txt)` : ''}`);

  // Apify Proxy, when the site part asks for it (the investigation showed the site
  // blocks cloud IPs or serves content by country). Recorded in every receipt.
  const proxyAsk = proposed.proxy?.groups?.length ? proposed.proxy : null;
  const proxyConfiguration = proxyAsk
    ? await Actor.createProxyConfiguration({
        // Apify Proxy has no group called DATACENTER: datacenter IPs are the default
        // when no group is named. RESIDENTIAL is a real group.
        groups: proxyAsk.groups.filter((g) => g !== 'DATACENTER'),
        countryCode: proxyAsk.countryCode,
      })
    : undefined;
  const via = proxyAsk ? `Apify Proxy ${proxyAsk.groups.join('+')}${proxyAsk.countryCode ? ` (${proxyAsk.countryCode})` : ''}` : 'direct';
  if (proxyAsk) console.log(`Fetching via ${via}`);
  const started = Date.now();

  log.setLevel(LogLevel.WARNING);
  // Named, so the evidence outlives the run: unnamed stores expire after 7 days.
  const evidenceStore = await Actor.openKeyValueStore('dapi-evidence');
  // A test's captures, so its samples can be judged against them.
  const captured = [];

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
        if (item['#probe']) continue;
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
  // The platform gives a few seconds' warning before it moves or stops a run. From
  // then on, each request that finishes waits for its own rows to be pushed before
  // Crawlee marks it done, so no rows are in flight when the run stops. (Without the
  // warning, a hard crash can still lose up to FLUSH_AFTER_MS of rows; the
  // completeness count reports it.)
  let stopping = false;
  for (const event of ['migrating', 'aborting']) {
    Actor.on(event, () => {
      stopping = true;
      flush();
    });
  }
  Actor.on('persistState', () => flush());

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
  // With an approved override, still know which requests robots.txt disallowed.
  const robotsFiles = new Map();
  async function disallowedByRobots(url) {
    if (!robotsOverride) return false;
    const origin = new URL(url).origin;
    if (!robotsFiles.has(origin)) robotsFiles.set(origin, RobotsTxtFile.find(url).catch(() => null));
    const robots = await robotsFiles.get(origin);
    return robots ? !robots.isAllowed(url) : false;
  }

  async function capture(request, response, body) {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const overridden = await disallowedByRobots(request.url);
    if (overridden) state.robotsOverridden = (state.robotsOverridden ?? 0) + 1;
    const record = {
      capturedAt: new Date().toISOString(),
      via,
      ...(overridden && { robots: 'disallowed: fetched with the user\'s approval' }),
      request: { method: request.method, url: request.url, payload: request.payload ?? null },
      response: { status: response.statusCode, contentType: response.headers['content-type'] ?? null },
      bodySha256: sha256(bytes),
      body: bytes.toString('utf8'),
    };
    // Every capture gets its own key; the hash covers the request, the time and the body.
    const key = `ev-${sha256(JSON.stringify(record))}`;
    await evidenceStore.setValue(key, record);
    state.captures++;
    if (testLimit !== null) captured.push(key);
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
  function emit(requestKey, row, kind, unavailable = null, probe = false) {
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
      ...(probe && { '#probe': true }),
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
  // On a big paged list the samples' records sit far past the first pages a test reads,
  // so the site part can name requests that reach them directly (the site's search by
  // an ID). Tests only: their rows are checked against the samples but not counted,
  // their totals are a search's, not the source's, and a full run never makes them.
  const probes = testLimit === null ? [] : (site.sampleRequests ?? []).map((r) => ({ ...r, userData: { ...r.userData, sampleProbe: true } }));
  // Per sample (userData.sample, its label): lookups made, rows they gave, lookups failed.
  const probeStats = {};
  const tally = (request, field) => {
    const label = request.userData.sample;
    if (!request.userData.sampleProbe || !label) return;
    probeStats[label] ??= { requests: 0, rows: 0, failed: 0 };
    probeStats[label][field]++;
  };

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
    ...(tuning.sameDomainDelaySecs && { sameDomainDelaySecs: tuning.sameDomainDelaySecs }),
    maxRequestRetries: tuning.maxRetries,
    navigationTimeoutSecs: tuning.timeoutSecs,
    requestHandlerTimeoutSecs: 120,
    respectRobotsTxtFile: !robotsOverride,
    onSkippedRequest: ({ url, reason }) => {
      state.skipped.push({ url, reason });
    },
    async requestHandler({ request, response, body, json, session }) {
      const text = Buffer.isBuffer(body) ? body.toString('utf8') : body;
      // A bot check behind a 200 (blocked statuses never reach here: Crawlee retires
      // the session and retries them). One that wants a person fails at once and is
      // reported; any other is retried from a fresh session, so a fresh IP.
      const check = classifyBlock({ status: response.statusCode, body: text });
      if (check?.kind === 'human') throw new NonRetryableError(`the site asked for ${check.what}, which only a person can pass; Dapi sets those aside`);
      if (check) {
        session?.retire();
        throw new Error(`blocked by ${check.what}; retrying from a fresh IP`);
      }
      const evidence = await capture(request, response, body);
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
      const probe = request.userData.sampleProbe === true;
      tally(request, 'requests');
      try {
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
        enqueue: (...requests) => queued.push(...(probe ? requests.map((r) => ({ ...r, userData: { sample: request.userData.sample, ...r.userData, sampleProbe: true } })) : requests)),
        emit: (row, kind) => {
          if (again) return;
          emit(requestKey, row, kind, null, probe);
          tally(request, 'rows');
        },
        expect: (kind, count) => {
          if (again || probe) return;
          state.expected[kind] = (state.expected[kind] ?? 0) + count;
          expectedChanged = true;
        },
        // The site part saw a page that loaded but lacks the data it must hold: a
        // quiet block. Retried from a fresh session, so a fresh IP.
        blocked: (why) => {
          throw new Error(`blocked: ${why}`);
        },
      });
      } catch (err) {
        if (/^blocked\b/.test(err.message)) session?.retire();
        throw err;
      }
      if (stopping) await flush();
      else flushIfFull();
      // The source's totals are saved at once: after a resurrect, the list page that
      // gave them is already done and won't run again.
      if (expectedChanged) await save();
      state.enqueued = (state.enqueued ?? 0) + queued.length;
      if (queued.length) await addRequests(queued);
    },
    // A detail request that failed every retry still owes its rows: the site part can
    // attach them as `fallback` (list columns only), and they come out with the
    // missing columns blank and marked unavailable in their receipts.
    // Every failed attempt, before its retry: a site answering 5xx, 429 or timing out
    // is struggling, so ease off (see backOff below).
    async errorHandler(_context, error) {
      if (/\b(5\d\d|429)\b|timed? ?out|ETIMEDOUT|ECONNRESET/i.test(error.message)) backOff();
      if (tuning.retryPauseSecs) await new Promise((r) => setTimeout(r, tuning.retryPauseSecs * 1000));
    },
    async failedRequestHandler({ request }, error) {
      const reason = error.message.split('\n')[0];
      const what = request.userData.note ?? request.url;
      state.failed.push({ what, error: reason });
      tally(request, 'failed');
      const requestKey = keyOf(request);
      if (delivered.has(requestKey)) return;
      for (const { row, kind } of request.userData.fallback ?? []) emit(requestKey, row, kind, `${what} failed: ${reason}`, request.userData.sampleProbe === true);
      if (stopping) await flush();
      else flushIfFull();
    },
  });

  // Ease off a struggling site: halve the concurrency on server errors (at most every
  // 20 s), then climb back one step after each 30 s without one, up to the setting.
  let lastStruggle = 0;
  let lastChange = 0;
  function backOff() {
    const pool = crawler.autoscaledPool;
    const now = Date.now();
    lastStruggle = now;
    if (!pool || now - lastChange < 20_000 || pool.maxConcurrency <= 1) return;
    pool.maxConcurrency = Math.max(1, Math.floor(pool.maxConcurrency / 2));
    lastChange = now;
    console.log(`The site is answering with errors: easing off to ${pool.maxConcurrency} at a time`);
  }
  const recover = setInterval(() => {
    const pool = crawler.autoscaledPool;
    if (!pool || pool.maxConcurrency >= tuning.maxConcurrency) return;
    if (Date.now() - lastStruggle < 30_000 || Date.now() - lastChange < 30_000) return;
    pool.maxConcurrency += 1;
    lastChange = Date.now();
  }, 5000);

  status(true);
  // On a resurrected run Crawlee's request queue already knows which requests are
  // done, so the start requests are skipped and the queue carries on.
  await crawler.run([...probes, ...site.start].map(toRequest));
  clearInterval(timer);
  clearInterval(recover);
  await flush();

  // The checks read the dataset back, so they cover rows delivered before a resurrect.
  const rows = [];
  const receipts = [];
  await (await Actor.openDataset()).forEach((item) => {
    const { '#receipt': receipt, '#kind': _kind, '#partial': _partial, '#request': _request, '#probe': _probe, ...row } = item;
    rows.push(row);
    receipts.push(receipt);
  });

  const kinds = [...new Set([...Object.keys(state.expected), ...Object.keys(state.emitted)])];
  const completeness = kinds.map((kind) => ({ kind, expected: state.expected[kind] ?? null, got: state.emitted[kind] ?? 0 }));
  const samples = compareSamples(rows, spec.samples);
  // A sample that disagrees with a row is judged against the site's own data for that
  // record: the code's mistake, or the sample's (see compare.js). Lookups elsewhere are
  // searched in a test, where the responses are few.
  const load = (key) => evidenceStore.getValue(key);
  await settleWithEvidence(samples, spec.samples, (i) => recordData(receipts[i], load), testLimit === null ? new Set() : await valuesIn(captured, load));
  notOnSite(samples, probeStats);
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
    enqueued: state.enqueued ?? 0,
    robotsOverridden: state.robotsOverridden ?? 0,
    completeness,
    failed: state.failed,
    skipped: state.skipped,
    columnProblems: [...columnProblems],
    samples,
    testMode: testLimit === null ? null : { limit: testLimit, skippedRequests: testSkipped, sampleRequests: Array.isArray(site.sampleRequests) ? site.sampleRequests.length : null, probes: probeStats },
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
  if (state.robotsOverridden) console.log(`Fetched despite robots.txt, with the user's approval: ${state.robotsOverridden} requests`);
  if (duplicateRows) console.log(`Rows read twice (same values, same evidence): ${duplicateRows}`);
  for (const d of sourceDuplicates) {
    console.log(`The source lists this record ${d.times} times: ${JSON.stringify(Object.values(d.row).slice(0, 3))}`);
  }
  if (testLimit !== null) console.log(`Test mode: ${testSkipped} follow-up requests not run (limit ${testLimit}), so counts can't be checked`);
  console.log(`Columns: ${columnProblems.size ? [...columnProblems].join('; ') : 'match the spec'}`);
  console.log(`\nSamples (${samples.length}):\n${formatReport(samples)}`);

  return report;
}
