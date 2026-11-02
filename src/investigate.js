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
import { outline, findListLink, alignSamples, urlTemplate } from './investigate/record-page.js';
import { findUpstream, sameOnAllPages } from './investigate/upstream.js';
import * as cheerio from 'cheerio';
import { select } from './select.js';

export async function investigate(spec, { onEvent = () => {} } = {}) {
  const notes = [];
  const tokens = { in: 0, out: 0 };
  const count = (usage) => {
    tokens.in += usage?.prompt_tokens ?? 0;
    tokens.out += usage?.completion_tokens ?? 0;
  };
  const wanted = spec.columns.filter((c) => c.constant === null);

  let session = await openByWays(spec.sourceUrl, { onEvent, notes });
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
  // The spec as the site writes it: once the samples are aligned with a record's own
  // page, their values are in the site's words (language, formatting).
  let source = spec;
  let alignment = null;
  let recordPage = null;
  // What's known so far, so a step that fails hands the agent a partial picture instead
  // of ending the job.
  const partial = {};
  try {
    const firstShot = await session.page.screenshot().catch(() => null);
    let candidates = pageCandidates(session, firstShot, onEvent);

    // 1. What the page loads by itself: JSON responses, and data embedded in its HTML.
    let list = await chooseSource({ columns: wanted, samples: spec.samples, candidates, count });

    // A spec often names one record's page (the one its sample came from) rather than
    // the list. Then: learn the sample's values in the site's own words from this page,
    // and go up to the list the way a person would.
    // A spoken spec often names the site's home page: then follow the links toward the
    // records, up to three hops.
    let shot = firstShot;
    for (let hop = 0; hop < 3 && !list && session.html; hop++) {
      const page = outline(session.html, session.finalUrl);
      const up = await findListLink({ screenshot: shot, page, spec });
      count(up.usage);
      if (up.recordPage && !recordPage) {
        recordPage = { url: session.finalUrl, html: session.html };
        if (spec.samples.length) {
          alignment = await alignSamples({ page, spec });
          count(alignment.usage);
          source = alignedSpec(spec, alignment, notes);
          onEvent({ kind: 'record-page', text: describeAlignment(spec, alignment), alignment: alignment.columns, pageLanguage: alignment.pageLanguage, sampleLanguage: alignment.sampleLanguage });
        }
      }
      if (!up.url) break;
      onEvent({
        kind: 'up',
        text: up.recordPage ? `This page shows one record, so Dapi went up to the list: ${up.url}. ${up.reason}` : `This page isn't the list yet; following the link toward it: ${up.url}. ${up.reason}`,
        url: up.url,
      });
      await session.close();
      session = await openByWays(up.url, { onEvent, notes });
      if (!session.page) break;
      shot = await session.page.screenshot().catch(() => null);
      candidates = pageCandidates(session, shot, onEvent);
      list = await chooseSource({ columns: wanted, samples: source.samples, candidates, count });
    }
    if (!list) {
      notes.push("Neither the page's JSON traffic nor its embedded data holds the spec's records: likely the HTML route.");
      onEvent({ kind: 'no-source', text: "Neither the page's own data requests nor its embedded data hold your records." });
      return report({ spec, session, list: null, detail: null, wanted, notes, tokens });
    }
    if (list.embedded) list.siblings = siblingsOf(list, candidates);
    partial.list = list;
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

    if (!list.embedded) list.paging = await paging(list, onEvent);

    // 2. Columns the list doesn't have: from the record page the spec named, when it
    // did, else revealed from one record on the list page.
    // A column the sample leaves blank but the matching tied to a yes/no flag in the list
    // ("Belongs to main unit" <- is-main-unit) is probably text shown on some records'
    // pages: look for it there too, and prefer the page's text when it's found.
    const first = list.records.records[0];
    const weak = recordPage
      ? wanted.filter((c) => !source.samples[0]?.values[c.name] && list.fields[c.name]?.keys.length === 1 && typeof at(first, list.fields[c.name].keys[0]) === 'boolean')
      : [];
    let detail = null;
    if (missing.length || weak.length) {
      detail = recordPage
        ? await recordPageDetail({ recordPage, list, missing: [...missing, ...weak], sample: source.samples[0] ?? { label: 'the page your spec names', values: {} }, count, notes, onEvent })
        : await revealDetail({ spec: source, session, list, missing, count, notes, onEvent });
      if (detail) missing = missing.filter((c) => !detail.fields[c.name]?.keys.length);
      partial.detail = detail;
      for (const c of weak) {
        if (!detail?.fields[c.name]?.foundOn) continue;
        const key = list.fields[c.name].keys[0];
        list.fields[c.name] = { keys: [], how: `the list only holds a yes/no flag (${key}); the value itself is on the record page` };
        notes.push(`${c.name}: the list only has the flag ${key}; the record page shows the value itself (e.g. "${detail.fields[c.name].example}").`);
      }
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
    const reachability = await reach({ spec: source, list, detail, notes });
    if (reachability?.pace) {
      const p = reachability.pace;
      onEvent({
        kind: 'pace',
        text: `Measured the site's pace from Apify: ${p.levels.map((l) => `${l.concurrency} at a time ${l.errors ? `${l.errors} error${l.errors === 1 ? '' : 's'} (${l.errorKinds.join(', ')})` : `${l.medianMs} ms`}`).join(', ')}. Sweet spot: ${p.recommended.concurrency} at a time, about ${p.recommended.perMinute} requests a minute.`,
        ...p,
      });
    }
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
    return {
      ...report({ spec, session, list, detail, wanted, notes, tokens }),
      reachability,
      access: session.access,
      ...(alignment && { samples: sampleFindings(spec, alignment), sourceSamples: source.samples }),
    };
  } catch (err) {
    // A site that breaks one of the first pass's assumptions: say where it stopped and
    // hand over what's known; the investigation agent finishes the job.
    const where = err.message.split('\n')[0];
    notes.push(`The first pass stopped short: ${where}. The investigation agent takes it from here.`);
    onEvent({ kind: 'stopped-short', text: `Dapi's first pass stopped short on this site (${where}); Muse Wonder takes over the investigation with what's known.` });
    return {
      ...report({ spec, session, list: partial.list ?? null, detail: partial.detail ?? null, wanted, notes, tokens }),
      access: session.access,
      stoppedShort: where,
      ...(alignment && { samples: sampleFindings(spec, alignment), sourceSamples: source.samples }),
    };
  } finally {
    await session.close();
    useProxy(undefined);
  }
}

// What a page loads by itself, reported as it's found: JSON lists and embedded data.
function pageCandidates(session, image, onEvent) {
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
    image,
  });
  return [...json, ...embedded];
}

