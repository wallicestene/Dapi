// Code writer and test loop. Muse Spark writes a site part from the spec and the
// investigator's findings, the frame runs it, the tester checks it, and any failure
// goes back to Muse Spark to fix, up to MAX_ATTEMPTS times.
//
// Clean-room rule (SKILL.md, 2026-10-28): the writer never sees a hand-written site
// part. Its prompt holds only the frame's contract, general rules, the spec and the
// findings.
//
// Usage: node src/write-site.js <spec.json> <findings.json> <out.js>

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chat } from './meta.js';

const MAX_ATTEMPTS = 3;
const root = fileURLToPath(new URL('../', import.meta.url));

// Kept first and unchanged so the API can cache it.
const CONTRACT = `You write a "site part": one ES module that extracts a dataset from one website. A fixed frame runs it with Crawlee's HttpCrawler and handles requests, retries, evidence, receipts, completeness and checks. Your module only knows the site.

The module exports exactly two things:

export const start = [ request, ... ];   // the first requests
export async function handle(ctx) { ... } // called once per response

A request is a plain object: { url, method ('GET' default, or 'POST'), headers (object), payload (string body for POST), label (string you use to tell responses apart), note (names the record, e.g. 'profile of H.K.Designs (India) LLP': the user sees it when the request fails), userData (JSON-serializable data to carry along), fallback ([{ row, kind }]: for a detail request, the rows to deliver if it fails every retry, holding the list columns as traced values; the frame fills the other columns with blanks marked unavailable) }.

handle(ctx) receives:
- ctx.request: the request (ctx.request.label, ctx.request.userData).
- ctx.json: the parsed JSON response (undefined if not JSON). ctx.body: the raw text.
- ctx.$: the response loaded in cheerio, for HTML pages.
- ctx.embedded: data embedded in an HTML response's scripts, as [{ name, context, value }]. name is like 's7.0'; context is the text just before the data (e.g. '$("#memListTable-large").DataTable('), which says what it is. Names follow script order and change from one URL or day to the next, so NEVER hard-code a name: on every response, find each entry by a distinctive part of its context (e.g. 'memListTable-large'), then use that entry's name in trace paths.
- ctx.trace(path) -> a traced value from THIS response. A path is one of:
    'Data.3.Name' or '0.IssueName'        dots and indexes into ctx.json
    'embedded:s7.0.data.17.0'             into ctx.embedded's entry s7.0, then its value
    'css:<selector>' / 'css:<selector>@href'   text or attribute of the first match on the HTML page
    'css*:<selector>@href'                an array, one per match
  ctx.trace(path, fn) applies fn to the value; ctx.trace([pathA, pathB], (a, b) => ...) builds one value from several fields. Traced values record where each value came from: use trace for every value that comes from the response, never copy raw values into rows.
- ctx.emit(row, kind): outputs one row. row maps every spec column name (exact spelling) to a traced value, or to a plain string for constants and deliberate blanks. kind is a short label for what the row counts as, e.g. 'issue rows'.
- ctx.expect(kind, count): records how many rows of that kind the SOURCE says exist, from the source's own numbers (totals, per-record counts). Call it so the frame can report completeness. Calls add up.
- ctx.enqueue(request, ...): asks for more requests. It is synchronous; do not await it.

Traced values are plain JSON objects, so they can travel in a request's userData to a later response and be emitted from there, keeping their receipts.

Rules:
- Use the endpoints, payloads, record paths, keys and join from the findings. Don't invent endpoints.
- Every spec column in every row, spelled exactly as the spec. Constants as plain strings.
- Follow the spec's rules about what one row is, including rows for records with nothing to expand.
- Never drop a record silently: if the source says N exist, emit N or let the counts show the gap. If the source lists the same record twice, emit it as the source has it; the frame reports source duplicates to the user. Don't deduplicate unless the spec says to.
- Format values the way the spec's samples show them. Dates in .NET form "/Date(ms)/" are UTC milliseconds; "/Date(-62135596800000)/" means no date (empty). Decode HTML entities in text. Date ranges may be split by "-", "–", "—" or "to".
- Fetch each distinct detail request once. When several list records share one detail page, request it once, carry all their rows in userData, and emit them all from that response.
- When the findings list "siblings", the list is split into several tables with the same rows: read every one. A column saying which table or filter a row is under comes from that table's context, written the way the spec's samples write it.
- HTML detail pages: build each record's URL as the findings' urlFrom says (an href inside a list field may be HTML-escaped, e.g. "\\/"), request it with GET, and read columns with the findings' verified selectors. If a record has no detail URL, emit its row with the list columns. For every detail request, pass its rows as fallback, so a failed request still delivers them.
- Embedded and HTML text can hold entities like "&amp;": decode them.
- No other imports, no network calls of your own, no timers. Plain modern JavaScript.

Return the full module source in "code", and a short note on any assumption in "notes".`;

const SCHEMA = {
  type: 'object',
  properties: { code: { type: 'string' }, notes: { type: 'string' } },
  required: ['code', 'notes'],
  additionalProperties: false,
};

