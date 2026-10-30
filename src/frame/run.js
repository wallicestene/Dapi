// Runs a site part locally through the frame, into ./storage.
// Usage: node src/frame/run.js <site-part.js> <spec.json> [--test <n>]
//   --test <n>: run the samples' requests plus n other follow-ups (see runFrame).

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Actor } from 'apify';
import { runFrame } from './frame.js';

const [sitePath, specPath, flag, limit] = process.argv.slice(2);
if (!sitePath || !specPath) {
  console.error('Usage: node src/frame/run.js <site-part.js> <spec.json> [--test <n>]');
  process.exit(1);
}

const site = await import(pathToFileURL(path.resolve(sitePath)).href);
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const testLimit = flag === '--test' ? Number(limit ?? 10) : null;

await Actor.init();
await runFrame({ site, spec, testLimit });
await Actor.exit();
