// Throwaway spike: can Muse Spark look at a page screenshot and find the records
// and the next-page control? SAM couldn't (see SKILL.md). If Spark can, vision
// has a real job: telling the investigation agent where the data is and what to click.
// Usage: node vision-probe.js <screenshot.png> "<what the page lists>"
//   e.g. node vision-probe.js results/sam/projects.worldbank.org.png "World Bank projects"

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

try {
  process.loadEnvFile(`${__dirname}/../.env`);
} catch {
  // No .env file: use whatever the shell environment has.
}

const shotPath = process.argv[2];
const listing = process.argv[3];
if (!shotPath || !listing) {
  console.error('Usage: node vision-probe.js <screenshot.png> "<what the page lists>"');
  process.exit(1);
}

const MODEL = 'muse-spark-1.3';

// Muse Spark gives positions on a 0–1000 grid, (0,0) top-left, whatever the image size.
const BOX = {
  type: 'object',
  properties: {
    x_min: { type: 'integer' },
    y_min: { type: 'integer' },
    x_max: { type: 'integer' },
    y_max: { type: 'integer' },
  },
  required: ['x_min', 'y_min', 'x_max', 'y_max'],
  additionalProperties: false,
};

const SCHEMA = {
  type: 'object',
  properties: {
    records: {
      type: 'array',
      items: {
        type: 'object',
        properties: { box: BOX, firstText: { type: 'string' } },
        required: ['box', 'firstText'],
        additionalProperties: false,
      },
    },
    // An object with a found flag instead of null, to keep the schema simple.
    nextPage: {
      type: 'object',
      properties: { found: { type: 'boolean' }, box: BOX, text: { type: 'string' } },
      required: ['found', 'box', 'text'],
      additionalProperties: false,
    },
    notes: { type: 'string' },
  },
  required: ['records', 'nextPage', 'notes'],
  additionalProperties: false,
};

async function main() {
  const png = fs.readFileSync(shotPath);
  // A PNG stores its width and height at bytes 16 and 20.
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);

  const prompt = `This is a screenshot of a web page, ${width}x${height} pixels. The page lists ${listing}.
Find every record of that list visible in the screenshot: one box per record, covering the whole record with all its fields. Ignore navigation, filters, headers and footers.
Also find the control that goes to the next page of results, if there is one.
Give coordinates on the 0-1000 grid, (0,0) top-left, (1000,1000) bottom-right.
For each record, give the first line of text you can read in it.`;

  const started = Date.now();
  const res = await fetch('https://api.meta.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.MODEL_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } },
            { type: 'text', text: prompt },
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'page_records', schema: SCHEMA, strict: true },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const body = await res.json();
  const answer = JSON.parse(body.choices[0].message.content);
  const { prompt_tokens: tokensIn, completion_tokens: tokensOut } = body.usage ?? {};
  console.log(`${MODEL}: ${tokensIn} tokens in, ${tokensOut} out, ${Date.now() - started} ms`);

  // Back to pixels, clamped: the model can say 1001.
  const toPixels = (b) => ({
    x1: Math.round((Math.min(Math.max(b.x_min, 0), 1000) * width) / 1000),
    y1: Math.round((Math.min(Math.max(b.y_min, 0), 1000) * height) / 1000),
    x2: Math.round((Math.min(Math.max(b.x_max, 0), 1000) * width) / 1000),
    y2: Math.round((Math.min(Math.max(b.y_max, 0), 1000) * height) / 1000),
  });

  console.log(`\nRecords: ${answer.records.length}`);
  const boxes = [];
  for (const r of answer.records) {
    const p = toPixels(r.box);
    boxes.push({ ...p, color: 'lime' });
    console.log(`  [${p.x1},${p.y1} → ${p.x2},${p.y2}]  ${r.firstText.slice(0, 70)}`);
  }

  if (answer.nextPage.found) {
    const p = toPixels(answer.nextPage.box);
    boxes.push({ ...p, color: 'red' });
    console.log(`Next page: [${p.x1},${p.y1} → ${p.x2},${p.y2}]  "${answer.nextPage.text}"`);
  } else {
    console.log('Next page: not found');
  }
  console.log(`Notes: ${answer.notes}`);

  const outPath = await drawOverlay(png, width, height, boxes);
  console.log(`\noverlay: ${outPath}`);
}

// Draws the boxes over the screenshot with Playwright, so checking them is a
// matter of looking, with no image library needed.
async function drawOverlay(png, width, height, boxes) {
  const divs = boxes
    .map(
      (b) =>
        `<div style="position:absolute;left:${b.x1}px;top:${b.y1}px;` +
        `width:${b.x2 - b.x1}px;height:${b.y2 - b.y1}px;border:3px solid ${b.color}"></div>`
    )
    .join('');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(
    `<body style="margin:0;position:relative"><img src="data:image/png;base64,${png.toString('base64')}">${divs}</body>`
  );
  const outDir = `${__dirname}/results/vision`;
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}/${path.basename(shotPath, '.png')}-overlay.png`;
  await page.screenshot({ path: outPath, fullPage: true });
  await browser.close();
  return outPath;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