// The spec with its samples in the site's own words, for everything that compares
// against the site: column matching, selectors, the reach probe, the tests. Columns the
// record page doesn't show are left out of the sample rather than guessed. Samples for
// other records stay only if they're written in the site's language.
function alignedSpec(spec, a, notes) {
  const values = {};
  for (const c of a.columns) {
    if (c.relation === 'absent') continue;
    values[c.column] = c.relation === 'constant' ? spec.samples[a.sample]?.values[c.column] ?? '' : c.onPage;
  }
  const others = spec.samples.filter((_, i) => i !== a.sample);
  const sameLanguage = a.pageLanguage === a.sampleLanguage;
  if (others.length && !sameLanguage) notes.push(`${others.length} other sample(s) are in ${a.sampleLanguage} and can't be found on a ${a.pageLanguage} site as written; they're checked after translation.`);
  return { ...spec, samples: [{ label: a.label, values }, ...(sameLanguage ? others : [])] };
}

const languageName = (code) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
};

function describeAlignment(spec, a) {
  const by = (r) => a.columns.filter((c) => c.relation === r).map((c) => c.column);
  const parts = [];
  if (a.pageLanguage !== a.sampleLanguage) parts.push(`your samples are in ${languageName(a.sampleLanguage)}, the site in ${languageName(a.pageLanguage)}: Dapi reads the site as it is and translates after the run`);
  if (by('formatted').length) parts.push(`${by('formatted').join(', ')} written differently on the site`);
  if (by('differs').length) parts.push(`the site disagrees with your sample on ${by('differs').join(', ')}`);
  return `This page is the record ${a.label ?? 'your sample'} came from. Compared with your sample: ${parts.length ? parts.join('; ') : 'it matches'}.`;
}

