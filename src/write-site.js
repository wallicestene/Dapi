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
