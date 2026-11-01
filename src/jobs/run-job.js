// Runs one job from spec to delivered dataset, writing what the agent does to the job's
// folder as it goes (see store.js). The web app starts it as a child process and reads
// the folder; it can also run from the terminal.
//
// Steps: read the spec → investigate the site → write and test the extraction →
// the plan, which waits for the user's Go → run on Apify, copying rows as they land →
// foot the dataset against the source's own counts.
//
// Usage:
//   node src/jobs/run-job.js <jobId>                 run a job the web app created
//   node src/jobs/run-job.js --new <spec.pdf> [--go] create a job and run it; --go
//                                                   approves the plan without asking

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createJob, jobDir, readJson, writeJson, updateJob, emit } from './store.js';
import { readSpec } from '../read-spec.js';
import { investigate } from '../investigate.js';
import { writeAndTest } from '../write-site.js';
import { translateValues } from '../translate.js';
import { compareSamples } from '../compare.js';

const language = (code) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
};

const args = process.argv.slice(2);
let id = args[0];
if (id === '--new') {
  ({ id } = createJob(args[1]));
  console.log(`job ${id}: ${jobDir(id)}`);
}
const autoGo = args.includes('--go');
const dir = jobDir(id);
const job = readJson(dir, 'job.json');
if (!job) {
  console.error(`No job ${id}`);
  process.exit(1);
}

const say = (step, event) => {
  const line = emit(dir, { step, ...event });
  if (line.text) console.log(`[${step}] ${line.text}`);
  return line;
};
const step = (name) => updateJob(dir, { step: name, status: 'running' });

try {
  // 1. The spec.
  step('spec');
  say('spec', { kind: 'start', text: 'Reading your spec.' });
  const { spec, problems } = await readSpec(path.join(dir, job.input));
  writeJson(dir, 'spec.json', spec);
  updateJob(dir, { title: spec.title, sourceUrl: spec.sourceUrl, rowUnit: spec.rowUnit });
  say('spec', {
    kind: 'read',
    text: `${spec.columns.length} columns, ${spec.samples.length} sample row${spec.samples.length === 1 ? '' : 's'}; each row is ${spec.rowUnit}.`,
    columns: spec.columns.map((c) => ({ name: c.name, constant: c.constant })),
    samples: spec.samples.map((s) => s.label),
    rules: spec.rules,
    questions: spec.questions,
    personalData: spec.personalData ?? [],
    corrections: spec.corrections ?? [],
    problems,
  });

  // 2. The site.
  step('site');
  say('site', { kind: 'start', text: `Investigating ${spec.sourceUrl}: watching what the page loads before reading any of it.` });
  const findings = await investigate(spec, { onEvent: (e) => say('site', e) });
  writeJson(dir, 'findings.json', findings);
  const refusal = refuse(findings);
  if (refusal) {
    say('site', { kind: 'declined', text: refusal.text, reasons: refusal.reasons });
    updateJob(dir, { status: 'declined', declined: refusal.text });
    process.exit(0);
  }

  // The samples in the site's own words, when the investigation aligned them with a
  // record page: the extraction is written, tested and run against these; the user's
  // own samples are checked again after any translation.
  const runSpec = findings.sourceSamples ? { ...spec, samples: findings.sourceSamples } : spec;
  if (findings.sourceSamples) writeJson(dir, 'spec.source.json', runSpec);
  const runSpecPath = path.join(dir, findings.sourceSamples ? 'spec.source.json' : 'spec.json');

  // 3. The extraction: written by Muse Spark, tested against the spec's samples.
  step('code');
  say('code', { kind: 'start', text: 'Writing the extraction and testing it against your sample rows.' });
  let writerNotes = '';
  const written = await writeAndTest({
    spec: runSpec,
    specPath: runSpecPath,
    findings,
    outPath: path.join(dir, 'site.js'),
    onEvent: (e) => {
      if (e.kind === 'written') writerNotes = e.notes;
      say('code', { ...e, text: describeAttempt(e) });
    },
  });
  if (!written.passed) {
    say('code', { kind: 'failed', text: `The extraction still failed its checks after ${written.attempts} attempts, so Dapi stopped before running it.` });
    updateJob(dir, { status: 'failed', failed: 'The extraction did not pass its checks.' });
    process.exit(1);
  }

  // 4. The plan, and the user's Go.
  step('plan');
  // The extraction's own settings: the way in and the pace Muse Spark chose for this site.
  const { config = {} } = await import(`${pathToFileURL(path.join(dir, 'site.js')).href}?t=${Date.now()}`);
  const plan = makePlan(findings, config, writerNotes, spec);
  say('plan', { kind: 'plan', text: plan.text, ...plan });
  updateJob(dir, { status: 'waiting', records: plan.records });
  if (autoGo) writeJson(dir, 'approve.json', { go: true, robotsOverride: false, at: new Date().toISOString() });
  let approval;
  while (!(approval = readJson(dir, 'approve.json'))) await sleep(1000);
  if (!approval.go) {
    say('plan', { kind: 'cancelled', text: 'You stopped the job before it ran.' });
    updateJob(dir, { status: 'cancelled' });
    process.exit(0);
  }
  if (approval.robotsOverride) say('plan', { kind: 'robots-override', text: 'You approved fetching what robots.txt disallows. Every such request is marked in its receipt.' });

  // 5. The run.
  step('run');
  await runOnApify({ spec: runSpec, userSpec: spec, translate: findings.samples?.translate ?? null, robotsOverride: Boolean(approval.robotsOverride), records: plan.records });
} catch (err) {
  console.error(err);
  say(readJson(dir, 'job.json')?.step ?? 'spec', { kind: 'error', text: `Something broke: ${err.message.split('\n')[0]}` });
  updateJob(dir, { status: 'failed', failed: err.message.split('\n')[0] });
  process.exit(1);
}

