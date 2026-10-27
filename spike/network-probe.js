// Throwaway spike: how often does a page's data come from a JSON endpoint
// we could call directly? See "Spikes in flight" in AGENTS.md.
// Usage: node network-probe.js <url> [field ...]
//   e.g. node network-probe.js https://example.gov/companies "company name" "status"

const { chromium } = require('playwright');

// MODEL_API_KEY lives in dapi/.env, which is gitignored. Never hard-code it.
try {
  process.loadEnvFile(`${__dirname}/../.env`);
} catch {
  // No .env file: use whatever the shell environment has.
}

const url = process.argv[2];
// The fields the user wants. Optional, but without them the probe can only guess by size.
const fields = process.argv.slice(3);
if (!url) {
  console.error('Usage: node network-probe.js <url> [field ...]');
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
  // 'load' waits for every image and script, and some apps never get there. We only
  // need the network traffic, so wait for the DOM and don't let a slow page kill the run.
  let mainResponse = null;
  try {
    mainResponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (err) {
    console.log(`(navigation did not finish: ${err.message.split('\n')[0]})`);
  }
  try {
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
  } catch {
    console.log('(network never went idle, continuing anyway)');
  }

  await Promise.allSettled(pending);
  await browser.close();

  printJsonDetails();
  await printSummary(mainResponse?.status());
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
    if (similar) {
      best = {
        path,
        count: objects.length,
        bytes: JSON.stringify(value).length,
        sample: objects.slice(0, 2),
      };
    }
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

// Headers fetch sets itself, or that would break a replay.
const SKIP_ON_REPLAY = new Set(['host', 'content-length', 'connection', 'accept-encoding']);
// Headers that carry a session: cookies, auth and CSRF tokens.
const SESSION_HEADER = /^(cookie|authorization)$|token|csrf|xsrf|api-?key/i;

// Calls a data endpoint again without the browser, starting with the least we
// can send. The first attempt that gets the same records back decides the method.
async function replay(r) {
  const browserHeaders = {};
  const sessionHeaders = {};
  for (const [key, value] of Object.entries(r.headers)) {
    if (key.startsWith(':') || SKIP_ON_REPLAY.has(key)) continue;
    if (SESSION_HEADER.test(key)) sessionHeaders[key] = value;
    else browserHeaders[key] = value;
  }

  const attempts = [{ label: 'plain request', method: r.method, headers: {} }];
  // A POST with no body may also work as a GET (World Bank's did).
  if (r.method === 'POST' && !r.postData) {
    attempts.push({ label: 'plain GET', method: 'GET', headers: {} });
  }
  attempts.push({ label: 'with browser headers', method: r.method, headers: browserHeaders });
  if (Object.keys(sessionHeaders).length > 0) {
    attempts.push({
      label: `with session (${Object.keys(sessionHeaders).join(', ')})`,
      method: r.method,
      headers: { ...browserHeaders, ...sessionHeaders },
      needsSession: true,
    });
  }

  const failures = [];
  for (const attempt of attempts) {
    const result = await tryRequest(r, attempt);
    if (result === 'ok') return { attempt, failures };
    failures.push(`${attempt.label}: ${result}`);
  }
  return { attempt: null, failures };
}

// A replay only counts if it returns the same records, not just a 200:
// a WAF block page or an empty result can come back as 200 too.
async function tryRequest(r, attempt) {
  try {
    const res = await fetch(r.url, {
      method: attempt.method,
      headers: attempt.headers,
      body: attempt.method === 'GET' ? undefined : (r.postData ?? undefined),
      signal: AbortSignal.timeout(15_000),
    });
    const json = parseJson(Buffer.from(await res.arrayBuffer()));
    if (!res.ok) return `HTTP ${res.status}`;
    if (findRecords(json)?.path !== r.records.path) return `HTTP ${res.status} but different content`;
    return 'ok';
  } catch (err) {
    return err.name;
  }
}

const MODEL_API = 'https://api.meta.ai/v1/chat/completions';
const MODEL = 'muse-spark-1.3';

// Kept first and unchanged so the API can cache it.
const MATCH_PROMPT = `You help a data extraction tool pick which JSON endpoint holds the records a user wants.
You get the page URL, the fields the user asked for, and the JSON endpoints the page called, each with sample records.
Pick the endpoint whose records are the items the user wants: one record per company, tender, project and so on.
Lookup lists, filter options, settings, feature flags and translations are not the user's records.
For each requested field, give the key inside a record that holds it, using dots for nesting (e.g. "address.city"), or null if no key holds it.
Set best to null if no endpoint holds the user's records.`;

const MATCH_SCHEMA = {
  type: 'object',
  properties: {
    best: { type: ['integer', 'null'] },
    fields: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          key: { type: ['string', 'null'] },
        },
        required: ['field', 'key'],
        additionalProperties: false,
      },
    },
    reason: { type: 'string' },
  },
  required: ['best', 'fields', 'reason'],
  additionalProperties: false,
};

