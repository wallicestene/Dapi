// Creates or updates the dapi-runner Actor from this repo's files and builds it.
// The runner is built once; site parts are passed to it as input, so the
// write-test-fix loop never waits on a build.
// Usage: node src/apify/deploy-runner.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apify, RUNNER } from './client.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

// Actor path -> repo path. The frame keeps its repo layout so its imports still work.
const FILES = {
  'package.json': 'runner/package.json',
  Dockerfile: 'runner/Dockerfile',
  '.actor/actor.json': 'runner/.actor/actor.json',
  '.actor/input_schema.json': 'runner/.actor/input_schema.json',
  'src/frame/actor-main.js': 'src/frame/actor-main.js',
  'src/frame/frame.js': 'src/frame/frame.js',
  'src/compare.js': 'src/compare.js',
};

const sourceFiles = Object.entries(FILES).map(([name, from]) => ({
  name,
  format: 'TEXT',
  content: fs.readFileSync(path.join(root, from), 'utf8'),
}));
const version = { versionNumber: '0.1', sourceType: 'SOURCE_FILES', buildTag: 'latest', sourceFiles };

const { items } = await apify.actors().list({ my: true, limit: 1000 });
let actor = items.find((a) => a.name === RUNNER);
if (actor) {
  await apify.actor(actor.id).version('0.1').update(version);
  console.log(`updated ${RUNNER} (${actor.id})`);
} else {
  actor = await apify.actors().create({ name: RUNNER, title: 'Dapi runner', isPublic: false, versions: [version] });
  console.log(`created ${RUNNER} (${actor.id})`);
}

const started = Date.now();
const build = await apify.actor(actor.id).build('0.1');
console.log(`build ${build.id} started`);
const finished = await apify.build(build.id).waitForFinish();
const seconds = Math.round((Date.now() - started) / 1000);
console.log(`build ${finished.status} in ${seconds} s`);
if (finished.status !== 'SUCCEEDED') {
  console.log((await apify.build(build.id).log().get())?.slice(-2000));
  process.exit(1);
}