// For the job and the screen: how each sample value stands against the site, and what
// to translate after the run (the columns the sample translated, with the sample's
// own wording as examples, so the deliverable reads the way the client wrote it).
function sampleFindings(spec, a) {
  const sample = spec.samples[a.sample] ?? spec.samples[0];
  const columns = a.columns.map((c) => ({ ...c, sample: sample?.values[c.column] ?? '' }));
  const translated = columns.filter((c) => c.relation === 'translated');
  return {
    label: a.label,
    pageLanguage: a.pageLanguage,
    sampleLanguage: a.sampleLanguage,
    columns,
    disputes: columns.filter((c) => c.relation === 'differs').map((c) => ({ column: c.column, sample: c.sample, site: c.onPage, note: c.note })),
    translate:
      a.pageLanguage !== a.sampleLanguage && translated.length
        ? { from: a.pageLanguage, to: a.sampleLanguage, columns: translated.map((c) => c.column), examples: translated.map((c) => ({ column: c.column, source: c.onPage, target: c.sample })) }
        : null,
  };
}

// The record page the spec named is one of many with the same layout: map the missing
// columns on it, and find how its address is built from a list record.
async function recordPageDetail({ recordPage, list, missing, sample, count, notes, onEvent }) {
  const tmpl = urlTemplate(recordPage.url, list.records.records);
  if (!tmpl) {
    notes.push(`No field of the list records appears in ${recordPage.url}, so the record pages can't be addressed per record.`);
    return null;
  }
  // Fetched again without a browser, to confirm the run can; the browser's copy of the
  // page stands in when the site is too slow to answer just now.
  const started = Date.now();
  const res = await request(recordPage.url, { timeoutMs: 120_000 }).catch((err) => ({ ok: false, status: err.code ?? err.name }));
  const html = res.ok ? await res.text() : recordPage.html;
  const timing = { ms: Date.now() - started, bytes: Buffer.byteLength(html) };
  if (!res.ok) notes.push(`A plain request for ${recordPage.url} didn't answer in time (${res.status}); the browser's copy of the page was used to map it.`);
  const { fields, jsonLd } = await mapHtmlDetail({ html, missing, sample, count });

  // Columns the sample's record leaves blank are often filled on other records' pages
  // ("Belongs to main unit" shows only on a sub-unit's page). Look at a few others,
  // preferring records that differ from the sample's in a yes/no field, and map those
  // columns by their labels there.
  let blank = missing.filter((c) => !sample.values[c.name] && !fields[c.name]?.foundOn);
  const others = otherRecordUrls(list, tmpl, 3);
  const otherPages = [];
  for (const { id, url } of others) {
    const other = await request(url, { timeoutMs: 120_000 }).catch(() => null);
    if (!other?.ok) continue;
    const otherHtml = await other.text();
    otherPages.push({ id, $: cheerio.load(otherHtml) });
    if (!blank.length) continue;
    const mapped = await mapHtmlDetail({ html: otherHtml, missing: blank, sample: { label: 'another record', values: {} }, count });
    for (const c of blank) {
      const f = mapped.fields[c.name];
      if (f?.keys.length && f.got && !/^[-–—\s,]*$/.test(f.got)) fields[c.name] = { ...f, verified: true, sampleValue: '', foundOn: url, example: f.got };
    }
    blank = blank.filter((c) => !fields[c.name]?.foundOn);
  }
  // Values identical on every page opened likely depend on a list field (a status):
  // one page per distinct value is enough for those.
  const shared = sameOnAllPages(fields, [cheerio.load(html), ...otherPages.map((p) => p.$)], select);
  for (const c of shared) fields[c].sameOnAllPages = true;
  if (shared.length) onEvent({ kind: 'shared', text: `${shared.join(', ')} read the same on every record page Dapi opened: likely set by the record's status or kind, so one page per distinct value is enough.`, columns: shared });

  // The source behind the source: a public register the page takes its values from,
  // checked against the sample's values and against other records' pages.
  const pageColumns = Object.keys(fields).filter((c) => fields[c].keys.length && !fields[c].sameOnAllPages);
  const read = ($, c) => {
    try {
      const v = select($, fields[c].keys[0]);
      return Array.isArray(v) ? v.join(' ') : v;
    } catch {
      return '';
    }
  };
  const allRecords = await everyRecord(list);
  const nameField = Object.entries(list.fields).find(([, f]) => f.keys.length === 1 && /navn|name|title/i.test(f.keys[0]))?.[1].keys[0];
  const upstream = await findUpstream({
    id: tmpl.sampleValue,
    links: outline(html, recordPage.url).links,
    columns: pageColumns.map((c) => ({ name: c, value: sample.values[c] ?? fields[c].example ?? '' })),
    record: list.records.records.find((r) => String(at(r, tmpl.field)) === tmpl.sampleValue) ?? null,
    examples: [
      { id: tmpl.sampleValue, values: Object.fromEntries(pageColumns.map((c) => [c, sample.values[c] ?? ''])) },
      ...otherPages.map((p) => ({ id: p.id, values: Object.fromEntries(pageColumns.map((c) => [c, read(p.$, c)])) })),
    ],
    names: new Map(nameField ? allRecords.map((r) => [String(at(r, tmpl.field)), String(at(r, nameField) ?? '')]) : []),
    count,
  }).catch((err) => {
    notes.push(`Looking for the register behind the record pages failed: ${err.message.split('\n')[0]}`);
    return null;
  });
  if (upstream) {
    upstream.idField = tmpl.field;
    const batch = upstream.apis.find((a) => a.batch);
    onEvent({
      kind: 'upstream',
      text: `The record pages take ${upstream.columns.join(', ')} from ${upstream.apis[0].name}, and its open API returned your sample's own values${batch ? `, up to ${batch.batch.maxIds} records per request` : ''}. Reading it directly ${batch ? `takes about ${Math.ceil(list.records.count > 0 ? (list.total?.value ?? list.records.count) / batch.batch.maxIds : 1) * upstream.apis.filter((a) => a.batch).length} requests instead of one page load per record` : 'avoids loading every page'}.`,
      apis: upstream.apis.map(({ name, single, batch: b }) => ({ name, single, batch: b?.url ?? null, maxIds: b?.maxIds ?? null })),
      columns: upstream.columns,
    });
  }

  const learned = missing.filter((c) => fields[c.name]?.foundOn);
  if (learned.length) {
    onEvent({
      kind: 'other-record',
      text: `Your sample leaves ${learned.map((c) => c.name).join(', ')} blank, so Dapi looked at other records' pages and found ${learned.map((c) => `${c.name} (e.g. “${fields[c.name].example}”)`).join(', ')}.`,
    });
  }

  onEvent({
    kind: 'detail',
    route: 'page',
    text: `Each record has a page like the one your spec names, at ${tmpl.template}. Dapi fetches it without a browser and reads ${Object.keys(fields).filter((c) => fields[c].keys.length).join(', ')} from it.`,
    url: recordPage.url,
    columns: Object.keys(fields),
  });
  return {
    kind: 'html',
    ...(upstream && { upstream }),
    urlFrom: { listField: tmpl.field, how: `put the list field's value into the URL template` },
    urlTemplate: tmpl.template,
    sampleUrl: recordPage.url,
    replay: { works: res.ok ? 'plain request' : null, needsSession: false, tried: res.ok ? [] : [`plain GET: HTTP ${res.status}`], timing },
    fields,
    jsonLd,
    trigger: { record: sample.label, control: 'the page your spec names', reason: 'Every record has a page with the same layout.' },
  };
}