// A plain no, before any code is written. Owner's line (2026-11-01): whatever the spec
// asks for and the site shows, Dapi collects, people's names and contacts included;
// blocks are worked through with fresh IPs and Apify's datacenter and residential
// proxies; a check that wants a person to click, solve or hold something is set aside.
function refuse(f) {
  const reasons = [];
  const tried = f.access?.attempts ?? [];
  if (!f.access?.via && tried.length) {
    const human = tried.find((a) => a.kind === 'human');
    reasons.push(
      human
        ? `Every way Dapi may use (${tried.map((a) => a.way).join(', ')}) met ${human.what}: a check only a person can pass. Dapi sets those aside.`
        : `The site blocked every way Dapi tried (${tried.map((a) => a.way).join(', ')}), each from a fresh IP.`
    );
  } else if (!f.list) {
    reasons.push("Neither the site's own data requests nor its embedded data hold the records. Reading the visible page alone is a route Dapi doesn't run yet.");
  }
  if (f.reachability && !f.reachability.recommendation) {
    const human = f.reachability.results?.some((r) => r.human);
    reasons.push(`From Apify's servers, where the run happens, the site refused every way: direct, datacenter and residential proxy${human ? ', with a check only a person can pass' : ''}.`);
  }
  if (!reasons.length) return null;
  return { text: "Dapi can't extract this source.", reasons };
}

function describeAttempt(e) {
  if (e.kind === 'written') return `Attempt ${e.attempt}: Muse Spark wrote the extraction (${e.lines} lines).`;
  if (!e.report) return `Attempt ${e.attempt}: the test run crashed.`;
  const samples = e.report.samples;
  const pass = samples.filter((s) => s.status === 'pass').length;
  const whys = samples.flatMap((s) => s.checks.filter((c) => c.status === 'warn').map((c) => c.why ?? 'spacing'));
  const words = { spacing: 'spacing differs', typo: 'a likely typo in the spec', column: 'a value typed under another column' };
  const notes = Object.keys(words).filter((w) => whys.includes(w)).map((w) => `${whys.filter((x) => x === w).length}× ${words[w]}`);
  const sampleText = `${pass} of ${samples.length} sample${samples.length === 1 ? '' : 's'} match exactly${notes.length ? `; the rest differ only by ${notes.join(', ')}` : ''}`;
  return e.passed
    ? `Attempt ${e.attempt} passed: ${e.report.rows} rows in the test run, ${sampleText}.`
    : `Attempt ${e.attempt} failed: ${e.problems[0]}${e.problems.length > 1 ? ` (and ${e.problems.length - 1} more)` : ''}. Fixing it.`;
}

