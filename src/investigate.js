// Investigator: finds where a spec's data really lives. Loads the page, collects its
// JSON traffic and the data embedded in its HTML, and asks Muse Spark which source
// holds which columns. When columns are still missing, it finds a record's row on the
// page, lets Muse Spark pick the control that reveals more (from a screenshot and the
// numbered controls), and follows it: a click that fires a JSON request, or a link to
// an HTML detail page. Writes <spec>.findings.json for the code writer.
// Usage: node src/investigate.js <spec.json>

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openPage, findRecordRow, clickablesIn } from './investigate/browser.js';
import { isTracker, findRecords, findTotal, shrink, at } from './investigate/data.js';
import { matchColumns, pickControl } from './investigate/spark.js';
import { mapHtmlDetail } from './investigate/html.js';
import { replay, replayEmbedded } from './investigate/replay.js';
import { extractEmbedded } from './embedded.js';

export async function investigate(spec) {
  const notes = [];
  const tokens = { in: 0, out: 0 };
  const count = (usage) => {
    tokens.in += usage?.prompt_tokens ?? 0;
    tokens.out += usage?.completion_tokens ?? 0;
  };
  const wanted = spec.columns.filter((c) => c.constant === null);

  const session = await openPage(spec.sourceUrl);
  if (!session.html) {
    // The browser gave up before the document arrived; the embedded data is still
    // worth a plain request.
    try {
      const res = await fetch(spec.sourceUrl, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(300_000) });
      if (res.ok) {
        session.html = await res.text();
        session.status ??= res.status;
        notes.push('The browser timed out loading the page; its HTML came from a plain request.');
      }
    } catch (err) {
      notes.push(`The page didn't load in the browser or by plain request (${err.name}).`);
    }
  }
  try {
    // 1. What the page loads by itself: JSON responses, and data embedded in its HTML.
    const candidates = [...jsonCandidates(session.captured), ...embeddedCandidates(session)];
    const list = await chooseSource({ columns: wanted, samples: spec.samples, candidates, count });
    if (!list) {
      notes.push("Neither the page's JSON traffic nor its embedded data holds the spec's records: likely the HTML route.");
      return report({ spec, session, list: null, detail: null, wanted, notes, tokens });
    }
    if (list.embedded) list.siblings = siblingsOf(list, candidates);
    let missing = wanted.filter((c) => !list.fields[c.name]?.keys.length);

    // 2. Columns the list doesn't have: reveal them from one record.
    let detail = null;
    if (missing.length) {
      detail = await revealDetail({ spec, session, list, missing, count, notes });
      if (detail) missing = missing.filter((c) => !detail.fields[c.name]?.keys.length);
    }

    list.replay = list.embedded
      ? await replayEmbedded(list.capture.url, list.embedded.name, list.records.path, list.records.count)
      : await replay(list.capture, list.records.path);
    if (detail?.kind === 'json') detail.replay = await replay(detail.capture, detail.records.path);
    return report({ spec, session, list, detail, wanted, notes, tokens });
  } finally {
    await session.close();
  }
}

function jsonCandidates(captures) {
  return captures
    .filter((c) => !isTracker(c.url))
    .map((c) => ({ ...c, records: findRecords(c.json) }))
    .filter((c) => c.records);
}

// Each embedded literal is a candidate source too. Its record path is written in the
// frame's trace syntax: "embedded:s7.0.data".
function embeddedCandidates(session) {
  if (!session.html) return [];
  return extractEmbedded(session.html)
    .map((e) => ({
      method: 'GET',
      url: session.finalUrl,
      payload: null,
      headers: {},
      json: e.value,
      embedded: { name: e.name, context: e.context },
      records: findRecords(e.value),
    }))
    .filter((c) => c.records);
}

// The candidate that holds the most of these columns, per Muse Spark.
async function chooseSource({ columns, samples, candidates, count }) {
  if (!candidates.length) return null;
  const match = await matchColumns({ columns, samples, candidates });
  count(match.usage);
  if (match.best === null) return null;
  const capture = candidates[match.best];
  return {
    capture,
    embedded: capture.embedded ?? null,
    records: capture.records,
    total: findTotal(capture.json),
    fields: Object.fromEntries(match.fields.map((f) => [f.column, { keys: f.keys, how: f.how }])),
    reason: match.reason,
  };
}