// Other records' page addresses, the ones most unlike the sample's first: records whose
// yes/no fields differ from the sample record's (a sub-unit when the sample is a main
// unit) are likeliest to fill what the sample leaves blank.
function otherRecordUrls(list, tmpl, n) {
  return otherRecords(list, tmpl, n);
}
function otherRecords(list, tmpl, n) {
  const records = list.records.records;
  const own = records.find((r) => String(at(r, tmpl.field)) === tmpl.sampleValue);
  const flags = (r) =>
    JSON.stringify(r)
      .match(/"[^"]+":(true|false)/g)
      ?.join() ?? '';
  const ownFlags = own ? flags(own) : '';
  return records
    .filter((r) => r !== own && at(r, tmpl.field) !== undefined)
    .sort((a, b) => Number(flags(b) !== ownFlags) - Number(flags(a) !== ownFlags))
    .slice(0, n)
    .map((r) => ({ id: String(at(r, tmpl.field)), url: tmpl.template.replace(`{${tmpl.field}}`, encodeURIComponent(String(at(r, tmpl.field)))) }));
}

// Every list record, through the one big page when the list has one (a single request),
// else the records already in hand.
async function everyRecord(list) {
  const big = list.paging?.bigPage?.request;
  if (!big) return list.records.records;
  const res = await request(big.url, { method: big.method, body: big.payload ?? undefined, timeoutMs: 120_000 }).catch(() => null);
  const json = res?.ok ? parseJsonSafe(await res.text()) : null;
  return (json && findRecords(json)?.records) ?? list.records.records;
}