// Trims long strings, arrays and deep nesting so sample records fit in a small prompt.
function shrink(value, depth = 0) {
  if (typeof value === 'string') return value.length > 80 ? value.slice(0, 80) + '…' : value;
  if (Array.isArray(value)) return value.slice(0, 3).map((v) => shrink(v, depth + 1));
  if (value && typeof value === 'object') {
    if (depth > 2) return '{…}';
    return Object.fromEntries(
      Object.entries(value).slice(0, 40).map(([k, v]) => [k, shrink(v, depth + 1)])
    );
  }
  return value;
}

// Matching "registration number" to a key like reg_no is a question of meaning,
// not spelling, which is why this is a model call and not a string comparison.
async function matchFields(candidates) {
  const payload = {
    pageUrl: url,
    fields,
    endpoints: candidates.map((r, i) => ({
      id: i,
      endpoint: `${r.method} ${shortUrl(r.url)}`,
      recordPath: r.records.path,
      recordCount: r.records.count,
      sampleRecords: r.records.sample.map((s) => shrink(s)),
    })),
  };

  const res = await fetch(MODEL_API, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.MODEL_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      // Picking from a handful of samples doesn't need deep thinking. On chat
      // completions the parameter is reasoning_effort, not reasoning.effort.
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: MATCH_PROMPT },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'field_match', schema: MATCH_SCHEMA, strict: true },
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const body = await res.json();
  return { ...JSON.parse(body.choices[0].message.content), usage: body.usage };
}

// Returns null when matching can't run or goes wrong, so the summary falls back to size.
async function tryMatchFields(data) {
  if (fields.length === 0 || data.length === 0) return null;
  if (!process.env.MODEL_API_KEY) {
    console.log('(MODEL_API_KEY not set: skipping field matching)');
    return null;
  }
  try {
    const match = await matchFields(data);
    if (match.best != null && !data[match.best]) {
      console.log(`(field matching returned unknown endpoint id ${match.best}, ignoring it)`);
      return null;
    }
    return match;
  } catch (err) {
    console.log(`(field matching failed: ${err.message})`);
    return null;
  }
}

// The routes map onto the method table in AGENTS.md.
function routeFor(candidates) {
  const replayed = candidates.filter((r) => r.replay.attempt);
  if (replayed.some((r) => !r.replay.attempt.needsSession)) return 'API ROUTE: endpoint callable directly';
  if (replayed.length > 0) return 'HYBRID ROUTE: endpoint needs the browser session';
  return 'BROWSER ROUTE: endpoint found but not callable outside the browser';
}

function shortUrl(requestUrl) {
  const { host, pathname } = new URL(requestUrl);
  return host + pathname;
}

async function printSummary(mainStatus) {
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

  // Biggest first: without the user's fields, size is the only hint we have.
  data.sort((a, b) => b.size - a.size);

  // With the user's fields, Muse Spark picks the endpoint that actually holds them.
  const match = await tryMatchFields(data);
  if (match?.best != null) data.unshift(...data.splice(match.best, 1));

  console.log('\n=== Summary ===');
  console.log(`Page:      ${url} (status ${mainStatus ?? '?'})`);
  console.log(`Requests:  ${requestCount + failedCount} total, ${failedCount} failed`);
  console.log(
    `JSON:      ${jsonResponses.length} responses: ${data.length} data, ` +
      `${tracking.length} tracking, ${other.length} other`
  );

  if (match) {
    const { prompt_tokens: tokensIn = '?', completion_tokens: tokensOut = '?' } = match.usage ?? {};
    console.log(`Fields:    matched by ${MODEL} (${tokensIn} tokens in, ${tokensOut} out)`);
    for (const f of match.fields) console.log(`  "${f.field}" -> ${f.key ?? 'not found'}`);
    console.log(`  why: ${match.reason}`);
  }

  for (const [i, r] of data.entries()) {
    const label = i === 0 && match?.best != null ? 'MATCH' : 'DATA ';
    const total = r.total ? `, source says ${r.total.value} total ("${r.total.key}")` : '';
    console.log(
      `  ${label}  ${r.method} ${shortUrl(r.url)}  ${r.size}B, ` +
        `${r.records.count} records at ${r.records.path}${total}`
    );

    r.replay = await replay(r);
    const steps = [...r.replay.failures];
    if (r.replay.attempt) steps.push(`${r.replay.attempt.label}: works`);
    console.log(`         replay: ${steps.join(' | ')}`);
  }
  for (const r of other) {
    console.log(`  OTHER  ${r.method} ${shortUrl(r.url)}  ${r.size}B`);
  }

  let verdict;
  if ([401, 403, 429].includes(mainStatus)) verdict = `BLOCKED: page returned ${mainStatus}`;
  else if (mainStatus >= 400) verdict = `ERROR: page returned ${mainStatus}`;
  else if (data.length === 0 && mainStatus === undefined) verdict = 'NOT LOADED: page never finished loading';
  else if (data.length === 0) verdict = 'HTML ROUTE: no JSON data found';
  else if (match && match.best == null) verdict = 'HTML ROUTE: no JSON endpoint holds the requested fields';
  // With a match, only the matched endpoint counts; without one, any data endpoint does.
  else verdict = routeFor(match ? [data[0]] : data);
  console.log(`Verdict:   ${verdict}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