// What the run will do, from the findings and the extraction's own settings.
function makePlan(f, config, notes, spec) {
  const records = Number(f.list.total?.value ?? f.list.recordCount + (f.list.siblings ?? []).reduce((n, s) => n + s.recordCount, 0));
  const details = f.detail ? records : 0;
  const requests = 1 + details;
  const rpm = Math.min(1200, Math.max(30, Number(config.maxRequestsPerMinute) || 600));
  const groups = (config.proxy?.groups ?? []).map((g) => g.toLowerCase());
  const proxy = groups.length ? `${groups.join(' + ')}${config.proxy.countryCode ? ` (${config.proxy.countryCode})` : ''}` : 'direct';
  const minutes = Math.max(1, Math.ceil(requests / rpm));
  const route = f.list.embedded ? 'embedded' : 'feed';
  const how = {
    feed: "the site's own data feed (JSON)",
    embedded: 'data embedded in the page',
  }[route];
  const detailHow = f.detail ? (f.detail.kind === 'html' ? ', then one page per record' : ', then one data request per record') : '';
  return {
    records,
    requests,
    minutes,
    route,
    detail: f.detail?.kind ?? null,
    proxy,
    pace: { concurrency: config.maxConcurrency ?? null, perMinute: rpm, retries: config.maxRetries ?? null },
    reasoning: notes,
    robotsQuestion: f.list.robotsBlocked ? `robots.txt disallows ${f.list.request.url}. Fetch it anyway?` : null,
    personalData: spec.personalData ?? [],
    translate: f.samples?.translate ? { from: language(f.samples.translate.from), to: language(f.samples.translate.to), columns: f.samples.translate.columns } : null,
    disputes: f.samples?.disputes ?? [],
    text: `The source lists ${records.toLocaleString('en-US')} records. Dapi will read ${how}${detailHow}: about ${requests.toLocaleString('en-US')} requests, roughly ${minutes} minute${minutes === 1 ? '' : 's'} on Apify, ${proxy === 'direct' ? 'directly from its servers' : `through Apify's ${proxy} proxy`}.`,
  };
}

