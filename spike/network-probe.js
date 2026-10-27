// Throwaway spike: how often does a page's data come from a JSON endpoint
// we could call directly? See "Spikes in flight" in AGENTS.md.
// Usage: node network-probe.js <url>

const { chromium } = require('playwright');

const url = process.argv[2];
if (!url) {
  console.error('Usage: node network-probe.js <url>');
  process.exit(1);
}

const jsonResponses = [];
let requestCount = 0;
let failedCount = 0;

async function main() {
  const browser = await chromium.launch({ headless: true });
  // Service workers can answer requests from cache and hide the real network call.
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();

  // Playwright doesn't await our async handlers, so track them and settle before closing.
  const pending = [];

  // Listeners go on before goto, or we miss the document and early XHRs.
  page.on('requestfinished', (request) => {
    requestCount++;
    pending.push(logRequest(request));
  });

  page.on('requestfailed', (request) => {
    failedCount++;
    console.log('FAILED', request.method(), request.url(), request.failure()?.errorText);
  });

  // goto returns the final response after redirects, so a bot wall shows up here as 403.
  const mainResponse = await page.goto(url, { waitUntil: 'load' });
  try {
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
  } catch {
    console.log('(network never went idle, continuing anyway)');
  }

  await Promise.allSettled(pending);
  await browser.close();

  printJsonDetails();
  printSummary(mainResponse?.status());
}

async function logRequest(request) {
  const response = await request.response();
  if (!response) return;

  const contentType = response.headers()['content-type'] ?? '';
  let body = null;
  try {
    body = await response.body();
  } catch {
    // redirects have no body
  }

  const json = parseJson(body);
  const isJson = json !== undefined || (contentType.includes('json') && body?.length > 0);

  console.log(
    isJson ? 'JSON' : '    ',
    request.method(),
    response.status(),
    request.resourceType().padEnd(10),
    String(body?.length ?? '?').padStart(8) + 'B',
    contentType.split(';')[0].padEnd(24),
    request.url().slice(0, 120)
  );

  if (isJson) {
    jsonResponses.push({
      method: request.method(),
      url: request.url(),
      status: response.status(),
      resourceType: request.resourceType(),
      size: body.length,
      postData: request.postData(),
      // allHeaders() includes cookie and other headers that headers() leaves out.
      headers: await request.allHeaders(),
      preview: body.toString('utf8').trimStart().slice(0, 500),
      json,
    });
  }
}

// Parses the body whatever the content-type says: some servers send JSON as
// text/plain or javascript. Returns undefined if it isn't JSON.
function parseJson(body) {
  if (!body || body.length === 0) return undefined;

  // Some APIs prefix JSON with )]}' so it can't be run as a script.
  const text = body.toString('utf8').trim().replace(/^\)\]\}',?/, '').trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Headers every browser request carries; they say nothing about this endpoint.
const BORING_HEADERS = new Set(['user-agent', 'accept-language', 'accept-encoding']);

function printJsonDetails() {
  console.log(`\n=== ${jsonResponses.length} JSON responses ===`);

  for (const r of jsonResponses) {
    console.log(`\n${r.method} ${r.status} ${r.resourceType} ${r.size}B`);
    console.log(`  url     ${r.url}`);

    for (const [key, value] of new URL(r.url).searchParams) {
      console.log(`  param   ${key} = ${value.slice(0, 100)}`);
    }

    if (r.postData) {
      console.log(`  body    ${r.postData.slice(0, 300)}`);
    }

    for (const [key, value] of Object.entries(r.headers)) {
      // ':authority', ':path' etc. are HTTP/2 pseudo-headers that repeat the URL.
      if (BORING_HEADERS.has(key) || key.startsWith('sec-') || key.startsWith(':')) continue;
      console.log(`  header  ${key}: ${value.slice(0, 100)}`);
    }

    console.log(`  preview ${r.preview}`);
  }
}

// Hosts that serve analytics, ads and surveys, never the page's own data.
const TRACKER_HOSTS = [
  'doubleclick.net', 'googleadservices.com', 'google-analytics.com', 'googletagmanager.com',
  'demdex.net', 'omtrdc.net', 'qualtrics.com', 'visualstudio.com', 'facebook.net',
  'facebook.com', 'linkedin.com', 'licdn.com', 'hotjar.com', 'clarity.ms', 'segment.io',
  'mixpanel.com', 'amplitude.com', 'sentry.io', 'nr-data.net', 'cloudflareinsights.com',
];

