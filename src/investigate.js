// Investigator: finds where a spec's data really lives. Loads the page, collects its
// JSON traffic and the data embedded in its HTML, and asks Muse Spark which source
// holds which columns. When columns are still missing, it finds a record's row on the
// page, lets Muse Spark pick the control that reveals more (from a screenshot and the
// numbered controls), and follows it: a click that fires a JSON request, or a link to
// an HTML detail page. Writes <spec>.findings.json for the code writer.
// What it finds along the way goes to onEvent, so the user can watch it work.
// Usage: node src/investigate.js <spec.json>

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { RobotsTxtFile } from 'crawlee';
import { openPage, findRecordRow, clickablesIn } from './investigate/browser.js';
import { isTracker, findRecords, findTotal, shrink, at } from './investigate/data.js';
import { matchColumns, pickControl } from './investigate/spark.js';
import { mapHtmlDetail } from './investigate/html.js';
import { replay, replayEmbedded, sameContext } from './investigate/replay.js';
import { extractEmbedded } from './embedded.js';
import { request, useProxy, currentProxy } from './investigate/http.js';

export async function investigate(spec, { onEvent = () => {} } = {}) {
  const notes = [];
  const tokens = { in: 0, out: 0 };
  const count = (usage) => {
    tokens.in += usage?.prompt_tokens ?? 0;
    tokens.out += usage?.completion_tokens ?? 0;
  };
  const wanted = spec.columns.filter((c) => c.constant === null);

  const session = await openByWays(spec.sourceUrl, { onEvent, notes });
  if (!session.page) {
    return { ...report({ spec, session, list: null, detail: null, wanted, notes, tokens }), access: session.access };
  }
  if (!session.html) {
    // The browser gave up before the document arrived; the embedded data is still
    // worth a plain request.
    try {
      const res = await request(spec.sourceUrl, { timeoutMs: 300_000 });
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
    const json = jsonCandidates(session.captured);
    const embedded = embeddedCandidates(session);
    onEvent({
      kind: 'page',
      text: `Opened ${session.finalUrl} (HTTP ${session.status ?? '?'}) and watched its traffic: ${plural(session.captured.length, 'JSON response')}, ${json.length} holding lists of records; ${plural(embedded.length, 'data block')} embedded in the HTML.`,
      url: session.finalUrl,
      status: session.status ?? null,
      jsonResponses: session.captured.length,
      jsonLists: json.length,
      embeddedLists: embedded.length,
      image: await session.page.screenshot().catch(() => null),
    });

    // 1. What the page loads by itself: JSON responses, and data embedded in its HTML.
    const candidates = [...json, ...embedded];
    const list = await chooseSource({ columns: wanted, samples: spec.samples, candidates, count });
    if (!list) {
      notes.push("Neither the page's JSON traffic nor its embedded data holds the spec's records: likely the HTML route.");
      onEvent({ kind: 'no-source', text: "Neither the page's own data requests nor its embedded data hold your records." });
      return report({ spec, session, list: null, detail: null, wanted, notes, tokens });
    }
    if (list.embedded) list.siblings = siblingsOf(list, candidates);
    let missing = wanted.filter((c) => !list.fields[c.name]?.keys.length);
    const found = Object.keys(list.fields).filter((c) => list.fields[c].keys.length);
    onEvent({
      kind: 'source',
      text: list.embedded
        ? `The records are embedded in the page itself (${list.records.count + (list.siblings ?? []).reduce((n, s) => n + s.recordCount, 0)} rows${list.siblings?.length ? ` in ${list.siblings.length + 1} tables` : ''}): no need to parse the visible page.`
        : `Found the site's own data feed: ${list.capture.method} ${list.capture.url.split('?')[0]} returns ${list.records.count} records as JSON. Calling it directly instead of parsing the page.`,
      route: list.embedded ? 'embedded' : 'feed',
      request: { method: list.capture.method, url: list.capture.url, payload: list.capture.payload ?? null },
      recordCount: list.records.count,
      siblings: (list.siblings ?? []).map((s) => ({ context: s.context.slice(-60), recordCount: s.recordCount })),
      total: list.total?.value ?? null,
      columns: found,
      missing: missing.map((c) => c.name),
      reason: list.reason,
    });

    // 2. Columns the list doesn't have: reveal them from one record.
    let detail = null;
    if (missing.length) {
      detail = await revealDetail({ spec, session, list, missing, count, notes, onEvent });
      if (detail) missing = missing.filter((c) => !detail.fields[c.name]?.keys.length);
    }

    await respectRobots(list, notes, onEvent);
    list.replay = list.embedded
      ? await replayEmbedded(list.capture.url, list.embedded.context, list.records.path, list.records.count)
      : await replay(list.capture, list.records.path);
    if (detail?.kind === 'json') detail.replay = await replay(detail.capture, detail.records.path);
    onEvent({
      kind: 'replay',
      text: `Fetched the data again without a browser: ${list.replay?.works ? `works (${list.replay.works})` : 'did not work'}${detail?.replay ? `; detail ${detail.replay.works ? 'works too' : 'did not'}` : ''}.`,
      works: Boolean(list.replay?.works),
      timing: list.replay?.timing ?? null,
    });
    const reachability = await reach({ spec, list, detail, notes });
    if (reachability) {
      const how = reachability.recommendation;
      onEvent({
        kind: 'reach',
        text: how
          ? `Checked from Apify's servers, where the run happens: the site answers ${how === 'direct' ? 'directly, no proxy needed' : `through Apify's ${how} proxy`}.`
          : "Checked from Apify's servers: the site refused every way Dapi is allowed to ask.",
        recommendation: how ?? null,
        results: reachability.results ?? [],
      });
    }
    return { ...report({ spec, session, list, detail, wanted, notes, tokens }), reachability, access: session.access };
  } finally {
    await session.close();
    useProxy(undefined);
  }
}

// The ways in, cheapest first. A site that blocks the first visit is tried again
// through Apify Proxy, datacenter then residential, each with a fresh IP. A check that
// wants a person to click or solve something is set aside (owner's call, 2026-11-01);
// so is a site that still blocks every way. Apify's UNBLOCKER group is never used: it
// solves challenges.
const WAYS = ['direct', 'datacenter', 'residential'];

async function openByWays(url, { onEvent, notes }) {
  const attempts = [];
  for (const way of WAYS) {
    const proxy = way === 'direct' ? null : await apifyProxy(way, notes);
    if (way !== 'direct' && !proxy) break;
    const session = await openPage(url, { proxy });
    if (!session.check) {
      if (proxy) {
        useProxy(`http://${proxy.username}:${proxy.password}@proxy.apify.com:8000`);
        notes.push(`The site blocked ${attempts.map((a) => a.way).join(' and ')}; the investigation went through Apify's ${way} proxy.`);
      }
      session.access = { via: way, attempts };
      return session;
    }
    attempts.push({ way, kind: session.check.kind, what: session.check.what, status: session.status ?? null });
    const next = WAYS[WAYS.indexOf(way) + 1];
    onEvent({
      kind: 'blocked',
      way,
      check: session.check,
      text:
        session.check.kind === 'human'
          ? `${wayName(way)} the site asked for ${session.check.what}: something only a person can do. Dapi sets those aside${next ? `, and tries Apify's ${next} proxy in case it isn't asked there.` : '.'}`
          : `${wayName(way)} the site blocked the visit (${session.check.what}).${next ? ` Trying again through Apify's ${next} proxy, from a fresh IP.` : ''}`,
      image: await session.page.screenshot().catch(() => null),
    });
    await session.close();
  }
  return { page: null, status: attempts.at(-1)?.status ?? null, captured: [], close: async () => {}, access: { via: null, attempts } };
}

const wayName = (way) => (way === 'direct' ? 'Visiting directly,' : `Through Apify's ${way} proxy,`);

// Apify Proxy for Playwright, from the account's own proxy password (never logged).
let proxyPassword;
async function apifyProxy(way, notes) {
  try {
    if (!proxyPassword) {
      const { apify } = await import('./apify/client.js');
      proxyPassword = (await apify.user('me').get()).proxy?.password;
    }
  } catch {
    // no Apify token: only the direct way
  }
  if (!proxyPassword) {
    notes.push('Apify Proxy is not available to the investigation, so only the direct way was tried.');
    return null;
  }
  return { server: 'http://proxy.apify.com:8000', username: way === 'residential' ? 'groups-RESIDENTIAL' : 'auto', password: proxyPassword };
}

// How the site answers Apify's servers, where the extraction will run: the probe
// fetches the list and the sample's detail from Apify, directly, then via datacenter
// and residential proxy, stopping at the first that works. Each request must come
// back holding one of the sample's values. Skipped without an Apify token.
async function reach({ spec, list, detail, notes }) {
  const sample = spec.samples[0];
  const firstValue = sample?.values[spec.columns[0].name];
  const detailValue = detail && Object.keys(detail.fields).map((c) => sample?.values[c]).find((v) => v && v.length >= 4);
  const header = (c) => (c.headers?.['content-type'] ? { 'content-type': c.headers['content-type'] } : {});
  const requests = [
    { label: 'list', url: list.capture.url, method: list.capture.method, payload: list.capture.payload, headers: header(list.capture), expect: firstValue },
  ];
  if (detail?.kind === 'json') {
    requests.push({ label: 'detail', url: detail.capture.url, method: detail.capture.method, payload: detail.capture.payload, headers: header(detail.capture), expect: detailValue });
  }
  if (detail?.kind === 'html') requests.push({ label: 'detail page', url: detail.sampleUrl, expect: detailValue });
  try {
    const { checkReach } = await import('./apify/reach.js');
    return await checkReach(requests);
  } catch (err) {
    notes.push(`Reachability from Apify not checked: ${err.message.split('\n')[0]}`);
    return null;
  }
}

// The frame obeys robots.txt (Crawlee's own parser), so the findings must only point
// at allowed URLs. If the list URL is disallowed only because of its query string
// (GPTW: "Disallow: /*?*"), the same URL without one is used, provided a plain
// request returns the same data. Otherwise say so plainly.
async function respectRobots(list, notes, onEvent) {
  const url = list.capture.url;
  let robots;
  try {
    robots = await RobotsTxtFile.find(url, currentProxy());
  } catch {
    onEvent({ kind: 'robots', allowed: true, text: 'The site has no robots.txt: nothing is off limits.' });
    return; // no robots.txt: everything is allowed
  }
  if (robots.isAllowed(url)) {
    onEvent({ kind: 'robots', allowed: true, text: "robots.txt allows these requests." });
    return;
  }

  const bare = url.split('?')[0];
  if (bare !== url && robots.isAllowed(bare) && list.embedded) {
    const same = await replayEmbedded(bare, list.embedded.context, list.records.path, list.records.count);
    if (same.works) {
      // The same tables, but possibly under other names on this URL: rename by context.
      const rename = (name, context) => same.entries.find((e) => sameContext(e.context, context))?.name ?? name;
      const embedded = { ...list.embedded, name: rename(list.embedded.name, list.embedded.context) };
      list.capture = { ...list.capture, url: bare, embedded };
      list.embedded = embedded;
      for (const s of list.siblings ?? []) {
        const name = rename(s.name, s.context);
        s.recordsPath = s.recordsPath.replace(`embedded:${s.name}`, `embedded:${name}`);
        s.name = name;
      }
      notes.push(`robots.txt disallows ${url}; ${bare} is allowed and serves the same data, so the findings use it.`);
      onEvent({ kind: 'robots', allowed: true, text: `robots.txt disallows ${url}, but ${bare} is allowed and serves the same data, so Dapi uses that.` });
      return;
    }
  }
  list.robotsBlocked = true;
  notes.push(`robots.txt disallows ${url}, and no allowed URL with the same data was found. Dapi needs the user's approval to fetch it anyway; without it, the run skips these requests.`);
  onEvent({ kind: 'robots', allowed: false, url, text: `robots.txt disallows ${url}, and no allowed address serves the same data. You decide whether to fetch it anyway.` });
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

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const tracePath = (c) => (c.embedded ? `embedded:${c.embedded.name}${c.records.path.slice(1)}` : c.records.path);

// All list records, including sibling tables, for finding a sample by value.
function allListRecords(list, session) {
  const names = new Set([list.embedded?.name, ...(list.siblings ?? []).map((s) => s.name)]);
  if (!list.embedded) return list.records.records;
  return extractEmbedded(session.html)
    .filter((e) => names.has(e.name))
    .flatMap((e) => findRecords(e.value)?.records ?? []);
}

async function revealDetail({ spec, session, list, missing, count, notes, onEvent }) {
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
      const screenshot = await session.page.screenshot();
      const pick = await pickControl({ screenshot, recordText, missing, controls });
      count(pick.usage);
      onEvent({
        kind: 'pick',
        text:
          pick.control === null
            ? `Looked at the page around "${recordText.slice(0, 50)}": no control there reveals ${missing.map((c) => c.name).join(', ')}.`
            : `Looked at the page around "${recordText.slice(0, 50)}" and chose "${controls[pick.control].text}" to reveal ${missing.map((c) => c.name).join(', ')}: ${pick.reason}`,
        record: recordText.slice(0, 120),
        controls: controls.map((c) => c.text),
        chosen: pick.control,
        reason: pick.reason,
        image: screenshot,
      });
      if (pick.control === null) {
        notes.push(`On "${recordText.slice(0, 40)}", Muse Spark found no control that reveals ${missing.map((c) => c.name).join(', ')}: ${pick.reason}`);
        continue;
      }
      const control = controls[pick.control];
      const trigger = { record: recordText.slice(0, 60), control: control.text, reason: pick.reason };

      // A link to another page: the detail is an HTML page, fetched without a browser.
      if (control.href && /^https?:\/\/|^\//.test(control.href)) {
        const html = await htmlDetail({ control, shownRecord, record, missing, sample, count, notes });
        if (html) {
          onEvent({
            kind: 'detail',
            route: 'page',
            text: `"${control.text}" opens a page per record. Fetched the sample's page and found ${Object.keys(html.fields).join(', ')} on it.`,
            url: html.sampleUrl,
            columns: Object.keys(html.fields),
          });
          return { ...html, trigger };
        }
        continue;
      }

      // Otherwise click it and see which JSON arrives.
      const captures = await session.during('click', () => control.element.click());
      const found = await chooseSource({ columns: missing, samples: spec.samples, candidates: jsonCandidates(captures), count });
      if (!found) {
        notes.push(`Clicking "${control.text}" brought no JSON holding the missing columns.`);
        continue;
      }
      const join = findJoin(found.capture, shownRecord);
      onEvent({
        kind: 'detail',
        route: 'feed',
        text: `Clicking "${control.text}" makes the page call ${found.capture.method} ${found.capture.url.split('?')[0]}${join ? `, keyed by ${join.param}` : ''}. Dapi calls it once per record instead of clicking.`,
        request: { method: found.capture.method, url: found.capture.url, payload: found.capture.payload ?? null },
        columns: Object.keys(found.fields).filter((c) => found.fields[c].keys.length),
        join,
      });
      return { ...found, kind: 'json', trigger, join };
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

  const started = Date.now();
  const res = await request(url);
  if (!res.ok) {
    notes.push(`The sample's detail page ${url} returned HTTP ${res.status} to a plain request.`);
    return null;
  }
  const html = await res.text();
  const timing = { ms: Date.now() - started, bytes: Buffer.byteLength(html) };
  const { fields, jsonLd } = await mapHtmlDetail({ html, missing, sample, count });
  return {
    kind: 'html',
    urlFrom: { listField: linkField, how: /href=/.test(raw) ? 'the href of the <a> inside this field' : 'the field is the URL' },
    sampleUrl: res.url,
    replay: { works: 'plain request', needsSession: false, tried: [], timing },
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
    ...(source.robotsBlocked && { robotsBlocked: true }),
    total: source.total,
    fields: source.fields,
    // The replay's parsed page (entries) is for renaming only: never into the findings,
    // where it would send megabytes of the site's data to Muse Spark on every attempt.
    replay: source.replay && { works: source.replay.works, needsSession: source.replay.needsSession, tried: source.replay.tried, timing: source.replay.timing },
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
  if (f.reachability) {
    const r = f.reachability;
    console.log(`\nFrom Apify's servers: ${r.recommendation ? `works ${r.recommendation === 'direct' ? 'directly' : `via ${r.recommendation} proxy`}` : 'no way worked'}`);
    for (const x of r.results ?? []) console.log(`  ${x.mode.padEnd(11)} ${String(x.label ?? '').padEnd(11)} ${x.error ?? `HTTP ${x.status}, ${x.ms} ms, ${x.bytes} bytes${x.blocked ? ', BLOCKED' : ''}${x.hasData === false ? ', sample value missing' : ''}`}`);
  }
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
