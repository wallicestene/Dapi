// Investigator: finds where a spec's data really lives. Loads the page, watches its
// JSON traffic, and asks Muse Spark which endpoint holds which columns. When columns
// are still missing, it finds a sample record's row on the page, lets Muse Spark pick
// the control that reveals more (from a screenshot and the numbered controls), clicks
// it, and works out how the new request joins to the list. Writes
// <spec>.findings.json for the code writer.
// Usage: node src/investigate.js <spec.json>

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openPage, findRecordRow, clickablesIn } from './investigate/browser.js';
import { isTracker, findRecords, findTotal, shrink, at } from './investigate/data.js';
import { matchColumns, pickControl } from './investigate/spark.js';
import { replay } from './investigate/replay.js';

export async function investigate(spec) {
  const notes = [];
  const tokens = { in: 0, out: 0 };
  const count = (usage) => {
    tokens.in += usage?.prompt_tokens ?? 0;
    tokens.out += usage?.completion_tokens ?? 0;
  };
  const wanted = spec.columns.filter((c) => c.constant === null);

  const session = await openPage(spec.sourceUrl);
  try {
    // 1. What the page loads by itself.
    const list = await findSource({ columns: wanted, samples: spec.samples, captures: session.captured, count });
    if (!list) {
      notes.push('No JSON response on page load holds the spec\'s records: likely the HTML route.');
      return report({ spec, session, list: null, detail: null, wanted, notes, tokens });
    }
    let missing = wanted.filter((c) => !list.fields[c.name]?.keys.length);

    // 2. Columns the list doesn't have: reveal them on one sample record.
    let detail = null;
    if (missing.length) {
      detail = await revealDetail({ spec, session, list, missing, count, notes });
      if (detail) missing = missing.filter((c) => !detail.fields[c.name]?.keys.length);
    }

    list.replay = await replay(list.capture, list.records.path);
    if (detail) detail.replay = await replay(detail.capture, detail.records.path);
    return report({ spec, session, list, detail, wanted, notes, tokens });
  } finally {
    await session.close();
  }
}

// The captured JSON response that holds the most of these columns, per Muse Spark.
async function findSource({ columns, samples, captures, count }) {
  const candidates = captures
    .filter((c) => !isTracker(c.url))
    .map((c) => ({ ...c, records: findRecords(c.json) }))
    .filter((c) => c.records);
  if (!candidates.length) return null;

  const match = await matchColumns({ columns, samples, candidates });
  count(match.usage);
  if (match.best === null) return null;

  const capture = candidates[match.best];
  return {
    capture,
    records: capture.records,
    total: findTotal(capture.json),
    fields: Object.fromEntries(match.fields.map((f) => [f.column, { keys: f.keys, how: f.how }])),
    reason: match.reason,
  };
}

async function revealDetail({ spec, session, list, missing, count, notes }) {
  // A sample that has values for the missing columns, so the record we open has them.
  const samples = spec.samples.filter((s) => missing.some((c) => s.values[c.name]));
  const anchors = Object.entries(list.fields).filter(([, f]) => f.keys.length === 1);

  for (const sample of samples) {
    for (const [column, field] of anchors) {
      const value = sample.values[column];
      if (!value || value.length < 4) continue;
      const record = list.records.records.find((r) => String(at(r, field.keys[0])) === value);
      const row = record && (await findRecordRow(session.page, value));
      if (!row) continue;

      await row.scrollIntoViewIfNeeded();
      const controls = await clickablesIn(row);
      if (!controls.length) continue;
      const recordText = (await row.innerText()).replace(/\s+/g, ' ').slice(0, 300);
      const screenshot = await session.page.screenshot();

      const pick = await pickControl({ screenshot, recordText, missing, controls });
      count(pick.usage);
      if (pick.control === null) {
        notes.push(`On "${value}", Muse Spark found no control that reveals ${missing.map((c) => c.name).join(', ')}: ${pick.reason}`);
        continue;
      }
      const control = controls[pick.control];
      const captures = await session.during('click', () => control.element.click());
      const found = await findSource({ columns: missing, samples: spec.samples, captures, count });
      if (!found) {
        notes.push(`Clicking "${control.text}" on "${value}" brought no JSON holding the missing columns.`);
        continue;
      }
      return {
        ...found,
        trigger: { record: value, control: control.text, reason: pick.reason },
        join: findJoin(found.capture, record),
      };
    }
  }
  notes.push('Could not reveal the missing columns from any sample record.');
  return null;
}