async function writeSite({ spec, findings, previous }) {
  const messages = [
    { role: 'system', content: CONTRACT },
    { role: 'user', content: JSON.stringify({ spec, findings }) },
  ];
  if (previous) {
    messages.push({ role: 'assistant', content: JSON.stringify({ code: previous.code, notes: '' }) });
    messages.push({
      role: 'user',
      content: `The frame ran this module and the checks failed. Fix it and return the full corrected module.\n${previous.feedback}`,
    });
  }
  const { content, usage } = await chat({ messages, schema: { name: 'site_part', schema: SCHEMA }, timeoutMs: 300_000 });
  return { ...content, usage };
}

// Runs the site part through the frame in a child process, like a real run, and
// reads the frame's REPORT from local storage. In test mode the frame runs the
// samples' requests plus a few others, so an attempt stays quick and polite.
const TEST_LIMIT = 10;
function runLocally(sitePath, specPath) {
  fs.rmSync(path.join(root, 'storage/key_value_stores/default/REPORT.json'), { force: true });
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(root, 'src/frame/run.js'), sitePath, specPath, '--test', String(TEST_LIMIT)],
      { cwd: root, timeout: 15 * 60_000, maxBuffer: 50 * 1024 * 1024 },
      (err, stdout, stderr) => {
        let report = null;
        try {
          report = JSON.parse(fs.readFileSync(path.join(root, 'storage/key_value_stores/default/REPORT.json'), 'utf8'));
        } catch {
          // the run crashed before writing a report
        }
        resolve({ ok: !err, report, output: `${stdout}\n${stderr}`.trim() });
      }
    );
  });
}

// What counts as passing: complete, nothing failed, columns right, no sample failing.
// Whitespace and trailing-slash warnings are allowed (see the tester). In test mode,
// rows behind requests the frame didn't run can't be counted, so a shortfall is only
// a failure if nothing was held back.
export function verdict(report) {
  if (!report) return { passed: false, problems: ['the run crashed before writing a report'] };
  const problems = [];
  const heldBack = report.testMode?.skippedRequests > 0;
  for (const c of report.completeness) {
    if (c.expected === null) problems.push(`"${c.kind}": no expected count from the source (call expect)`);
    else if (c.got > c.expected) problems.push(`"${c.kind}": got ${c.got}, more than the ${c.expected} the source says exist`);
    else if (c.got < c.expected && !heldBack) problems.push(`"${c.kind}": got ${c.got} of ${c.expected}`);
  }
  if (!report.completeness.length) problems.push('no rows emitted');
  for (const f of report.failed) problems.push(`request failed: ${f.what}: ${f.error}`);
  if (report.duplicateRows > 0) {
    problems.push(`${report.duplicateRows} rows repeat another row's values AND evidence: the same data was read twice`);
  }
  for (const s of report.skipped ?? []) {
    problems.push(`robots.txt disallows ${s.url}, so the frame skipped it: request only URLs the findings give`);
  }
  for (const p of report.columnProblems) problems.push(p);
  for (const s of report.samples) {
    if (s.status === 'not found') problems.push(`sample "${s.label}" not found in the rows`);
    for (const c of s.checks.filter((check) => check.status === 'fail')) {
      problems.push(`sample "${s.label}", column "${c.column}": expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(String(c.actual))}`);
    }
  }
  return { passed: problems.length === 0, problems };
}

async function main() {
  const [specPath, findingsPath, outPath] = process.argv.slice(2);
  if (!specPath || !findingsPath || !outPath) {
    console.error('Usage: node src/write-site.js <spec.json> <findings.json> <out.js>');
    process.exit(1);
  }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const findings = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  let previous = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const started = Date.now();
    const written = await writeSite({ spec, findings, previous });
    fs.writeFileSync(outPath, written.code.endsWith('\n') ? written.code : `${written.code}\n`);
    const t = written.usage ?? {};
    console.log(`\nAttempt ${attempt}: wrote ${outPath} (${written.code.split('\n').length} lines, ${t.prompt_tokens} in / ${t.completion_tokens} out tokens, ${Math.round((Date.now() - started) / 1000)} s)`);
    if (written.notes) console.log(`  notes: ${written.notes}`);

    const run = await runLocally(path.resolve(outPath), path.resolve(specPath));
    const result = verdict(run.report);
    if (run.report) {
      console.log(`  rows ${run.report.rows}; ${run.report.completeness.map((c) => `${c.kind} ${c.got}/${c.expected}`).join('; ')}`);
      console.log(`  samples: ${run.report.samples.map((s) => `${s.label} ${s.status}`).join(', ')}`);
    }
    if (result.passed) {
      console.log(`  PASSED on attempt ${attempt}`);
      return;
    }
    console.log(`  failed:\n    ${result.problems.slice(0, 8).join('\n    ')}`);
    const crash = run.report ? '' : `\nThe run crashed. Output:\n${run.output.slice(-3000)}`;
    previous = { code: written.code, feedback: `Problems:\n- ${result.problems.join('\n- ')}${crash}` };
  }
  console.log(`\nGave up after ${MAX_ATTEMPTS} attempts.`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
