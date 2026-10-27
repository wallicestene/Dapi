// Throwaway spike: can SAM 3.1 find the record blocks and the pagination
// control in a page screenshot? Decides open decision 3 in AGENTS.md.
// Usage: node sam-probe.js <url> "<noun phrase>" ["<noun phrase>" ...]
//   e.g. node sam-probe.js https://example.gov/search "search result" "pagination"

const fs = require('node:fs');
const { chromium } = require('playwright');

// MODEL_API_KEY lives in dapi/.env, which is gitignored. Never hard-code it.
try {
  process.loadEnvFile(`${__dirname}/../.env`);
} catch {
  // No .env file: use whatever the shell environment has.
}

const url = process.argv[2];
// SAM wants one short noun phrase per call, naming one kind of thing.
const prompts = process.argv.slice(3);
if (!url || prompts.length === 0) {
  console.error('Usage: node sam-probe.js <url> "<noun phrase>" ["<noun phrase>" ...]');
  process.exit(1);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
  } catch {
    console.log('(page still busy, taking the screenshot anyway)');
  }
  // Up to 3,000 px of the full page, so records and pagination below the fold are in
  // shot. Uncapped, a full-page screenshot can be tens of thousands of pixels tall.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const screenshot = await page.screenshot({
    fullPage: true,
    clip: { x: 0, y: 0, width: 1280, height: Math.min(height, 3000) },
  });
  const outDir = `${__dirname}/results/sam`;
  fs.mkdirSync(outDir, { recursive: true });
  const shotPath = `${outDir}/${new URL(url).hostname}.png`;
  fs.writeFileSync(shotPath, screenshot);
  console.log(`screenshot: ${shotPath}`);

  for (const prompt of prompts) {
    const raw = await segment(screenshot, prompt);
    console.log(`\n=== "${prompt}"`);
    // Mask payloads are long base85 strings; hide them so the boxes are readable.
    console.log(raw.replace(/data=[^|]+/g, 'data=…') || '(no matches)');
  }

  await browser.close();
}

// SAM 3.1 goes through the Responses API: one user message holding the image
// and the noun phrase.
async function segment(png, prompt) {
  const res = await fetch('https://api.meta.ai/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.MODEL_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sam-3.1',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: `data:image/png;base64,${png.toString('base64')}` },
            { type: 'input_text', text: prompt },
          ],
        },
      ],
      metadata: { include_confidence: 'true' },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`SAM returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const body = await res.json();
  // output_text is a convenience field some clients add; the raw response keeps
  // the text inside output[].content[].
  return (
    body.output_text ??
    body.output.flatMap((o) => o.content ?? []).map((c) => c.text ?? '').join('')
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