// How a detail request points back to its list record: which of the request's
// parameters carries which of the record's values (e.g. assessmentId = LastAssessmentId).
function findJoin(capture, record) {
  const places = [];
  const url = new URL(capture.url);
  for (const [param, value] of url.searchParams) places.push({ in: 'query', param, value });
  if (capture.payload) {
    for (const [param, value] of new URLSearchParams(capture.payload)) places.push({ in: 'payload', param, value });
    try {
      for (const [param, value] of Object.entries(JSON.parse(capture.payload))) places.push({ in: 'payload', param, value: String(value) });
    } catch {
      // not a JSON body
    }
  }
  url.pathname.split('/').forEach((segment, i) => {
    if (segment) places.push({ in: 'path', param: `segment ${i}`, value: decodeURIComponent(segment) });
  });

  for (const place of places) {
    // Short values like "4" match by accident; IDs are longer.
    if (!place.value || place.value.length < 3) continue;
    for (const [field, value] of Object.entries(record)) {
      if (value !== null && typeof value !== 'object' && String(value) === place.value) {
        return { in: place.in, param: place.param, listField: field };
      }
    }
  }
  return null;
}

function describe(source) {
  const { capture } = source;
  return {
    request: {
      method: capture.method,
      url: capture.url,
      payload: capture.payload,
      contentType: capture.headers['content-type'] ?? null,
    },
    recordsPath: source.records.path,
    recordCount: source.records.count,
    total: source.total,
    fields: source.fields,
    replay: source.replay,
    reason: source.reason,
    sampleRecords: source.records.records.slice(0, 2).map((r) => shrink(r)),
  };
}

function report({ spec, session, list, detail, wanted, notes, tokens }) {
  const mapped = (c) => list?.fields[c.name]?.keys.length || detail?.fields[c.name]?.keys.length;
  return {
    spec: spec.title,
    sourceUrl: spec.sourceUrl,
    investigatedAt: new Date().toISOString(),
    pageStatus: session.status ?? null,
    list: list && describe(list),
    detail: detail && { ...describe(detail), trigger: detail.trigger, join: detail.join },
    constants: spec.columns.filter((c) => c.constant !== null).map((c) => ({ column: c.name, value: c.constant })),
    unmapped: wanted.filter((c) => !mapped(c)).map((c) => c.name),
    notes,
    tokens,
  };
}

function printFindings(f) {
  const line = (label, s) => {
    if (!s) return;
    const r = s.request;
    console.log(`\n${label}: ${r.method} ${r.url.split('?')[0]}${r.payload ? `  body: ${r.payload.slice(0, 70)}` : ''}`);
    console.log(`  records at ${s.recordsPath}: ${s.recordCount}${s.total ? `, source says ${s.total.value} ("${s.total.key}")` : ''}`);
    console.log(`  replay: ${s.replay?.works ?? `failed (${s.replay?.tried.join('; ')})`}`);
    for (const [column, field] of Object.entries(s.fields)) {
      if (field.keys.length) console.log(`  ${column} <- ${field.keys.join(' + ')}${field.how ? `  (${field.how})` : ''}`);
    }
  };
  console.log(`${f.spec}\n${f.sourceUrl} (status ${f.pageStatus ?? '?'})`);
  line('List', f.list);
  if (f.detail) {
    console.log(`\nClicked "${f.detail.trigger.control}" on "${f.detail.trigger.record}": ${f.detail.trigger.reason}`);
    line('Detail', f.detail);
    const j = f.detail.join;
    console.log(`  join: ${j ? `${j.param} (in ${j.in}) = list ${j.listField}` : 'not found'}`);
  }
  console.log(`\nConstants: ${f.constants.map((c) => `${c.column} = "${c.value}"`).join(', ') || 'none'}`);
  console.log(`Unmapped: ${f.unmapped.join(', ') || 'none'}`);
  for (const n of f.notes) console.log(`Note: ${n}`);
  console.log(`Muse Spark: ${f.tokens.in} tokens in, ${f.tokens.out} out`);
}

async function main() {
  const specPath = process.argv[2];
  if (!specPath) {
    console.error('Usage: node src/investigate.js <spec.json>');
    process.exit(1);
  }
  const started = Date.now();
  const findings = await investigate(JSON.parse(fs.readFileSync(specPath, 'utf8')));
  printFindings(findings);
  const outPath = specPath.replace(/\.spec\.json$/, '.findings.json');
  fs.writeFileSync(outPath, JSON.stringify(findings, null, 2) + '\n');
  console.log(`${Math.round((Date.now() - started) / 1000)} s, wrote ${outPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
