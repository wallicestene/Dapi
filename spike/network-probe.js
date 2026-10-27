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

async function main() {
  const browser = await chromium.launch({ headless: true });
  // Service workers can answer requests from cache and hide the real network call.
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();

  // Playwright doesn't await our async handlers, so track them and settle before closing.
  const pending = [];

  // Listeners go on before goto, or we miss the document and early XHRs.
  page.on('requestfinished', (request) => {
    pending.push(logRequest(request));
  });

  page.on('requestfailed', (request) => {
    console.log('FAILED', request.method(), request.url(), request.failure()?.errorText);
  });

  await page.goto(url, { waitUntil: 'load' });
  try {
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
  } catch {
    console.log('(network never went idle, continuing anyway)');
  }

  await Promise.allSettled(pending);
  await browser.close();

  printJsonDetails();
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

  const isJson = looksLikeJson(contentType, body);

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
    });
  }
}

function looksLikeJson(contentType, body) {
  if (!body || body.length === 0) return false;
  if (contentType.includes('json')) return true;

  // Content-type is the server's claim. Some send JSON as text/plain or javascript.
  const text = body.toString('utf8').trimStart();
  if (!text.startsWith('{') && !text.startsWith('[')) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