// Other embedded literals with rows of the same shape: the same list split into
// tables (GPTW: one per organization size).
function siblingsOf(list, candidates) {
  const shape = (r) => (Array.isArray(r) ? `row:${r.length}` : Object.keys(r).sort().join(','));
  const mine = shape(list.records.records[0]);
  return candidates
    .filter((c) => c.embedded && c.embedded.name !== list.embedded.name && shape(c.records.records[0]) === mine)
    .map((c) => ({ name: c.embedded.name, context: c.embedded.context, recordsPath: tracePath(c), recordCount: c.records.count }));
}

const tracePath = (c) => (c.embedded ? `embedded:${c.embedded.name}${c.records.path.slice(1)}` : c.records.path);

// All list records, including sibling tables, for finding a sample by value.
function allListRecords(list, session) {
  const names = new Set([list.embedded?.name, ...(list.siblings ?? []).map((s) => s.name)]);
  if (!list.embedded) return list.records.records;
  return extractEmbedded(session.html)
    .filter((e) => names.has(e.name))
    .flatMap((e) => findRecords(e.value)?.records ?? []);
}

async function revealDetail({ spec, session, list, missing, count, notes }) {
  // A sample with values for the missing columns, so the record we open has them.
  const samples = spec.samples.filter((s) => missing.some((c) => s.values[c.name]));
  const anchors = Object.entries(list.fields).filter(([, f]) => f.keys.length === 1);
  const records = allListRecords(list, session);

  for (const sample of samples) {
    for (const [column, field] of anchors) {
      const value = sample.values[column];
      if (!value || value.length < 4) continue;
      const record = records.find((r) => String(at(r, field.keys[0])) === value);
      if (!record) continue;

      // The sample's own row, or, when the page doesn't show it (paginated tables),
      // the first visible row of the same list.
      let row = await findRecordRow(session.page, value);
      let shownRecord = record;
      if (!row) {
        for (const other of records.slice(0, 20)) {
          row = await findRecordRow(session.page, String(at(other, field.keys[0])));
          if (row) {
            shownRecord = other;
            break;
          }
        }
      }
      if (!row) continue;

      await row.scrollIntoViewIfNeeded();
      const controls = await clickablesIn(row);
      if (!controls.length) continue;
      const recordText = (await row.innerText()).replace(/\s+/g, ' ').slice(0, 300);
      const pick = await pickControl({ screenshot: await session.page.screenshot(), recordText, missing, controls });
      count(pick.usage);
      if (pick.control === null) {
        notes.push(`On "${recordText.slice(0, 40)}", Muse Spark found no control that reveals ${missing.map((c) => c.name).join(', ')}: ${pick.reason}`);
        continue;
      }
      const control = controls[pick.control];
      const trigger = { record: recordText.slice(0, 60), control: control.text, reason: pick.reason };

      // A link to another page: the detail is an HTML page, fetched without a browser.
      if (control.href && /^https?:\/\/|^\//.test(control.href)) {
        const html = await htmlDetail({ control, shownRecord, record, missing, sample, count, notes });
        if (html) return { ...html, trigger };
        continue;
      }

      // Otherwise click it and see which JSON arrives.
      const captures = await session.during('click', () => control.element.click());
      const found = await chooseSource({ columns: missing, samples: spec.samples, candidates: jsonCandidates(captures), count });
      if (!found) {
        notes.push(`Clicking "${control.text}" brought no JSON holding the missing columns.`);
        continue;
      }
      return { ...found, kind: 'json', trigger, join: findJoin(found.capture, shownRecord) };
    }
  }
  notes.push('Could not reveal the missing columns from any record.');
  return null;
}

