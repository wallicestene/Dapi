// Renders an HTML spec to PDF, so Dapi is tested on the same kind of document
// clients actually send.
// Usage: node scripts/spec-to-pdf.js specs/<name>.html  ->  specs/<name>.pdf

import { chromium } from 'playwright';
import path from 'node:path';

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/spec-to-pdf.js <spec.html>');
  process.exit(1);
}

const output = input.replace(/\.html?$/, '.pdf');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`file://${path.resolve(input)}`);
await page.pdf({ path: output, format: 'A4', margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' } });
await browser.close();
console.log(`wrote ${output}`);
