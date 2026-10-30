// Runs a site part on Apify through the dapi-runner Actor. The run's links are shown
// the moment it starts, so the user can open their Apify account and watch rows
// arrive in the dataset; progress is shown until it ends, then the frame's report.
// Usage:
//   node src/apify/run-on-apify.js <site-part.js> <spec.json> [concurrency]
//   node src/apify/run-on-apify.js --resurrect <runId>   continue a stopped run
//   node src/apify/run-on-apify.js --abort <runId>       stop a run gracefully

import fs from 'node:fs';
import { apify, RUNNER } from './client.js';

const args = process.argv.slice(2);
const { username } = await apify.user('me').get();

let run;
if (args[0] === '--abort') {
  // Graceful: the Actor gets the "aborting" event and pushes what it has.
  run = await apify.run(args[1]).abort({ gracefully: true });
  console.log(`run ${run.id}: abort requested (${run.status})`);
  process.exit(0);
} else if (args[0] === '--resurrect') {
  run = await apify.run(args[1]).resurrect();
  console.log(`run ${run.id} resurrected: it keeps its dataset, state and request queue and carries on`);
} else {
  const [sitePath, specPath, concurrency] = args;
  if (!sitePath || !specPath) {
    console.error('Usage: node src/apify/run-on-apify.js <site-part.js> <spec.json> [concurrency]');
    process.exit(1);
  }
  const input = {
    siteCode: fs.readFileSync(sitePath, 'utf8'),
    spec: JSON.parse(fs.readFileSync(specPath, 'utf8')),
    // Left out unless given: then the site part's own config decides. (The input
    // schema rejects null for an integer field.)
    ...(concurrency && { maxConcurrency: Number(concurrency) }),
  };
  run = await apify.actor(`${username}/${RUNNER}`).start(input, { memory: 2048, timeout: 3600 });
}

// The alert: where to watch it, right now.
console.log(`\nYour run is live on Apify:`);
console.log(`  run:     https://console.apify.com/actors/runs/${run.id}`);
console.log(`  dataset: https://console.apify.com/storage/datasets/${run.defaultDatasetId}  (rows appear as they're found)\n`);

const started = Date.now();
let current = run;
while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(current.status)) {
  await new Promise((r) => setTimeout(r, 15_000));
  current = await apify.run(run.id).get();
  const { total } = await apify.dataset(run.defaultDatasetId).listItems({ limit: 1 });
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`  ${String(seconds).padStart(5)} s  ${current.status.padEnd(9)} ${total} rows so far  ${current.statusMessage ?? ''}`);
}
console.log(`\nrun ${current.id} ${current.status}: ${current.statusMessage ?? ''}`);
if (current.status !== 'SUCCEEDED') process.exit(1);

// The frame prints its summary to the run log; show that part.
const log = (await apify.run(run.id).log().get()) ?? '';
console.log(`\n${log.slice(log.lastIndexOf('===')).trim()}`);

// Dataset counts lag after a run (itemCount read 0 for 427 items; listItems().total
// read 3,174 of 5,157 after a big run), so wait until the total matches the report.
const report = await apify.keyValueStore(run.defaultKeyValueStoreId).getRecord('REPORT');
let total = 0;
for (let i = 0; i < 30; i++) {
  ({ total } = await apify.dataset(run.defaultDatasetId).listItems({ limit: 1 }));
  if (total >= (report?.value?.rows ?? 0)) break;
  await new Promise((r) => setTimeout(r, 2000));
}
console.log(`\ndataset ${run.defaultDatasetId}: ${total} items; report rows ${report?.value?.rows}, evidence kept ${report?.value?.captures}, resumed ${report?.value?.resumed ?? 0}x`);
