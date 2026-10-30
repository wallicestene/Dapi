// Calls a captured endpoint again without the browser, starting with the least we
// can send. The first attempt that gets the same records back decides the route.
// Ported from spike/network-probe.js.

import { parseJson, findRecords } from './data.js';
import { extractEmbedded } from '../embedded.js';

// Embedded data replays if a plain GET of the page holds the same literal, at the same
// path, with about as many rows (sites add and remove records between fetches).
export async function replayEmbedded(url, name, recordsPath, count) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return { works: null, needsSession: null, tried: [`plain GET: HTTP ${res.status}`] };
    const entry = extractEmbedded(await res.text()).find((e) => e.name === name);
    const records = entry && findRecords(entry.value);
    if (records?.path === recordsPath && Math.abs(records.count - count) <= Math.max(5, count * 0.05)) {
      return { works: 'plain request', needsSession: false, tried: [] };
    }
    return { works: null, needsSession: null, tried: [`plain GET: ${entry ? 'different content' : `no embedded ${name}`}`] };
  } catch (err) {
    return { works: null, needsSession: null, tried: [`plain GET: ${err.name}`] };
  }
}

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
    const result = await tryOnce(capture, attempt.headers, recordsPath);
    if (result === 'ok') return { works: attempt.label, needsSession: Boolean(attempt.needsSession), tried };
    tried.push(`${attempt.label}: ${result}`);
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
    if (!res.ok) return `HTTP ${res.status}`;
    const json = parseJson(Buffer.from(await res.arrayBuffer()));
    if (findRecords(json)?.path !== recordsPath) return `HTTP ${res.status} but different content`;
    return 'ok';
  } catch (err) {
    return err.name;
  }
}
