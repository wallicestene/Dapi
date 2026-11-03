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
//   node src/jobs/run-job.js <jobId> --follow       attach to the job's Apify run as it is
//                                                   now (resurrected, or left unwatched)
//                                                   and see it to the end

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createJob, jobDir, readJson, writeJson, updateJob, emit } from './store.js';
import { readSpec } from '../read-spec.js';
import { investigate } from '../investigate.js';
import { writeAndTest } from '../write-site.js';
import { translateValues } from '../translate.js';
import { compareSamples } from '../compare.js';
import { planStrategy, forClient } from '../strategy.js';
import { runAgent, AGENT } from '../agent.js';
import { runChecks } from '../investigate/checks.js';

// The run watch (see runOnApify). Declared up here: the job runs at the top level,
// before declarations further down the file are initialised.
const REPAIRS = 2;
const CODE_ERROR = /TypeError|ReferenceError|SyntaxError|RangeError|is not a function|Cannot read propert|is not defined|Unexpected token/;
const STALL_MS = 5 * 60_000;

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
const follow = args.includes('--follow');
// Where a job starts again: '--from site' or '--from code' (after a pause between
// steps), and '--from-code' (trying the extraction again).
const from = args.includes('--from-code') ? 'code' : args.includes('--from') ? args[args.indexOf('--from') + 1] : null;
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
// So the web app can tell whether a runner is watching this job.
updateJob(dir, { runnerPid: process.pid });

