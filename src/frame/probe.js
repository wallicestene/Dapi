// Reachability probe, run on Apify. The investigation runs from the user's own
// connection, but extraction runs from Apify's servers, and some sites treat cloud
// IPs differently. This fetches the job's key requests from Apify, directly first,
// then through Apify Proxy (datacenter, then residential), and stops at the first
// way that works. Its answer is the evidence the code writer sets config.proxy from.

import { Actor } from 'apify';
import { gotScraping } from 'crawlee';
import { classifyBlock } from '../blocks.js';

// Cheapest first: residential traffic costs money, so it's tried last.
const MODES = ['direct', 'datacenter', 'residential'];


// requests: [{ label, url, method, payload, headers, expect }], where expect is a
// value that must be in the body for the response to count (a sample's name).
// pace: other records' detail requests, for measuring how the site holds up when asked
// for several at once (see paceTest).
export async function probe(requests, { countryCode, pace = [] } = {}) {
  const results = [];
  for (const mode of MODES) {
    let proxyConfiguration = null;
    if (mode !== 'direct') {
      try {
        // Apify Proxy uses datacenter IPs when no group is named.
        proxyConfiguration = await Actor.createProxyConfiguration(
          mode === 'residential' ? { groups: ['RESIDENTIAL'], countryCode } : { countryCode }
        );
      } catch (err) {
        results.push({ mode, error: `proxy not available: ${err.message.split('\n')[0]}` });
        continue;
      }
    }

    const outcomes = [];
    for (const r of requests) outcomes.push(await fetchOnce(r, mode, proxyConfiguration));
    results.push(...outcomes);
    if (outcomes.every((o) => o.works)) {
      return { recommendation: mode, results, ...(pace.length && { pace: await paceTest(pace, mode, proxyConfiguration) }) };
    }
  }
  return { recommendation: null, results };
}

// How fast the site answers one at a time, then three, then six at once, from the way
// in that worked. The sweet spot is the highest level with no errors whose answers
// don't slow to more than about twice the one-at-a-time time: past it, a site's
// server starts failing (Arbeidstilsynet answered HTTP 500 at eight) and the run gets
// slower, not faster.
const LEVELS = [1, 3, 6];
async function paceTest(requests, mode, proxyConfiguration) {
  const levels = [];
  let next = 0;
  const take = (n) => Array.from({ length: n }, () => requests[next++ % requests.length]);
  for (const level of LEVELS) {
    const batch = take(level === 1 ? 3 : level * 2);
    const outcomes = [];
    let i = 0;
    await Promise.all(
      Array.from({ length: level }, async () => {
        while (i < batch.length) outcomes.push(await fetchOnce(batch[i++], mode, proxyConfiguration));
      })
    );
    const ms = outcomes.filter((o) => o.works).map((o) => o.ms).sort((a, b) => a - b);
    const errors = outcomes.filter((o) => !o.works);
    levels.push({
      concurrency: level,
      requests: outcomes.length,
      medianMs: ms.length ? ms[Math.floor(ms.length / 2)] : null,
      slowestMs: ms.at(-1) ?? null,
      errors: errors.length,
      errorKinds: [...new Set(errors.map((e) => e.error ?? `HTTP ${e.status}`))],
    });
    if (errors.length) break;
  }
  const base = levels[0]?.medianMs ?? null;
  const good = levels.filter((l) => !l.errors && l.medianMs !== null && (!base || l.medianMs <= base * 2.2));
  const best = good.at(-1) ?? { concurrency: 1, medianMs: base ?? 2000 };
  // Requests a minute at that level, with a fifth held back for the site's bad moments.
  const perMinute = Math.max(30, Math.min(1200, Math.round(((best.concurrency * 60_000) / Math.max(150, best.medianMs ?? 1000)) * 0.8)));
  return { levels, recommended: { concurrency: best.concurrency, perMinute }, erroredAt: levels.find((l) => l.errors)?.concurrency ?? null };
}

async function fetchOnce(r, mode, proxyConfiguration) {
  const started = Date.now();
  try {
    const res = await gotScraping({
      url: r.url,
      method: r.method ?? 'GET',
      body: r.payload ?? undefined,
      headers: r.headers ?? {},
      proxyUrl: proxyConfiguration ? await proxyConfiguration.newUrl() : undefined,
      timeout: { request: 90_000 },
      throwHttpErrors: false,
    });
    const body = String(res.body ?? '');
    // A refusal even behind a 200; one that wants a person is noted as such.
    const check = classifyBlock({ status: res.statusCode, body });
    const blocked = Boolean(check);
    const hasData = !r.expect || body.includes(r.expect);
    return {
      mode,
      label: r.label,
      status: res.statusCode,
      ms: Date.now() - started,
      bytes: Buffer.byteLength(body),
      blocked,
      ...(check?.kind === 'human' && { human: check.what }),
      hasData,
      works: res.statusCode < 400 && !blocked && hasData,
    };
  } catch (err) {
    return { mode, label: r.label, error: err.code ?? err.name, ms: Date.now() - started, works: false };
  }
}
