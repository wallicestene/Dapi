// A page session for the investigator: loads the page, captures every JSON response
// tagged with the phase it happened in (the load, or a click), and lists the
// clickable controls near a record so Muse Spark can choose one.

import { chromium } from 'playwright';
import { parseJson } from './data.js';
import { classifyBlock } from '../blocks.js';
import { privateHost } from '../net-guard.js';

// proxy: Playwright's { server, username, password } for Apify Proxy, or none.
export async function openPage(url, { proxy } = {}) {
  const browser = await chromium.launch({ headless: true, ...(proxy && { proxy }) });
  // Service workers can answer requests from cache and hide the real network call.
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 1000 } });
  // Nothing the page asks for may reach the server's own network (src/net-guard.js).
  await context.route('**/*', async (route) => ((await privateHost(route.request().url())) ? route.abort('blockedbyclient') : route.continue()));
  const page = await context.newPage();

  const captured = [];
  const pending = [];
  let phase = 'load';
  let inflight = 0;

  // Listeners go on before goto, or the first requests are missed.
  page.on('request', () => inflight++);
  page.on('requestfailed', () => inflight--);
  page.on('requestfinished', (request) => {
    inflight--;
    pending.push(record(request, phase));
  });

  // Never throws: a request still finishing when the page closes is simply not recorded.
  async function record(request, inPhase) {
    let response;
    let body;
    try {
      response = await request.response();
      if (!response) return;
      body = await response.body();
    } catch {
      return; // redirects have no body; a closed page has no response
    }
    const json = parseJson(body);
    // Data requests that aren't JSON (an HTML fragment behind "Load more") are kept too,
    // with their text; documents, scripts and images are not.
    const data = ['xhr', 'fetch'].includes(request.resourceType());
    if (json === undefined && !data) return;
    captured.push({
      phase: inPhase,
      method: request.method(),
      url: request.url(),
      payload: request.postData(),
      status: response.status(),
      // allHeaders() includes cookie and other headers that headers() leaves out.
      headers: await request.allHeaders().catch(() => ({})),
      size: body.length,
      json: json === undefined ? null : json,
      ...(json === undefined && { text: body.toString('utf8').slice(0, 20_000), contentType: response.headers()['content-type'] ?? null }),
    });
  }

  // networkidle only fires once per navigation, so after a click we wait for our own
  // quiet period instead: no request in flight for 700 ms, or 10 s at most.
  async function quiet(quietMs = 700, maxMs = 10_000) {
    const end = Date.now() + maxMs;
    let quietSince = Date.now();
    while (Date.now() < end) {
      await new Promise((r) => setTimeout(r, 100));
      if (inflight > 0) quietSince = Date.now();
      else if (Date.now() - quietSince >= quietMs) break;
    }
    await Promise.allSettled(pending.splice(0));
  }

  let status;
  let html = null;
  try {
    // goto returns the final response after redirects, so a bot wall shows up as 403.
    // Generous: a 2 MB page on a slow government server can take over a minute.
    const main = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    status = main?.status();
    // The HTML as the server sent it, before scripts changed the DOM: embedded data
    // lives here, and it's what a plain GET will see.
    html = (await main?.text().catch(() => null)) ?? null;
  } catch (err) {
    console.log(`(navigation did not finish: ${err.message.split('\n')[0]})`);
  }
  await quiet(1500, 20_000);

  // A bot check that clears itself in a real browser (Cloudflare's "Just a moment",
  // "Verifying you are human"): wait it out, then read the page it lets through.
  let check = classifyBlock({ status, body: html ?? '' });
  if (check?.kind === 'blocked') {
    const cleared = await page
      .waitForFunction(
        () => !/just a moment|verifying you are human|checking your browser|one more step/i.test(`${document.title} ${document.body?.innerText.slice(0, 600) ?? ''}`),
        null,
        { timeout: 25_000 }
      )
      .then(() => true)
      .catch(() => false);
    if (cleared) {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await quiet(1500, 20_000);
      html = await page.content();
      status = 200;
    }
  }
  // A cookie banner sits over the page and catches clicks meant for it: dismiss it the
  // way a visitor would, refusing where the banner offers that.
  await dismissCookieBanner(page);

  // Widgets that ask for a person arrive by script, so the rendered page decides.
  check = classifyBlock({ status, body: html ?? '' }) && classifyBlock({ status, body: await page.content().catch(() => html ?? '') });

  return {
    page,
    status,
    html,
    check,
    finalUrl: page.url(),
    captured,
    // Runs an action (a click) and returns the JSON captured because of it.
    async during(name, action) {
      phase = name;
      await action();
      await quiet();
      return captured.filter((c) => c.phase === name);
    },
    close: () => browser.close(),
  };
}

export async function dismissCookieBanner(page) {
  const refuse = /^(reject all|reject|decline|deny|only necessary|necessary only|avvis( alle)?|alle ablehnen|tout refuser|rechazar todo)$/i;
  const accept = /^(accept all|accept|allow all|i agree|agree|ok|got it|godta( alle)?|aksepter( alle)?|alle akzeptieren|tout accepter|aceptar todo)$/i;
  for (const re of [refuse, accept]) {
    const button = page.locator('button, a[role=button], [role=button]').filter({ hasText: re });
    try {
      if (await button.count()) {
        await button.first().click({ timeout: 2000 });
        await page.waitForTimeout(400);
        return true;
      }
    } catch {
      // not clickable: try the next kind
    }
  }
  return false;
}

// Finds the element showing a record's text and returns its row: the nearest
// container that looks like one record (a table row, list item, card).
export async function findRecordRow(page, text) {
  const hit = page.getByText(text, { exact: false }).first();
  if ((await hit.count()) === 0) return null;
  const row = hit.locator(
    'xpath=ancestor-or-self::*[self::tr or self::li or self::article or @role="row" or contains(@class,"card") or contains(@class,"row")][1]'
  );
  return (await row.count()) ? row.first() : hit;
}

// The clickable controls inside a record's row, numbered for Muse Spark.
export async function clickablesIn(row) {
  const controls = row.locator('a, button, [role=button], input[type=button], input[type=submit], [onclick]');
  const list = [];
  for (let i = 0; i < Math.min(await controls.count(), 30); i++) {
    const el = controls.nth(i);
    if (!(await el.isVisible())) continue;
    const text = (await el.innerText().catch(() => '')).trim() || (await el.getAttribute('title')) || (await el.getAttribute('aria-label')) || '';
    list.push({ id: list.length, text: text.replace(/\s+/g, ' ').slice(0, 60), tag: await el.evaluate((e) => e.tagName.toLowerCase()), href: await el.getAttribute('href'), base: row.page().url(), element: el });
  }
  return list;
}