// Anything that escapes every handler (a stray rejected promise from a closed browser
// page) still ends the job honestly: marked failed with the reason, and any run on
// Apify stopped, never a job that says "running" with nothing behind it.
async function crashed(err) {
  try {
    const { runId, runStatus } = readJson(dir, 'job.json') ?? {};
    if (runId && !['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(runStatus)) {
      const { apify } = await import('../apify/client.js');
      await apify.run(runId).abort({ gracefully: true }).catch(() => {});
    }
    say(readJson(dir, 'job.json')?.step ?? 'spec', { kind: 'error', text: `Something broke: ${String(err?.message ?? err).split('\n')[0]}` });
    updateJob(dir, { status: 'failed', failed: String(err?.message ?? err).split('\n')[0] });
  } finally {
    process.exit(1);
  }
}
process.on('unhandledRejection', crashed);
process.on('uncaughtException', crashed);

try {
  if (follow) {
    await followExisting();
    process.exit(0);
  }
  // Steps 1 and 2, or, when the job starts again later on, what they saved.
  const { spec, findings } = from === 'code' ? restartAtCode() : from === 'plan' ? saved() : await specAndSite(from);
  if (!from || from === 'site') holdIfAsked('code');
  const runSpec = findings.sourceSamples ? { ...spec, samples: findings.sourceSamples } : spec;
  const runSpecPath = path.join(dir, findings.sourceSamples ? 'spec.source.json' : 'spec.json');

  // 3. The extraction: written by Muse Spark, tested against the spec's samples. Back to
  // the plan after "Not now": the extraction that passed is kept, with its test.
  const written = from === 'plan' ? savedExtraction() : await codeStep(runSpec, runSpecPath, findings);
  const writerNotes = written.writerNotes;

  // 4. The plan, and the user's Go.
  step('plan');
  // The extraction's own settings: the way in and the pace Muse Spark chose for this site.
  const { config = {} } = await import(`${pathToFileURL(path.join(dir, 'site.js')).href}?t=${Date.now()}`);
  const plan = makePlan(findings, config, writerNotes, spec, written.report);
  say('plan', { kind: 'plan', text: plan.text, ...plan });
  updateJob(dir, { status: 'waiting', records: plan.records });
  if (autoGo) writeJson(dir, 'approve.json', { go: true, robotsOverride: false, at: new Date().toISOString() });
  let approval;
  while (!(approval = readJson(dir, 'approve.json'))) await sleep(1000);
  if (!approval.go) {
    say('plan', { kind: 'cancelled', text: 'Paused at the plan. The extraction is written and tested; ▶ on the Run step brings the plan back.' });
    updateJob(dir, { status: 'cancelled' });
    process.exit(0);
  }
  if (approval.robotsOverride) say('plan', { kind: 'robots-override', text: 'You approved fetching what robots.txt disallows. Every such request is marked in its receipt.' });


  // 5. The run.
  step('run');
  // Translation: from samples written through a translation, or from a language the
  // client asked for (a spoken "in English") that isn't the site's own.
  const asked = spec.outputLanguage && findings.siteLanguage && spec.outputLanguage !== findings.siteLanguage
    ? { from: findings.siteLanguage, to: spec.outputLanguage, columns: 'text', examples: [] }
    : null;
  await runOnApify({ spec: runSpec, userSpec: spec, translate: findings.samples?.translate ?? asked, robotsOverride: Boolean(approval.robotsOverride), records: plan.more ? null : plan.records, findings, specPath: runSpecPath });
} catch (err) {
  console.error(err);
  // A run left going on Apify with nothing watching it is stopped (its rows stay).
  const { runId, runStatus } = readJson(dir, 'job.json') ?? {};
  if (runId && !['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(runStatus)) {
    const { apify } = await import('../apify/client.js');
    await apify.run(runId).abort({ gracefully: true }).catch(() => {});
  }
  say(readJson(dir, 'job.json')?.step ?? 'spec', { kind: 'error', text: `Something broke: ${err.message.split('\n')[0]}` });
  updateJob(dir, { status: 'failed', failed: err.message.split('\n')[0] });
  process.exit(1);
}

function describeCheck(c) {
  if (c.tool === 'list-values') return `Counted every value of ${c.field} in the list`;
  if (c.tool === 'record-page') return `Opened the page of a record with ${c.field} = ${c.equals}`;
  if (c.tool === 'register') return `Asked the register about ${c.id || `a record with ${c.field} = ${c.equals}`}`;
  return `Read ${c.url}`;
}

// A plain no, before any code is written. Owner's line (2026-11-01): whatever the spec
// asks for and the site shows, Dapi collects, people's names and contacts included;
// blocks are worked through with fresh IPs and Apify's datacenter and residential
// proxies; a check that wants a person to click, solve or hold something is set aside.

// Steps 1 and 2: the spec, then the site (the first pass, Muse Wonder's investigation
// and its strategy). Their results are saved in the job folder, so the extraction can be
// tried again from them without redoing either.
async function specAndSite(from) {
  let spec;
  if (from === 'site') {
    spec = readJson(dir, 'spec.json');
    if (!spec) throw new Error('nothing saved to resume from');
    say('site', { kind: 'resume', text: 'Resuming: your spec is kept. Next, the site.' });
  } else {
    spec = await specStep();
    holdIfAsked('site');
  }
  const findings = await siteStep(spec);
  return { spec, findings };
}

// Step 1: the spec, read and saved.
async function specStep() {
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
  return spec;
}

// Step 2: the site (the first pass, Muse Wonder's investigation and its strategy).
async function siteStep(spec) {
  step('site');
  say('site', { kind: 'start', text: `Investigating ${spec.sourceUrl}: watching what the page loads before reading any of it.` });
  // The first pass never ends a job: if it breaks on something new, the agent takes over
  // from the spec and what little is known.
  let findings;
  try {
    findings = await investigate(spec, { onEvent: (e) => say('site', e) });
  } catch (err) {
    const where = String(err?.message ?? err).split('\n')[0];
    say('site', { kind: 'stopped-short', text: `Dapi's first pass broke on this site (${where}); Muse Wonder investigates from the start.` });
    findings = { spec: spec.title, sourceUrl: spec.sourceUrl, investigatedAt: new Date().toISOString(), list: null, detail: null, constants: spec.columns.filter((c) => c.constant !== null).map((c) => ({ column: c.name, value: c.constant })), unmapped: spec.columns.filter((c) => c.constant === null).map((c) => c.name), notes: [`The first pass broke: ${where}`], stoppedShort: where };
  }
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

  // The strategy: Muse Wonder, as an agent on Meta's Responses API, investigates what's
  // still open with its tools (web search, a look at a page, counts, record pages, the
  // register, endpoint tests) and submits the plan. If the agent fails, the
  // code-driven loop below plans instead.
  say('site', { kind: 'strategizing', text: `Muse Wonder (${AGENT}) is taking over the investigation as an agent: settling what's open with its tools, then planning the extraction column by column.` });
  let agentPlan = null;
  try {
    agentPlan = await runAgent({ spec, sourceSpec: runSpec, findings, onEvent: (e) => say('site', e) });
  } catch (err) {
    say('site', { kind: 'agent', tool: 'fallback', text: `The agent stopped (${err.message.split('\n')[0]}); Dapi plans with the step-by-step loop instead.` });
  }
  try {
    let strategy = agentPlan ?? (await planStrategy({ spec, sourceSpec: runSpec, findings }));
    // The agent loop: checks Muse Wonder asks for to settle gaps, then a second plan.
    if (strategy.checks?.length) {
      say('site', { kind: 'checks', text: `Muse Wonder wants ${strategy.checks.length} more look${strategy.checks.length === 1 ? '' : 's'} before it settles the plan: ${strategy.checks.map((c) => c.why).join(' ')}`, checks: strategy.checks });
      const results = await runChecks({ checks: strategy.checks, findings });
      for (const r of results) {
        say('site', { kind: 'check', text: `${describeCheck(r.check)}: ${r.found?.error ? `couldn't (${r.found.error})` : 'done'}.`, check: r.check, found: r.found });
      }
      findings.checks = results;
      strategy = await planStrategy({ spec, sourceSpec: runSpec, findings, checkResults: results });
    }
    // What the client reads, in their words; the code writer keeps Muse Wonder's own.
    strategy.client = await forClient(strategy);
    findings.strategy = strategy;
    writeJson(dir, 'findings.json', findings);
    say('site', {
      kind: 'strategy',
      text: strategy.client.summary,
      columns: strategy.columns,
      requests: strategy.requests,
      pace: strategy.pace,
      risks: strategy.client.risks,
      gaps: strategy.client.gaps,
      model: strategy.model,
    });
  } catch (err) {
    say('site', { kind: 'strategy-skipped', text: `Planning the strategy failed (${err.message.split('\n')[0]}); the code writer works from the findings directly.` });
  }
  return findings;
}

// Trying the extraction again, or resuming before it after a pause: the spec, the
// findings and Muse Wonder's strategy, as saved; Muse Spark writes the extraction.
function restartAtCode() {
  const spec = readJson(dir, 'spec.json');
  const findings = readJson(dir, 'findings.json');
  if (!spec || !findings) throw new Error('nothing saved to start again from');
  // How it was started says which: '--from code' resumes, '--from-code' tries again.
  const resumed = !args.includes('--from-code');
  updateJob(dir, { failed: null });
  say('code', {
    kind: 'restart',
    text: resumed ? "Resuming: your spec, the investigation and Muse Wonder's strategy are kept. Next, the extraction." : "Starting again from the extraction. The spec, the investigation and Muse Wonder's strategy are kept.",
  });
  return { spec, findings };
}

// A pause between steps, asked for while a step ran: that step has finished and saved
// everything the next one needs, so the job waits here with no process behind it (it
// survives a restart or a sleeping laptop), and Resume starts the next step from what
// was saved.
function holdIfAsked(next) {
  if (!readJson(dir, 'hold.json')) return;
  // Inside the function: the job runs at the top level, before later consts exist.
  const NEXT_STEP = { site: 'investigating the site', code: 'writing the extraction' };
  updateJob(dir, { status: 'held', heldBefore: next, holdRequested: false, runnerPid: null });
  say(next === 'site' ? 'spec' : 'site', { kind: 'held', text: `Paused before ${NEXT_STEP[next]}. Everything so far is saved; Resume carries on from there.` });
  process.exit(0);
}

// A run that ended without finishing: paused by the client (it continues with Resume),
// or stopped some other way (it continues with Resurrect). Either keeps the dataset,
// the queue and the saved state on Apify.
function endedEarly(outcome) {
  const paused = Boolean(readJson(dir, 'pause.json'));
  const rows = outcome.copied.toLocaleString('en-US');
  say('run', paused
    ? { kind: 'paused', text: `Paused with ${rows} rows delivered. Resume to carry on where it stopped: the dataset, the queue and the saved state are kept.` }
    : { kind: 'stopped', text: `The run ended ${outcome.runStatus.toLowerCase()} with ${rows} rows. Resurrect it to continue where it stopped.` });
  updateJob(dir, { status: 'stopped', runStatus: outcome.runStatus, paused });
}


// Step 3: the extraction, written by Muse Spark and tested against the samples.
async function codeStep(runSpec, runSpecPath, findings) {
  step('code');
  say('code', { kind: 'start', text: 'Writing the extraction and testing it against your sample rows.' });
  let writerNotes = '';
  const written = await writeAndTest({
    spec: runSpec,
    specPath: runSpecPath,
    findings,
    outPath: path.join(dir, 'site.js'),
    onEvent: (e) => {
      if (e.kind === 'written') writerNotes = e.forClient?.length ? e.forClient : e.notes;
      say('code', { ...e, text: describeAttempt(e) });
    },
  });
  if (!written.passed) {
    say('code', { kind: 'failed', text: `The extraction still failed its checks after ${written.attempts} attempts, so Dapi stopped before running it.` });
    updateJob(dir, { status: 'failed', failed: 'The extraction did not pass its checks.' });
    process.exit(1);
  }
  return { ...written, writerNotes };
}

// Back to the plan: the spec and the investigation as saved.
function saved() {
  const spec = readJson(dir, 'spec.json');
  const findings = readJson(dir, 'findings.json');
  if (!spec || !findings) throw new Error('nothing saved to go back to the plan from');
  return { spec, findings };
}

// The extraction that passed its test, as saved: the code in site.js, Muse Spark's lines
// for the client and the test's report, from the job's own events.
function savedExtraction() {
  if (!fs.existsSync(path.join(dir, 'site.js'))) throw new Error('no tested extraction saved');
  const events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const written = events.filter((e) => e.kind === 'written').at(-1);
  const tested = events.filter((e) => e.kind === 'tested' && e.passed).at(-1);
  if (!tested) throw new Error('no passing test saved');
  say('plan', { kind: 'resume', text: "Back to the plan: the extraction is written and tested. Press Go when you're ready." });
  return { passed: true, report: tested.report, writerNotes: written?.forClient?.length ? written.forClient : written?.notes ?? '' };
}

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
  }
  // No list from the first pass is not a refusal: the agent finishes the investigation.
  // A refusal from Apify's servers means every way in was refused (blocked, an error, or
  // HTTP 4xx/5xx), not that one answer lacked one record.
  const results = f.reachability?.results ?? [];
  const everyWayBlocked = results.length > 0 && results.every((r) => r.blocked || r.error || (r.status ?? 0) >= 400);
  if (f.reachability && !f.reachability.recommendation && everyWayBlocked) {
    const human = f.reachability.results?.some((r) => r.human);
    reasons.push(`From Apify's servers, where the run happens, the site refused every way: direct, datacenter and residential proxy${human ? ', with a check only a person can pass' : ''}.`);
  }
  if (!reasons.length) return null;
  return { text: "Dapi can't extract this source.", reasons };
}

function describeAttempt(e) {
  if (e.kind === 'written') return `Attempt ${e.attempt}: Muse Spark wrote the extraction (${e.lines} lines).`;
  if (e.kind === 'unwritten') return `Attempt ${e.attempt}: Muse Spark didn't answer (${e.error}), so this attempt is spent.`;
  if (!e.report) return `Attempt ${e.attempt}: the test run crashed.`;
  const samples = e.report.samples;
  const pass = samples.filter((s) => s.status === 'pass').length;
  const whys = samples.flatMap((s) => s.checks.filter((c) => c.status === 'warn').map((c) => c.why ?? 'spacing'));
  const words = { spacing: 'spacing differs', typo: 'a likely typo in the spec', column: 'a value typed under another column', dispute: "a sample value the site's data doesn't hold" };
  const notes = Object.keys(words).filter((w) => whys.includes(w)).map((w) => `${whys.filter((x) => x === w).length}× ${words[w]}`);
  const unreached = samples.filter((s) => s.status === 'not found').length;
  const missing = samples.filter((s) => s.why === 'not on the site').length;
  const sampleText = `${pass} of ${samples.length} sample${samples.length === 1 ? '' : 's'} match exactly${notes.length ? `; the rest differ only by ${notes.join(', ')}` : ''}${missing ? `; ${missing} ${missing === 1 ? "isn't" : "aren't"} on the site: Dapi asked the site for ${missing === 1 ? 'it' : 'them'} directly and got nothing back` : ''}${unreached ? `; ${unreached} couldn't be reached in a test (the site has no way to ask for one record), so the run's first rows are the check` : ''}`;
  return e.passed
    ? `Attempt ${e.attempt} passed: ${e.report.rows} rows in the test run, ${sampleText}.`
    : `Attempt ${e.attempt} failed: ${e.problems[0]}${e.problems.length > 1 ? ` (and ${e.problems.length - 1} more)` : ''}. Fixing it.`;
}

// Where the test found the client's samples at odds with the site's own data: values
// the site's data for that record doesn't hold, blanks where it has a value, records
// the site doesn't have. Dapi delivers what the site shows; the client sees why.
function testDisputes(report) {
  return (report?.samples ?? []).flatMap((s) =>
    s.why === 'not on the site'
      ? [{ label: s.label, column: null, sample: '', site: '', note: "Dapi asked the site for this record directly and it has none: the sample may be from an older version of the site, or an example." }]
      : s.checks.filter((c) => c.why === 'dispute').map((c) => ({ label: s.label, column: c.column, sample: c.expected, site: String(c.actual ?? ''), note: c.reason }))
  );
}

// What the run will do, from the findings and the extraction's own settings.
function makePlan(f, config, notes, spec, tested = null) {
  const records = f.list ? Number(f.list.total?.value ?? f.list.recordCount + (f.list.siblings ?? []).reduce((n, s) => n + s.recordCount, 0)) : null;
  // An HTML list may show only its first items, with more behind a next page or a
  // "Load more": the plan says so instead of passing the first page off as the total.
  const more = f.list?.html && (f.list.paging?.next || f.list.paging?.loadMore);
  // With a register behind the record pages, its batches replace most page loads; pages
  // are still needed for columns it doesn't hold, once per record or once per shared value.
  const up = f.detail?.upstream;
  // Detail requests only where the strategy still routes a column through them: Muse
  // Wonder may have found the value cheaper (FSSC: a suspension date from the feed).
  const routes = new Map((f.strategy?.columns ?? []).map((c) => [c.column, c.route]));
  const usesDetail = Object.keys(f.detail?.fields ?? {}).some((c) => !routes.size || ['page', 'shared-page', 'feed', 'register'].includes(routes.get(c)));
  const pageColumns = Object.keys(f.detail?.fields ?? {}).filter((c) => f.detail.fields[c].keys?.length && !up?.columns.includes(c));
  const perRecordPages = pageColumns.some((c) => !f.detail.fields[c].sameOnAllPages);
  // A paged list is a request per page (of the biggest size the server honours).
  const paging = f.list?.paging;
  const listRequests = paging?.total && !paging.bigPage?.onePage ? Math.ceil(paging.total / (paging.bigPage?.size ?? paging.pageSize ?? paging.total)) : 1;
  const details = !f.detail || !usesDetail
    ? 0
    : up
      ? up.apis.reduce((n, a) => n + (a.batch ? Math.ceil((records ?? 0) / a.batch.maxIds) : records ?? 0), 0) + (perRecordPages ? records ?? 0 : pageColumns.length ? 3 : 0)
      : records ?? 0;
  // When the first page isn't the whole list, Muse Wonder's strategy knows the requests.
  const requests = (more || !f.list) && f.strategy?.requests?.total ? f.strategy.requests.total : listRequests + details;
  // When the first pass only saw part of the list (or none), the route is the one Muse
  // Wonder found and verified: the plan says it in its words.
  const agentRoute = (more || !f.list) && f.strategy?.summary;
  const agentSummary = f.strategy?.client?.summary ?? f.strategy?.summary;
  const rpm = Math.min(1200, Math.max(30, Number(config.maxRequestsPerMinute) || 600));
  // The time estimate follows the measured pace at the chosen concurrency, when there is one.
  const level = (f.reachability?.pace?.levels ?? []).filter((l) => !l.errors && l.medianMs && l.concurrency <= (config.maxConcurrency ?? 4)).at(-1);
  const perMinute = Math.min(rpm, level ? (level.concurrency * 60_000) / level.medianMs : rpm);
  const groups = (config.proxy?.groups ?? []).map((g) => g.toLowerCase());
  const proxy = groups.length ? `${groups.join(' + ')}${config.proxy.countryCode ? ` (${config.proxy.countryCode})` : ''}` : 'direct';
  const minutes = Math.max(1, Math.ceil(requests / perMinute));
  const route = !f.list ? 'agent' : f.list.embedded ? 'embedded' : f.list.html ? 'html' : 'feed';
  const how = {
    feed: "the site's own data feed (JSON)",
    embedded: 'data embedded in the page',
    html: "the page's own HTML",
    agent: 'the sources Muse Wonder verified',
  }[route];
  const pagesHow = listRequests > 1 ? ` in ${listRequests.toLocaleString('en-US')} pages` : '';
  const detailHow = !f.detail || !usesDetail
    ? ''
    : up
      ? `, then ${up.apis[0].name}'s own API${up.apis.some((a) => a.batch) ? ' in batches' : ''}${perRecordPages ? ', and each record page' : pageColumns.length ? ', and a page per shared value' : ''}`
      : f.detail.kind === 'html'
        ? ', then one page per record'
        : ', then one data request per record';
  return {
    records,
    more: Boolean(more),
    requests,
    minutes,
    route,
    detail: usesDetail ? (f.detail?.kind ?? null) : null,
    proxy,
    pace: { concurrency: config.maxConcurrency ?? null, perMinute: rpm, retries: config.maxRetries ?? null },
    reasoning: notes,
    robotsQuestion: f.list?.robotsBlocked ? `robots.txt disallows ${f.list.request.url}. Fetch it anyway?` : null,
    personalData: spec.personalData ?? [],
    translate: f.samples?.translate ? { from: language(f.samples.translate.from), to: language(f.samples.translate.to), columns: f.samples.translate.columns } : null,
    disputes: [...(f.samples?.disputes ?? []), ...testDisputes(tested)],
    // What Muse Wonder couldn't settle: the client sees it before pressing Go.
    unsettled: (f.strategy?.client?.gaps ?? f.strategy?.gaps ?? []).slice(0, 3),
    text: agentRoute
      ? `${records === null ? '' : `The page shows ${records.toLocaleString('en-US')} records${more ? `, with more behind ${f.list.paging.next ? 'its next pages' : `“${f.list.paging.loadMore}”`}` : ''}. `}${agentSummary} ${proxy === 'direct' ? 'Directly from Apify\'s servers.' : `Through Apify\'s ${proxy} proxy.`}`
      : `${records === null ? "Muse Wonder's strategy sets the route." : more ? `The page shows ${records.toLocaleString('en-US')} records, with more behind ${f.list.paging.next ? 'its next pages' : `“${f.list.paging.loadMore}”`}.` : `The source lists ${records.toLocaleString('en-US')} records.`} Dapi will read ${how}${pagesHow}${detailHow}: about ${requests.toLocaleString('en-US')} requests, roughly ${minutes} minute${minutes === 1 ? '' : 's'} on Apify, ${proxy === 'direct' ? 'directly from its servers' : `through Apify's ${proxy} proxy`}.`,
  };
}

// Runs the extraction on Apify and watches it. A run that breaks (the code throws, many
// requests fail, nothing moves, rows miss columns) is stopped at once rather than left
// to finish badly; Muse Spark gets the reason and the run's own log, fixes the code or
// its settings, the fix is tested again, and a fresh run starts. Up to two repairs.
async function runOnApify({ spec, userSpec, translate, robotsOverride, records, findings, specPath }) {
  const { apify, RUNNER } = await import('../apify/client.js');
  const { username } = await apify.user('me').get();
  for (let attempt = 1; ; attempt++) {
    const outcome = await runOnce({ apify, actor: `${username}/${RUNNER}`, spec, robotsOverride, attempt });
    if (outcome.status === 'succeeded') return finish({ apify, ...outcome, userSpec, translate, records, disputes: findings.samples?.disputes ?? [] });
    if (outcome.status === 'stopped') return endedEarly(outcome);
    // Broken. Some breaks aren't the code's to fix: a site that asks for a person.
    if (outcome.noRepair || attempt > REPAIRS) {
      say('run', { kind: 'broken', text: `${outcome.reason} ${outcome.noRepair ? 'Dapi sets this site aside.' : `Stopped after ${REPAIRS} repairs; the log is in the run on Apify.`}`, log: outcome.log });
      updateJob(dir, { status: 'failed', failed: outcome.reason });
      return;
    }
    say('run', { kind: 'repairing', text: `${outcome.reason} Dapi stopped the run (the rows so far stay in its dataset) and gave Muse Spark the run's log to fix it.`, log: outcome.log });
    const fixed = await writeAndTest({
      spec,
      specPath,
      findings,
      outPath: path.join(dir, 'site.js'),
      previous: { code: fs.readFileSync(path.join(dir, 'site.js'), 'utf8'), feedback: outcome.feedback },
      attempts: 2,
      onEvent: (e) => say('code', { ...e, repair: attempt, text: `Repair ${attempt}: ${describeAttempt(e)}` }),
    });
    if (!fixed.passed) {
      say('run', { kind: 'broken', text: "Muse Spark's repair didn't pass the tests, so Dapi stopped here rather than run broken code." });
      updateJob(dir, { status: 'failed', failed: outcome.reason });
      return;
    }
    fs.rmSync(path.join(dir, 'rows.jsonl'), { force: true });
    say('run', { kind: 'restarting', text: 'The repaired extraction passed its tests. Starting a fresh run.' });
  }
}

async function runOnce({ apify, actor, spec, robotsOverride, attempt }) {
  const run = await apify.actor(actor).start(
    { siteCode: fs.readFileSync(path.join(dir, 'site.js'), 'utf8'), spec, robotsOverride },
    { memory: 2048, timeout: 3600 }
  );
  const links = {
    runUrl: `https://console.apify.com/actors/runs/${run.id}`,
    datasetUrl: `https://console.apify.com/storage/datasets/${run.defaultDatasetId}`,
  };
  updateJob(dir, { runId: run.id, datasetId: run.defaultDatasetId, storeId: run.defaultKeyValueStoreId, ...links, rows: 0, runAttempt: attempt });
  say('run', { kind: 'started', text: `${attempt > 1 ? `Run ${attempt}: ` : ''}Running on Apify now. Rows appear in your dataset as they are found.`, runId: run.id, attempt, ...links });
  return watchRun({ apify, run, fresh: true });
}

// What Apify itself reports about a run, kept on the job.
function apifyFacts(r) {
  return {
    status: r.status,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt ?? null,
    seconds: r.stats?.runTimeSecs ?? null,
    computeUnits: r.stats?.computeUnits ?? null,
    usd: r.usageTotalUsd ?? null,
    migrations: r.stats?.migrationCount ?? 0,
    restarts: r.stats?.restartCount ?? 0,
    resurrects: r.stats?.resurrectCount ?? 0,
  };
}

// Watches a run to its end: copies rows as they land, passes on what Apify and the
// frame report, and stops the run if it breaks. `fresh` is false when attaching to a
// run already under way (resurrected, or left unwatched): rows already copied stay.
async function watchRun({ apify, run, fresh }) {

  // The run's own log, line by line as Apify writes it.
  const log = [];
  const stream = await apify.run(run.id).log().stream().catch(() => null);
  if (stream) {
    let rest = '';
    stream.on('data', (chunk) => {
      const lines = (rest + chunk.toString()).split('\n');
      rest = lines.pop();
      log.push(...lines.filter((l) => l.trim()));
      if (log.length > 5000) log.splice(0, log.length - 5000);
    });
    stream.on('error', () => {});
  }

  // Copy rows as they land, so the screen shows them without waiting for the end.
  const rowsPath = path.join(dir, 'rows.jsonl');
  let copied = fresh || !fs.existsSync(rowsPath) ? 0 : fs.readFileSync(rowsPath, 'utf8').split('\n').filter(Boolean).length;
  const copy = async () => {
    for (;;) {
      const { items } = await apify.dataset(run.defaultDatasetId).listItems({ offset: copied, limit: 1000 });
      if (!items.length) return;
      fs.appendFileSync(rowsPath, items.map((i) => JSON.stringify(i)).join('\n') + '\n');
      copied += items.length;
    }
  };

  let current = run;
  let firstRows = copied > 0;
  let lastProgress = Date.now();
  let lastMark = '';
  let easedNoted = 0;
  const seen = { migrations: run.stats?.migrationCount ?? 0, restarts: run.stats?.restartCount ?? 0, resurrects: run.stats?.resurrectCount ?? 0 };
  try {
    while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(current.status)) {
      await sleep(3000);
      current = await apify.run(run.id).get();
      await copy();
      // Apify's own events: a move to another server, a restart, a resurrect.
      const facts = apifyFacts(current);
      if (facts.migrations > seen.migrations) say('run', { kind: 'apify', text: `Apify moved the run to another server (${facts.migrations}×); it carried on where it was, nothing lost.` });
      if (facts.restarts > seen.restarts) say('run', { kind: 'apify', text: 'The run restarted on Apify and carried on from its saved state.' });
      if (facts.resurrects > seen.resurrects) say('run', { kind: 'apify', text: 'The run was resurrected on Apify and carried on where it stopped.' });
      Object.assign(seen, { migrations: facts.migrations, restarts: facts.restarts, resurrects: facts.resurrects });
      updateJob(dir, { apify: facts });
      // The frame's saved state holds the rows the source says exist (it learns them as
      // it reads), the footing figure the screen shows against the rows delivered.
      const state = (await apify.keyValueStore(run.defaultKeyValueStoreId).getRecord('DAPI_FRAME_STATE').catch(() => null))?.value;
      const expected = state ? Object.values(state.expected ?? {}).reduce((a, b) => a + b, 0) : null;
      updateJob(dir, { rows: copied, expected, failedRequests: state?.failed?.length ?? 0, runStatus: current.status, statusMessage: current.statusMessage ?? null });
      if (copied && !firstRows) {
        firstRows = true;
        say('run', { kind: 'rows', text: `First rows delivered: ${copied.toLocaleString('en-US')} so far.` });
      }
      // What the frame said about the site's health, passed on as it happens.
      const eased = log.filter((l) => /easing off to \d+/.test(l));
      if (eased.length > easedNoted) {
        easedNoted = eased.length;
        say('run', { kind: 'watch', text: `The site started answering with errors, so the run eased off: ${eased.at(-1).match(/easing off to \d+ at a time/)[0]}.` });
      }

      const broken = assess({ state, current, log, copied, lastProgress });
      const mark = `${copied}|${current.statusMessage}|${log.length}`;
      if (mark !== lastMark) {
        lastMark = mark;
        lastProgress = Date.now();
      }
      if (broken) {
        await apify.run(run.id).abort({ gracefully: true }).catch(() => {});
        for (let i = 0; i < 40 && !['ABORTED', 'SUCCEEDED', 'FAILED', 'TIMED-OUT'].includes(current.status); i++) {
          await sleep(3000);
          current = await apify.run(run.id).get();
        }
        recordFinish(current);
        return { status: 'broken', ...broken, ...evidence(log, state, broken.reason) };
      }
    }
  } finally {
    stream?.destroy();
  }
  recordFinish(current);
  if (current.status === 'FAILED' || current.status === 'TIMED-OUT') {
    const reason = current.status === 'FAILED' ? 'The run crashed on Apify.' : 'The run hit its time limit on Apify.';
    return { status: 'broken', reason, ...evidence(log, null, reason) };
  }
  if (current.status !== 'SUCCEEDED') return { status: 'stopped', runStatus: current.status, copied };
  return { status: 'succeeded', run, copied, copy };
}

// Apify's own account of a finished run: how it ended, how long, what it cost.
function recordFinish(r) {
  const f = apifyFacts(r);
  updateJob(dir, { apify: f, runStatus: r.status });
  const extras = [f.migrations && `moved servers ${f.migrations}×`, f.resurrects && `resurrected ${f.resurrects}×`].filter(Boolean);
  say('run', {
    kind: 'apify-finished',
    text: `Apify reports the run ${r.status.toLowerCase().replace('-', ' ')}${f.seconds !== null ? ` after ${Math.round(f.seconds)} s` : ''}${f.computeUnits !== null ? `, ${f.computeUnits.toFixed(3)} compute units` : ''}${f.usd !== null ? `, $${f.usd.toFixed(3)}` : ''}${extras.length ? `; ${extras.join(', ')}` : ''}.`,
    ...f,
  });
}

// Attach to the job's run as it is now: a run resurrected on Apify after Dapi stopped
// watching, or one left running when its runner stopped. Sees it to the end like a
// fresh run, without repairs: the code was already tested and approved.
async function followExisting() {
  const { apify } = await import('../apify/client.js');
  const current = readJson(dir, 'job.json');
  const spec = readJson(dir, 'spec.json');
  const findings = readJson(dir, 'findings.json');
  const run = await apify.run(current.runId).get();
  step('run');
  say('run', { kind: 'following', text: `Dapi is following the run on Apify again (it is ${run.status.toLowerCase()}).` });
  const outcome = await watchRun({ apify, run, fresh: false });
  if (outcome.status === 'succeeded') {
    return finish({ apify, ...outcome, userSpec: spec, translate: findings?.samples?.translate ?? null, records: current.records ?? outcome.copied, disputes: findings?.samples?.disputes ?? [] });
  }
  if (outcome.status === 'stopped') {
    endedEarly(outcome);
    return;
  }
  say('run', { kind: 'broken', text: outcome.reason, log: outcome.log });
  updateJob(dir, { status: 'failed', failed: outcome.reason });
}

// Whether a running extraction is broken, from its saved state and its log.
function assess({ state, current, log, copied, lastProgress }) {
  const crawled = Number(current.statusMessage?.match(/Crawled (\d+)\//)?.[1] ?? 0);
  const failed = state?.failed ?? [];
  if (state?.columnProblems?.length) return { reason: `Rows don't match the spec's columns: ${state.columnProblems[0]}.` };
  const human = failed.filter((f) => /human check|only a person/i.test(f.error));
  if (human.length >= 5 && human.length > crawled * 0.3) return { reason: `The site asks for a check only a person can pass on ${human.length} pages.`, noRepair: true };
  const codeErrors = log.filter((l) => CODE_ERROR.test(l));
  if (codeErrors.length >= 5) return { reason: `The extraction code is throwing errors (${codeErrors.length} so far).` };
  if (failed.length >= 10 && failed.length > Math.max(1, crawled) * 0.2) return { reason: `${failed.length} requests failed every retry out of ${crawled} done.` };
  if (Date.now() - lastProgress > STALL_MS) return { reason: `Nothing has moved for ${Math.round(STALL_MS / 60_000)} minutes (${copied} rows).` };
  return null;
}

// What Muse Spark gets to fix a broken run: the reason, the run's warnings and errors
// (repeats counted once), and the frame's own record of what failed.
function evidence(log, state, reason) {
  const seen = new Map();
  for (const line of log) {
    if (!/WARN|ERROR|Error|error|easing off|blocked|failed/.test(line)) continue;
    const key = line.replace(/^\S+\s+/, '').replace(/\d+/g, '#').slice(0, 160);
    seen.set(key, { line: line.slice(0, 400), times: (seen.get(key)?.times ?? 0) + 1 });
  }
  const lines = [...seen.values()].slice(-40).map((e) => (e.times > 1 ? `${e.line}   (×${e.times})` : e.line));
  const failed = (state?.failed ?? []).slice(0, 15).map((f) => `${f.what}: ${f.error}`);
  const feedback = [
    `The full run on Apify broke: ${reason}`,
    failed.length ? `Requests that failed every retry:\n- ${failed.join('\n- ')}` : '',
    lines.length ? `The run's warnings and errors:\n${lines.join('\n')}` : '',
    'Fix the cause: the code, or its config (pace, retries, proxy) if the site was struggling or refusing. Return the full module.',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { feedback, log: lines.slice(-12) };
}

async function finish({ apify, run, copied: copiedSoFar, copy, userSpec, translate, records, disputes }) {
  let copied = copiedSoFar;
  // Dataset counts lag a few seconds after a run; copy until the report's count is in.
  const report = (await apify.keyValueStore(run.defaultKeyValueStoreId).getRecord('REPORT'))?.value;
  const count = () => (fs.existsSync(path.join(dir, 'rows.jsonl')) ? fs.readFileSync(path.join(dir, 'rows.jsonl'), 'utf8').split('\n').filter(Boolean).length : 0);
  for (let i = 0; i < 30 && count() < (report?.rows ?? 0); i++) {
    await copy();
    if (count() < (report?.rows ?? 0)) await sleep(2000);
  }
  copied = count();
  if (translate) await translateRows({ translate, userSpec, report, disputes });
  writeJson(dir, 'report.json', report);
  step('footed');
  const short = report.completeness.filter((c) => c.expected !== null && c.got < c.expected);
  say('footed', {
    kind: 'footed',
    text: short.length
      ? `Delivered ${report.rows.toLocaleString('en-US')} rows; short: ${short.map((c) => `${c.kind} ${c.got} of ${c.expected}`).join(', ')}. The missing ones are listed with reasons.`
      : `Delivered ${report.rows.toLocaleString('en-US')} rows: every row the source's own counts call for, from ${(records ?? report.rows).toLocaleString('en-US')} records. ${report.failed.length === 1 ? '1 request failed; its row came with what the list had and says why.' : report.failed.length ? `${report.failed.length} requests failed; their rows came with what the list had and say why.` : 'No request failed.'}`,
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
async function translateRows({ translate, userSpec, report, disputes }) {
  const rowsPath = path.join(dir, 'rows.jsonl');
  const rows = fs.readFileSync(rowsPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  // "text": every column whose values read as words, not numbers, codes or links.
  if (translate.columns === 'text') {
    const constants = new Set(userSpec.columns.filter((c) => c.constant !== null).map((c) => c.name));
    translate = {
      ...translate,
      columns: userSpec.columns
        .map((c) => c.name)
        .filter((c) => !constants.has(c))
        .filter((c) => {
          const values = rows.map((r) => String(r[c] ?? '')).filter(Boolean).slice(0, 50);
          return values.length && values.filter((v) => /\p{L}{3}/u.test(v) && !/^https?:|@/.test(v)).length / values.length > 0.6;
        }),
    };
  }
  const distinct = [...new Set(rows.flatMap((r) => translate.columns.map((c) => String(r[c] ?? ''))))].filter((v) => v.trim());
  const why = translate.examples.length ? `Your samples are in ${language(translate.to)}` : `You asked for ${language(translate.to)}`;
  say('run', { kind: 'translating', text: `${why}; the site is in ${language(translate.from)}. Muse Spark is translating ${distinct.length.toLocaleString('en-US')} distinct values in ${translate.columns.join(', ')}${translate.examples.length ? ", following your samples' wording" : ''}.` });
  let map;
  let failed = [];
  try {
    ({ map, failed } = await translateValues({ values: distinct, from: translate.from, to: translate.to, examples: translate.examples }));
  } catch (err) {
    // The rows are delivered either way: they stay in the site's language.
    say('run', { kind: 'watch', text: `Translation didn't finish (${err.message.split('\n')[0]}); the rows stay in ${language(translate.from)}, as the site has them.` });
    return;
  }
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
  // Where the investigation found the site itself contradicts the sample, the site's
  // value is what's delivered: a known disagreement, not a failure.
  for (const s of report.samples) {
    for (const c of s.checks) {
      const d = disputes.find((x) => x.column === c.column);
      if (c.status === 'fail' && d && String(c.actual) === d.site) Object.assign(c, { status: 'warn', why: 'site' });
    }
    if (s.status === 'fail' && !s.checks.some((c) => c.status === 'fail')) s.status = 'warn';
  }
  report.translated = { from: translate.from, to: translate.to, columns: translate.columns, values: map.size };
  say('run', {
    kind: 'translated',
    text: `Translated ${map.size.toLocaleString('en-US')} values into ${language(translate.to)}${failed.length ? `; ${failed.length} couldn't be and stay in ${language(translate.from)}` : ''}. Every receipt keeps the site's own words; the Apify dataset holds them as the site has them.`,
    untranslated: failed.slice(0, 20),
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
