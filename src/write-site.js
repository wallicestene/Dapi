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

// The rules Muse Spark writes under live in a document the owner can read and edit.
// Kept first and unchanged so the API can cache it.
const CONTRACT = fs.readFileSync(new URL('./prompts/site-part-rules.md', import.meta.url), 'utf8');

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
export function verdict(report, findings = null) {
  if (!report) return { passed: false, problems: ['the run crashed before writing a report'] };
  const problems = [];
  // Said plainly, because empty columns alone don't say why.
  if (findings?.detail && !report.enqueued) {
    const cols = Object.keys(findings.detail.fields ?? {}).join(', ');
    problems.push(`no detail request was ever made, but the findings say ${cols} come from detail ${findings.detail.kind === 'html' ? 'pages' : 'requests'}: check how detail URLs or payloads are built (traced values hold their plain value in .value)`);
  }
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
  // A sample the test couldn't reach: on a big paged list it sits past the pages a test
  // reads. The site part reaches it directly with sampleRequests, or says there's no
  // way to (an empty list), and the sample is then "not reached", not failed.
  const lookups = report.testMode?.sampleRequests ?? null;
  for (const s of report.samples) {
    if (s.status === 'not found' && heldBack && lookups === null) {
      problems.push(`sample "${s.label}" not found: the test read only the start requests and ${report.testMode.limit} follow-ups (${report.testMode.skippedRequests} not run), so its record was never fetched. Export sampleRequests that reach each sample's record directly (the site's own search or filter by an ID or name the findings verified), or sampleRequests = [] if the site has no such way`);
    } else if (s.status === 'not found' && lookups > 0) {
      problems.push(`sample "${s.label}" not found, even with sampleRequests: check they ask for this sample's record and that handle emits rows from their responses`);
    } else if (s.status === 'not found' && !(heldBack && lookups === 0)) {
      problems.push(`sample "${s.label}" not found in the rows`);
    }
    for (const c of s.checks.filter((check) => check.status === 'fail')) {
      problems.push(`sample "${s.label}", column "${c.column}": expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(String(c.actual))}${c.hint ? ` (${c.hint})` : ''}`);
    }
  }
  return { passed: problems.length === 0, problems };
}

// Writes the site part to outPath and tests it, fixing it from the checks' feedback up
// to `attempts` times. Each attempt is reported to onEvent as it finishes. With
// `previous` ({ code, feedback }), it starts by repairing that code: a run that broke
// on Apify comes back here with its log.
export async function writeAndTest({ spec, specPath, findings, outPath, onEvent = () => {}, previous = null, attempts = MAX_ATTEMPTS }) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const started = Date.now();
    const written = await writeSite({ spec, findings, previous });
    fs.writeFileSync(outPath, written.code.endsWith('\n') ? written.code : `${written.code}\n`);
    const t = written.usage ?? {};
    onEvent({
      kind: 'written',
      attempt,
      lines: written.code.split('\n').length,
      notes: written.notes,
      tokens: { in: t.prompt_tokens ?? 0, out: t.completion_tokens ?? 0 },
      seconds: Math.round((Date.now() - started) / 1000),
    });

    const run = await runLocally(path.resolve(outPath), path.resolve(specPath));
    const result = verdict(run.report, findings);
    onEvent({ kind: 'tested', attempt, passed: result.passed, problems: result.problems, report: run.report });
    if (result.passed) return { passed: true, attempts: attempt, report: run.report };
    const crash = run.report ? '' : `\nThe run crashed. Output:\n${run.output.slice(-3000)}`;
    previous = { code: written.code, feedback: `Problems:\n- ${result.problems.join('\n- ')}${crash}` };
  }
  return { passed: false, attempts };
}

async function main() {
  const [specPath, findingsPath, outPath] = process.argv.slice(2);
  if (!specPath || !findingsPath || !outPath) {
    console.error('Usage: node src/write-site.js <spec.json> <findings.json> <out.js>');
    process.exit(1);
  }
  const result = await writeAndTest({
    spec: JSON.parse(fs.readFileSync(specPath, 'utf8')),
    specPath,
    findings: JSON.parse(fs.readFileSync(findingsPath, 'utf8')),
    outPath,
    onEvent(e) {
      if (e.kind === 'written') {
        console.log(`\nAttempt ${e.attempt}: wrote ${outPath} (${e.lines} lines, ${e.tokens.in} in / ${e.tokens.out} out tokens, ${e.seconds} s)`);
        if (e.notes) console.log(`  notes: ${e.notes}`);
        return;
      }
      if (e.report) {
        console.log(`  rows ${e.report.rows}; ${e.report.completeness.map((c) => `${c.kind} ${c.got}/${c.expected}`).join('; ')}`);
        console.log(`  samples: ${e.report.samples.map((s) => `${s.label} ${s.status}`).join(', ')}`);
      }
      if (e.passed) console.log(`  PASSED on attempt ${e.attempt}`);
      else console.log(`  failed:\n    ${e.problems.slice(0, 8).join('\n    ')}`);
    },
  });
  if (!result.passed) {
    console.log(`\nGave up after ${MAX_ATTEMPTS} attempts.`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