// A paged list: which parameter picks the page and which sets its size, and whether one
// big page holds every record (one request instead of twenty, gentler on the site).
const PAGE_PARAM = /^(page|pagenumber|page_number|pageindex|pageno|p|offset|skip|start|from)$/i;
const SIZE_PARAM = /^(pagesize|page_size|pagelength|limit|size|per_page|perpage|rows|take|max|hitsperpage)$/i;

async function paging(list, onEvent) {
  const cap = list.capture;
  const url = new URL(cap.url);
  let form = null;
  let body = null;
  try {
    body = cap.payload ? JSON.parse(cap.payload) : null;
  } catch {
    form = new URLSearchParams(cap.payload ?? '');
  }
  const names = [...url.searchParams.keys(), ...(form ? [...form.keys()] : []), ...(body && typeof body === 'object' ? Object.keys(body) : [])];
  const pageParam = names.find((n) => PAGE_PARAM.test(n)) ?? null;
  const sizeParam = names.find((n) => SIZE_PARAM.test(n)) ?? null;
  if (!pageParam && !sizeParam) return null;
  const total = list.total?.value ?? null;
  const out = { pageParam, sizeParam, pageSize: list.records.count, total, bigPage: null };
  // One page with everything when the total is modest; otherwise the biggest page size
  // the server honours, up to 1,000 (43,020 records in 44 requests instead of 2,868).
  if (sizeParam && total && total > list.records.count) {
    const size = String(Math.min(total, 1000));
    const u = new URL(cap.url);
    if (u.searchParams.has(sizeParam)) u.searchParams.set(sizeParam, size);
    let payload = cap.payload;
    if (form?.has(sizeParam)) {
      form.set(sizeParam, size);
      payload = form.toString();
    } else if (body && sizeParam in body) payload = JSON.stringify({ ...body, [sizeParam]: Number(size) });
    try {
      const res = await request(u.href, { method: cap.method, body: payload, headers: cap.headers?.['content-type'] ? { 'content-type': cap.headers['content-type'] } : {}, timeoutMs: 120_000 });
      const got = findRecords(parseJsonSafe(await res.text()))?.count ?? 0;
      if (got >= Math.min(total, Number(size))) out.bigPage = { size: Number(size), records: got, onePage: got >= total, request: { method: cap.method, url: u.href, payload } };
    } catch {
      // keep the paged route
    }
  }
  onEvent({
    kind: 'paging',
    text: out.bigPage
      ? out.bigPage.onePage
        ? `The list comes ${list.records.count} per page (${pageParam ?? 'page'}, ${sizeParam}), but asking for ${out.bigPage.size} per page returns all ${total} records in one request.`
        : `The list comes ${list.records.count} per page, but the server honours ${out.bigPage.size} per page: ${Math.ceil(total / out.bigPage.size)} requests for all ${total} records instead of ${Math.ceil(total / list.records.count)}.`
      : `The list comes in pages (${[pageParam, sizeParam].filter(Boolean).join(', ')})${total ? ` of ${total} records` : ''}: the extraction reads every page.`,
    ...out,
  });
  return out;
}