// The detail link lives in one of the list record's fields (GPTW: an <a href> inside
// field 4). Take the sample record's own link from that field, fetch its page, and map
// the missing columns to verified selectors.
async function htmlDetail({ control, shownRecord, record, missing, sample, count, notes }) {
  const href = new URL(control.href, 'https://x.invalid').pathname;
  const fieldOf = (r) =>
    Object.keys(r).find((k) => typeof r[k] === 'string' && r[k].replace(/\\\//g, '/').includes(href));
  const linkField = fieldOf(shownRecord);
  if (linkField === undefined) {
    notes.push(`The "${control.text}" link isn't in any field of the list record, so it can't be built per record.`);
    return null;
  }
  const raw = String(record[linkField]).replace(/\\\//g, '/');
  const url = raw.match(/href="([^"]+)"/)?.[1] ?? raw.match(/https?:\/\/[^\s"'<>]+/)?.[0];
  if (!url) return null;

  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    notes.push(`The sample's detail page ${url} returned HTTP ${res.status} to a plain request.`);
    return null;
  }
  const html = await res.text();
  const { fields, jsonLd } = await mapHtmlDetail({ html, missing, sample, count });
  return {
    kind: 'html',
    urlFrom: { listField: linkField, how: /href=/.test(raw) ? 'the href of the <a> inside this field' : 'the field is the URL' },
    sampleUrl: res.url,
    replay: { works: 'plain request', needsSession: false, tried: [] },
    fields,
    jsonLd,
  };
}

// How a JSON detail request points back to its list record: which of the request's
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
    ...(source.embedded && { embedded: source.embedded }),
    recordsPath: tracePath(capture),
    recordCount: source.records.count,
    recordShape: source.records.tabular ? `arrays of ${source.records.records[0].length} cells` : 'objects',
    ...(source.siblings?.length && { siblings: source.siblings }),
    total: source.total,
    fields: source.fields,
    replay: source.replay,
    reason: source.reason,
    sampleRecords: source.records.records.slice(0, 2).map((r) => (Array.isArray(r) ? r.map((c) => shrink(c, 1)) : shrink(r))),
  };
}

function report({ spec, session, list, detail, wanted, notes, tokens }) {
  const mapped = (c) => list?.fields[c.name]?.keys.length || detail?.fields[c.name]?.keys.length;
  let detailOut = null;
  if (detail?.kind === 'json') detailOut = { kind: 'json', ...describe(detail), trigger: detail.trigger, join: detail.join };
  if (detail?.kind === 'html') detailOut = detail;
  return {
    spec: spec.title,
    sourceUrl: spec.sourceUrl,
    investigatedAt: new Date().toISOString(),
    pageStatus: session.status ?? null,
    list: list && describe(list),
    detail: detailOut,
    constants: spec.columns.filter((c) => c.constant !== null).map((c) => ({ column: c.name, value: c.constant })),
    unmapped: wanted.filter((c) => !mapped(c)).map((c) => c.name),
    notes,
    tokens,
  };
}

function printFindings(f) {
  const fields = (fs) => {
    for (const [column, field] of Object.entries(fs)) {
      if (!field.keys.length) continue;
      const check = field.verified === undefined ? '' : field.verified ? '  ✓ matches sample' : `  ✗ sample "${field.sampleValue}", got "${field.got}"`;
      console.log(`  ${column} <- ${field.keys.join(' + ')}${field.how ? `  (${field.how})` : ''}${check}`);
    }
  };
  console.log(`${f.spec}\n${f.sourceUrl} (status ${f.pageStatus ?? '?'})`);
  if (f.list) {
    const r = f.list.request;
    console.log(`\nList: ${r.method} ${r.url.split('?')[0]}${r.payload ? `  body: ${r.payload.slice(0, 70)}` : ''}`);
    if (f.list.embedded) console.log(`  embedded ${f.list.embedded.name}: …${f.list.embedded.context.slice(-60)}`);
    console.log(`  records at ${f.list.recordsPath}: ${f.list.recordCount} (${f.list.recordShape})${f.list.total ? `, source says ${f.list.total.value}` : ''}`);
    for (const s of f.list.siblings ?? []) console.log(`  + same rows at ${s.recordsPath}: ${s.recordCount}  (…${s.context.slice(-45)})`);
    console.log(`  replay: ${f.list.replay?.works ?? `failed (${f.list.replay?.tried.join('; ')})`}`);
    fields(f.list.fields);
  }
  if (f.detail) {
    console.log(`\nPicked "${f.detail.trigger.control}" on "${f.detail.trigger.record}": ${f.detail.trigger.reason}`);
    if (f.detail.kind === 'html') {
      console.log(`Detail: HTML page per record, URL from list field ${f.detail.urlFrom.listField} (${f.detail.urlFrom.how}); sample page ${f.detail.sampleUrl}`);
    } else {
      const r = f.detail.request;
      console.log(`Detail: ${r.method} ${r.url.split('?')[0]}${r.payload ? `  body: ${r.payload.slice(0, 70)}` : ''}`);
      const j = f.detail.join;
      console.log(`  join: ${j ? `${j.param} (in ${j.in}) = list ${j.listField}` : 'not found'}; replay: ${f.detail.replay?.works}`);
    }
    fields(f.detail.fields);
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