function isTracker(requestUrl) {
  const { hostname, pathname } = new URL(requestUrl);
  if (TRACKER_HOSTS.some((h) => hostname === h || hostname.endsWith('.' + h))) return true;
  // Adobe Analytics often runs on the site's own subdomain, e.g. smetrics.worldbank.org.
  if (/^s?metrics\./.test(hostname)) return true;
  return /\/(collect|track|beacon|pixel|telemetry|analytics)\b/.test(pathname);
}

// Finds the biggest list of similar-looking objects anywhere in the JSON.
// Records can be an array, or an object keyed by ID like World Bank's "projects".
function findRecords(value, path = '$', depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return null;

  const items = Array.isArray(value) ? value : Object.values(value);
  const objects = items.filter((v) => v && typeof v === 'object' && !Array.isArray(v));
  let best = null;

  if (objects.length >= 3 && objects.length === items.length) {
    const firstKeys = Object.keys(objects[0]);
    const similar = objects.every(
      (o) => firstKeys.filter((k) => k in o).length >= firstKeys.length / 2
    );
    if (similar) best = { path, count: objects.length, bytes: JSON.stringify(value).length };
  }

  // Compare by bytes, not count: 100 tiny filter entries shouldn't beat 20 full records.
  for (const [key, child] of Object.entries(value)) {
    const found = findRecords(child, `${path}.${key}`, depth + 1);
    if (found && (!best || found.bytes > best.bytes)) best = found;
  }
  return best;
}

// The source's own claim of how many records exist. This is what the
// completeness count will check against.
const TOTAL_KEYS = [
  'total', 'totalcount', 'total_count', 'totalresults', 'total_results', 'numfound',
  'recordstotal', 'totalhits', 'totalelements', 'totalitems', 'count',
];

function findTotal(value, depth = 0) {
  if (depth > 2 || value === null || typeof value !== 'object' || Array.isArray(value)) return null;

  for (const [key, child] of Object.entries(value)) {
    if (TOTAL_KEYS.includes(key.toLowerCase()) && Number.isFinite(Number(child))) {
      return { key, value: Number(child) };
    }
  }
  for (const child of Object.values(value)) {
    const found = findTotal(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function shortUrl(requestUrl) {
  const { host, pathname } = new URL(requestUrl);
  return host + pathname;
}

function printSummary(mainStatus) {
  const data = [];
  const tracking = [];
  const other = [];

  for (const r of jsonResponses) {
    if (isTracker(r.url)) {
      tracking.push(r);
      continue;
    }
    const records = findRecords(r.json);
    if (records) data.push({ ...r, records, total: findTotal(r.json) });
    else other.push(r);
  }

  // Biggest first: the page's main data is usually its largest response.
  data.sort((a, b) => b.size - a.size);

  console.log('\n=== Summary ===');
  console.log(`Page:      ${url} (status ${mainStatus ?? '?'})`);
  console.log(`Requests:  ${requestCount + failedCount} total, ${failedCount} failed`);
  console.log(
    `JSON:      ${jsonResponses.length} responses: ${data.length} data, ` +
      `${tracking.length} tracking, ${other.length} other`
  );

  for (const r of data) {
    const total = r.total ? `, source says ${r.total.value} total ("${r.total.key}")` : '';
    console.log(
      `  DATA   ${r.method} ${shortUrl(r.url)}  ${r.size}B, ` +
        `${r.records.count} records at ${r.records.path}${total}`
    );
  }
  for (const r of other) {
    console.log(`  OTHER  ${r.method} ${shortUrl(r.url)}  ${r.size}B`);
  }

  let verdict;
  if (mainStatus >= 400) verdict = `BLOCKED: page returned ${mainStatus}`;
  else if (data.length > 0) verdict = 'JSON ENDPOINT FOUND';
  else verdict = 'NO JSON DATA: needs the HTML route';
  console.log(`Verdict:   ${verdict}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
