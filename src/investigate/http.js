// The investigator's plain HTTP requests (replays, detail pages, robots.txt). They go
// the same way in as the page did (directly, or through Apify Proxy when the site
// blocked the first visit) and use got-scraping, the client the run itself uses, so
// what works here works in the run.

import { gotScraping } from 'crawlee';
import { privateHost } from '../net-guard.js';

let proxyUrl;
export const useProxy = (url) => {
  proxyUrl = url;
};
export const currentProxy = () => proxyUrl;

export async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 60_000 } = {}) {
  if (await privateHost(url)) throw new Error(`${url} isn't a public address`);
  const res = await gotScraping({
    url,
    method,
    headers,
    body: body ?? undefined,
    proxyUrl,
    timeout: { request: timeoutMs },
    throwHttpErrors: false,
    responseType: 'buffer',
  });
  const bytes = res.body;
  return {
    ok: res.statusCode >= 200 && res.statusCode < 300,
    status: res.statusCode,
    url: res.url,
    headers: res.headers,
    buffer: async () => bytes,
    text: async () => bytes.toString('utf8'),
  };
}
