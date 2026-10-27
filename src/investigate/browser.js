// A page session for the investigator: loads the page, captures every JSON response
// tagged with the phase it happened in (the load, or a click), and lists the
// clickable controls near a record so Muse Spark can choose one.

import { chromium } from 'playwright';
import { parseJson } from './data.js';

export async function openPage(url) {
  const browser = await chromium.launch({ headless: true });
  // Service workers can answer requests from cache and hide the real network call.
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 1000 } });
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

  async function record(request, inPhase) {
    const response = await request.response();
    if (!response) return;
    let body;
    try {
      body = await response.body();
    } catch {
      return; // redirects have no body
    }
    const json = parseJson(body);
    if (json === undefined) return;
    captured.push({
      phase: inPhase,
      method: request.method(),
      url: request.url(),
      payload: request.postData(),
      status: response.status(),
      // allHeaders() includes cookie and other headers that headers() leaves out.
      headers: await request.allHeaders(),
      size: body.length,
      json,
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
  try {
    // goto returns the final response after redirects, so a bot wall shows up as 403.
    status = (await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }))?.status();
  } catch (err) {
    console.log(`(navigation did not finish: ${err.message.split('\n')[0]})`);
  }
  await quiet(1500, 20_000);

  return {
    page,
    status,
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
    list.push({ id: list.length, text: text.replace(/\s+/g, ' ').slice(0, 60), tag: await el.evaluate((e) => e.tagName.toLowerCase()), href: await el.getAttribute('href'), element: el });
  }
  return list;
}
