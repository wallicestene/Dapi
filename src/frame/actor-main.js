// Entry point of the dapi-runner Actor on Apify. It takes a site part's code and a
// spec as input, so a new site part can be test-run without building a new Actor.
// Only the account owner can start it, so running the input code is running our own.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Actor } from 'apify';
import { runFrame } from './frame.js';
import { probe } from './probe.js';

await Actor.init();

const input = (await Actor.getInput()) ?? {};

// Probe mode: check how the site answers Apify's servers, then stop.
if (input.mode === 'probe') {
  await Actor.setValue('REACH', await probe(input.requests ?? [], { countryCode: input.countryCode, pace: input.pace ?? [] }));
  await Actor.exit();
}

const { siteCode, spec, testLimit = null, maxConcurrency = null, robotsOverride = false } = input;
if (!siteCode || !spec) throw new Error('Input needs siteCode (the site part) and spec (from read-spec)');

const file = path.join(os.tmpdir(), `site-${Date.now()}.mjs`);
fs.writeFileSync(file, siteCode);
const site = await import(pathToFileURL(file).href);

await runFrame({ site, spec, testLimit, maxConcurrency, robotsOverride });
await Actor.exit();
