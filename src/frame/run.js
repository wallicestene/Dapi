// Runs a site part locally through the frame, into ./storage.
// Usage: node src/frame/run.js <site-part.js> <spec.json>

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Actor } from 'apify';
import { runFrame } from './frame.js';

const [sitePath, specPath] = process.argv.slice(2);
if (!sitePath || !specPath) {
  console.error('Usage: node src/frame/run.js <site-part.js> <spec.json>');
  process.exit(1);
}

const site = await import(pathToFileURL(path.resolve(sitePath)).href);
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

await Actor.init();
await runFrame({ site, spec });
await Actor.exit();
