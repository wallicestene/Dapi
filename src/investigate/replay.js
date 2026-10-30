// Calls a captured endpoint again without the browser, starting with the least we
// can send. The first attempt that gets the same records back decides the route.
// Ported from spike/network-probe.js.

import { parseJson, findRecords } from './data.js';
import { extractEmbedded } from '../embedded.js';

// Embedded data replays if a plain GET of the page holds the same literal, at the same
// path, with about as many rows (sites add and remove records between fetches). The
// literal is recognised by the text before it, never by its name: names follow script
// order, which differs between URLs of the same page (GPTW: s7.0 on ?type=mid is s9.0
// without the query). Returns the page's entries, so callers can rename.
export async function replayEmbedded(url, context, recordsPath, count) {
  try {
    // Pages with embedded data can be megabytes from a slow server (GPTW: 2.4 MB, ~30 s).
    const started = Date.now();
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(300_000) });
    if (!res.ok) return { works: null, needsSession: null, tried: [`plain GET: HTTP ${res.status}`] };
    const html = await res.text();
    const timing = { ms: Date.now() - started, bytes: Buffer.byteLength(html) };
    const entries = extractEmbedded(html);
    const entry = entries.find((e) => sameContext(e.context, context));
    const records = entry && findRecords(entry.value);
    if (records?.path === recordsPath && Math.abs(records.count - count) <= Math.max(5, count * 0.05)) {
      return { works: 'plain request', needsSession: false, tried: [], entries, timing };
    }
    return { works: null, needsSession: null, tried: [`plain GET: ${entry ? 'different content' : 'no matching embedded data'}`] };
  } catch (err) {
    return { works: null, needsSession: null, tried: [`plain GET: ${err.name}`] };
  }
}

// The text right before a literal identifies it: compare the last 60 characters.
export const sameContext = (a, b) => a.slice(-60) === b.slice(-60);

// Headers fetch sets itself, or that would break a replay.
const SKIP = new Set(['host', 'content-length', 'connection', 'accept-encoding']);
// Headers that carry a session: cookies, auth and CSRF tokens.
const SESSION = /^(cookie|authorization)$|token|csrf|xsrf|api-?key/i;

export async function replay(capture, recordsPath) {
  const browserHeaders = {};
  const sessionHeaders = {};
  for (const [key, value] of Object.entries(capture.headers)) {
    if (key.startsWith(':') || SKIP.has(key)) continue;
    if (SESSION.test(key)) sessionHeaders[key] = value;
    else browserHeaders[key] = value;
  }
  // A form or JSON body needs its content-type even in the plainest request.
  const contentType = browserHeaders['content-type'] ? { 'content-type': browserHeaders['content-type'] } : {};

  const attempts = [{ label: 'plain request', headers: contentType }];
  attempts.push({ label: 'with browser headers', headers: browserHeaders });
  if (Object.keys(sessionHeaders).length) {
    attempts.push({ label: 'with session', headers: { ...browserHeaders, ...sessionHeaders }, needsSession: true });
  }

  const tried = [];
  for (const attempt of attempts) {
    const started = Date.now();
    const result = await tryOnce(capture, attempt.headers, recordsPath);
    if (result.ok) {
      // How the site behaved, for choosing the run's speed: time and size of one call.
      const timing = { ms: Date.now() - started, bytes: result.bytes };
      return { works: attempt.label, needsSession: Boolean(attempt.needsSession), tried, timing };
    }
    tried.push(`${attempt.label}: ${result.error}`);
  }
  return { works: null, needsSession: null, tried };
}

// Counts only if the same records come back: a block page can return 200 too.
async function tryOnce(capture, headers, recordsPath) {
  try {
    const res = await fetch(capture.url, {
      method: capture.method,
      headers,
      body: capture.method === 'GET' ? undefined : (capture.payload ?? undefined),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (findRecords(parseJson(bytes))?.path !== recordsPath) return { ok: false, error: `HTTP ${res.status} but different content` };
    return { ok: true, bytes: bytes.length };
  } catch (err) {
    return { ok: false, error: err.name };
  }
}