async function runOnApify({ spec, userSpec, translate, robotsOverride, records }) {
  const { apify, RUNNER } = await import('../apify/client.js');
  const { username } = await apify.user('me').get();
  const run = await apify.actor(`${username}/${RUNNER}`).start(
    { siteCode: fs.readFileSync(path.join(dir, 'site.js'), 'utf8'), spec, robotsOverride },
    { memory: 2048, timeout: 3600 }
  );
  const links = {
    runUrl: `https://console.apify.com/actors/runs/${run.id}`,
    datasetUrl: `https://console.apify.com/storage/datasets/${run.defaultDatasetId}`,
  };
  updateJob(dir, { runId: run.id, datasetId: run.defaultDatasetId, storeId: run.defaultKeyValueStoreId, ...links, rows: 0 });
  say('run', { kind: 'started', text: 'Running on Apify now. Rows appear in your dataset as they are found.', runId: run.id, ...links });

  // Copy rows as they land, so the screen shows them without waiting for the end.
  const rowsPath = path.join(dir, 'rows.jsonl');
  let copied = 0;
  const copy = async () => {
    for (;;) {
      const { items } = await apify.dataset(run.defaultDatasetId).listItems({ offset: copied, limit: 1000 });
      if (!items.length) return;
      fs.appendFileSync(rowsPath, items.map((i) => JSON.stringify(i)).join('\n') + '\n');
      copied += items.length;
    }
  };

  let current = run;
  let firstRows = false;
  while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(current.status)) {
    await sleep(3000);
    current = await apify.run(run.id).get();
    await copy();
    // The frame's saved state holds the rows the source says exist (it learns them as
    // it reads), the footing figure the screen shows against the rows delivered.
    const state = (await apify.keyValueStore(run.defaultKeyValueStoreId).getRecord('DAPI_FRAME_STATE').catch(() => null))?.value;
    const expected = state ? Object.values(state.expected ?? {}).reduce((a, b) => a + b, 0) : null;
    updateJob(dir, { rows: copied, expected, failedRequests: state?.failed?.length ?? 0, runStatus: current.status, statusMessage: current.statusMessage ?? null });
    if (copied && !firstRows) {
      firstRows = true;
      say('run', { kind: 'rows', text: `First rows delivered: ${copied.toLocaleString('en-US')} so far.` });
    }
  }
  if (current.status !== 'SUCCEEDED') {
    say('run', { kind: 'stopped', text: `The run ended ${current.status.toLowerCase()} with ${copied.toLocaleString('en-US')} rows. Resurrect it on Apify to continue where it stopped.` });
    updateJob(dir, { status: 'stopped', runStatus: current.status });
    return;
  }

  // Dataset counts lag a few seconds after a run; copy until the report's count is in.
  const report = (await apify.keyValueStore(run.defaultKeyValueStoreId).getRecord('REPORT'))?.value;
  for (let i = 0; i < 30 && copied < (report?.rows ?? 0); i++) {
    await copy();
    if (copied < (report?.rows ?? 0)) await sleep(2000);
  }
  if (translate) await translateRows({ translate, userSpec, report });
  writeJson(dir, 'report.json', report);
  step('footed');
  const short = report.completeness.filter((c) => c.expected !== null && c.got < c.expected);
  say('footed', {
    kind: 'footed',
    text: short.length
      ? `Delivered ${report.rows.toLocaleString('en-US')} rows; short: ${short.map((c) => `${c.kind} ${c.got} of ${c.expected}`).join(', ')}. The missing ones are listed with reasons.`
      : `Delivered ${report.rows.toLocaleString('en-US')} rows: every row the source's own counts call for, from ${records.toLocaleString('en-US')} records. ${report.failed.length === 1 ? '1 request failed; its row came with what the list had and says why.' : report.failed.length ? `${report.failed.length} requests failed; their rows came with what the list had and say why.` : 'No request failed.'}`,
    completeness: report.completeness,
    failed: report.failed,
    partial: report.partial.length,
    sourceDuplicates: report.sourceDuplicates.length,
    captures: report.captures,
    resumed: report.resumed,
  });
  const expected = report.completeness.reduce((n, c) => n + (c.expected ?? 0), 0);
  updateJob(dir, { status: 'done', rows: copied, expected, failedRequests: report.failed.length, finishedAt: new Date().toISOString() });
}

// Translates the columns the client's samples translated, each distinct value once,
// keeping the site's own words in every row's "#original" for its receipt. Then the
// client's own samples are checked against what they'll actually receive.
async function translateRows({ translate, userSpec, report }) {
  const rowsPath = path.join(dir, 'rows.jsonl');
  const rows = fs.readFileSync(rowsPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const distinct = [...new Set(rows.flatMap((r) => translate.columns.map((c) => String(r[c] ?? ''))))].filter((v) => v.trim());
  say('run', { kind: 'translating', text: `Your samples are in ${language(translate.to)}; the site is in ${language(translate.from)}. Muse Spark is translating ${distinct.length.toLocaleString('en-US')} distinct values in ${translate.columns.join(', ')}, following your samples' wording.` });
  const { map } = await translateValues({ values: distinct, from: translate.from, to: translate.to, examples: translate.examples });
  for (const row of rows) {
    const original = {};
    for (const c of translate.columns) {
      const v = String(row[c] ?? '');
      if (!v || !map.has(v) || map.get(v) === v) continue;
      original[c] = v;
      row[c] = map.get(v);
    }
    if (Object.keys(original).length) row['#original'] = original;
  }
  fs.writeFileSync(rowsPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const columns = userSpec.columns.map((c) => c.name);
  report.sourceSamples = report.samples;
  report.samples = compareSamples(rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? '']))), userSpec.samples);
  report.translated = { from: translate.from, to: translate.to, columns: translate.columns, values: map.size };
  say('run', { kind: 'translated', text: `Translated ${map.size.toLocaleString('en-US')} values into ${language(translate.to)}. Every receipt keeps the site's own words; the Apify dataset holds them as the site has them.` });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
