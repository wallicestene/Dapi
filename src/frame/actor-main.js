// Entry point of the dapi-runner Actor on Apify. It takes a site part's code and a
// spec as input, so a new site part can be test-run without building a new Actor.
// Only the account owner can start it, so running the input code is running our own.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Actor } from 'apify';
import { runFrame } from './frame.js';

await Actor.init();

const { siteCode, spec } = (await Actor.getInput()) ?? {};
if (!siteCode || !spec) throw new Error('Input needs siteCode (the site part) and spec (from read-spec)');

const file = path.join(os.tmpdir(), `site-${Date.now()}.mjs`);
fs.writeFileSync(file, siteCode);
const site = await import(pathToFileURL(file).href);

await runFrame({ site, spec });
await Actor.exit();