const parseJsonSafe = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

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
    return await checkReach(requests, { pace: detail ? detailRequests(list, detail, 24) : [] });
  } catch (err) {
    notes.push(`Reachability from Apify not checked: ${err.message.split('\n')[0]}`);
    return null;
  }
}

// Other records' detail requests, built the way the run will build them, for the pace
// test: a URL template filled with a list field, the link a list field holds, or the
// captured data request with the join parameter set to each record's value.
function detailRequests(list, detail, n) {
  const out = [];
  for (const record of list.records.records) {
    if (out.length >= n) break;
    try {
      if (detail.kind === 'html' && detail.urlTemplate) {
        const value = at(record, detail.urlFrom.listField);
        if (value !== undefined && value !== null) out.push({ label: 'pace', url: detail.urlTemplate.replace(`{${detail.urlFrom.listField}}`, encodeURIComponent(String(value))) });
      } else if (detail.kind === 'html') {
        const raw = String(at(record, detail.urlFrom.listField) ?? '').replace(/\\\//g, '/');
        const url = raw.match(/href="([^"]+)"/)?.[1] ?? raw.match(/https?:\/\/[^\s"'<>]+/)?.[0];
        if (url) out.push({ label: 'pace', url: url.startsWith('//') ? `https:${url}` : url });
      } else if (detail.kind === 'json' && detail.join) {
        const value = String(at(record, detail.join.listField) ?? '');
        if (!value) continue;
        const cap = detail.capture;
        const url = new URL(cap.url);
        let payload = cap.payload;
        if (detail.join.in === 'query') url.searchParams.set(detail.join.param, value);
        else if (detail.join.in === 'payload') {
          try {
            payload = JSON.stringify({ ...JSON.parse(payload), [detail.join.param]: value });
          } catch {
            const form = new URLSearchParams(payload ?? '');
            form.set(detail.join.param, value);
            payload = form.toString();
          }
        } else if (detail.join.in === 'path') {
          const parts = url.pathname.split('/');
          parts[Number(detail.join.param.replace('segment ', ''))] = encodeURIComponent(value);
          url.pathname = parts.join('/');
        }
        out.push({ label: 'pace', url: url.href, method: cap.method, payload, headers: cap.headers?.['content-type'] ? { 'content-type': cap.headers['content-type'] } : {} });
      }
    } catch {
      // a record without the field: skip it
    }
  }
  return out;
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
  // A sample with values for the missing columns, so the record we open has them. A spec
  // without samples (a spoken one) opens the list's first record instead and maps its
  // page by the labels.
  const anchors = Object.entries(list.fields).filter(([, f]) => f.keys.length === 1);
  const records = allListRecords(list, session);
  let samples = spec.samples.filter((s) => missing.some((c) => s.values[c.name]));
  if (!samples.length && records.length) {
    samples = [{ label: 'the first record', values: Object.fromEntries(anchors.map(([column, f]) => [column, String(at(records[0], f.keys[0]) ?? '')])) }];
  }

  // Each row is looked at once: the same row under another column's name would only ask
  // Muse Spark the same question again.
  const tried = new Set();
  for (const sample of samples) {
    for (const [column, field] of anchors) {
      const value = sample.values[column];
      if (!value || value.length < 4) continue;
      const record = records.find((r) => String(at(r, field.keys[0])) === value);
      if (!record) continue;
      try {

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
      const recordText = (await row.innerText()).replace(/\s+/g, ' ').slice(0, 300);
      if (tried.has(recordText)) continue;
      tried.add(recordText);

      await row.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
      const controls = await clickablesIn(row);
      if (!controls.length) continue;
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
        const html = await htmlDetail({ control, shownRecord, record, records, missing, sample, count, notes });
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
      } catch (err) {
        // One record's row misbehaving (a banner over it, a stale element) is a note,
        // never the end of the job: the agent picks up what's left.
        notes.push(`Revealing the missing columns on one record stopped: ${err.message.split('\n')[0]}`);
      }
    }
  }
  notes.push('Could not reveal the missing columns from any record.');
  return null;
}

