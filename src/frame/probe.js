// Reachability probe, run on Apify. The investigation runs from the user's own
// connection, but extraction runs from Apify's servers, and some sites treat cloud
// IPs differently. This fetches the job's key requests from Apify, directly first,
// then through Apify Proxy (datacenter, then residential), and stops at the first
// way that works. Its answer is the evidence the code writer sets config.proxy from.

import { Actor } from 'apify';
import { gotScraping } from 'crawlee';

// Cheapest first: residential traffic costs money, so it's tried last.
const MODES = ['direct', 'datacenter', 'residential'];

// Signs that the site refused, even behind a 200.
const BLOCK_SIGNS = /just a moment|cf-chl|captcha|access denied|attention required|are you a robot|request blocked/i;

// requests: [{ label, url, method, payload, headers, expect }], where expect is a
// value that must be in the body for the response to count (a sample's name).
export async function probe(requests, { countryCode } = {}) {
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
    if (outcomes.every((o) => o.works)) return { recommendation: mode, results };
  }
  return { recommendation: null, results };
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
    const blocked = [401, 403, 407, 429, 503].includes(res.statusCode) || BLOCK_SIGNS.test(body.slice(0, 5000));
    const hasData = !r.expect || body.includes(r.expect);
    return {
      mode,
      label: r.label,
      status: res.statusCode,
      ms: Date.now() - started,
      bytes: Buffer.byteLength(body),
      blocked,
      hasData,
      works: res.statusCode < 400 && !blocked && hasData,
    };
  } catch (err) {
    return { mode, label: r.label, error: err.code ?? err.name, ms: Date.now() - started, works: false };
  }
}