// The detail link lives in one of the list record's fields (GPTW: an <a href> inside
// field 4). Take the sample record's own link from that field, fetch its page, and map
// the missing columns to verified selectors.
async function htmlDetail({ control, shownRecord, record, records, missing, sample, count, notes }) {
  const href = new URL(control.href, 'https://x.invalid').pathname;
  const fieldOf = (r) =>
    Object.keys(r).find((k) => typeof r[k] === 'string' && r[k].replace(/\\\//g, '/').includes(href));
  const linkField = fieldOf(shownRecord);
  if (linkField === undefined) {
    // The link isn't written in a field, but may be built from one: /register/{ID}.
    const absolute = new URL(control.href, control.base ?? 'https://x.invalid').href;
    const tmpl = absolute.startsWith('https://x.invalid') ? null : urlTemplate(absolute, [shownRecord, ...(records ?? [])]);
    if (!tmpl) {
      notes.push(`The "${control.text}" link isn't in any list field and isn't built from one, so it can't be addressed per record.`);
      return null;
    }
    const res = await request(absolute, { timeoutMs: 120_000 }).catch((err) => ({ ok: false, status: err.code ?? err.name }));
    if (!res.ok) {
      notes.push(`The record page ${absolute} returned ${res.status} to a plain request.`);
      return null;
    }
    const html = await res.text();
    const { fields, jsonLd } = await mapHtmlDetail({ html, missing, sample: { label: 'the record shown', values: {} }, count });
    return {
      kind: 'html',
      urlFrom: { listField: tmpl.field, how: `put the list field's value into the URL template` },
      urlTemplate: tmpl.template,
      sampleUrl: absolute,
      replay: { works: 'plain request', needsSession: false, tried: [], timing: null },
      fields,
      jsonLd,
    };
  }
  const raw = String(record[linkField]).replace(/\\\//g, '/');
  const url = raw.match(/href="([^"]+)"/)?.[1] ?? raw.match(/https?:\/\/[^\s"'<>]+/)?.[0];
  if (!url) return null;

  const started = Date.now();
  const res = await request(url, { timeoutMs: 120_000 }).catch((err) => ({ ok: false, status: err.code ?? err.name }));
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
    ...(source.paging && { paging: source.paging }),
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
    // The site's own language, from the page's markup.
    siteLanguage: session.html?.match(/<html[^>]*\blang="([a-z]{2})/i)?.[1]?.toLowerCase() ?? null,
    // The page the list was found on (its filters and config blocks often hold lookups).
    listPage: list ? session.finalUrl ?? null : null,
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
