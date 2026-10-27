// Runs a site part on Apify through the dapi-runner Actor and prints its report.
// Usage: node src/apify/run-on-apify.js <site-part.js> <spec.json>

import fs from 'node:fs';
import { apify, RUNNER } from './client.js';

const [sitePath, specPath] = process.argv.slice(2);
if (!sitePath || !specPath) {
  console.error('Usage: node src/apify/run-on-apify.js <site-part.js> <spec.json>');
  process.exit(1);
}

const input = {
  siteCode: fs.readFileSync(sitePath, 'utf8'),
  spec: JSON.parse(fs.readFileSync(specPath, 'utf8')),
};

const { username } = await apify.user('me').get();
const started = Date.now();
const run = await apify.actor(`${username}/${RUNNER}`).call(input, { memory: 1024, timeout: 900 });
console.log(`run ${run.id} ${run.status} in ${Math.round((Date.now() - started) / 1000)} s`);
console.log(`console: https://console.apify.com/actors/runs/${run.id}`);

// The frame prints its summary to the run log; show that part.
const log = (await apify.run(run.id).log().get()) ?? '';
const summary = log.slice(log.indexOf('==='));
console.log(`\n${summary.trim()}`);

// dataset.get().itemCount lags for a few seconds after a run and can read 0;
// listItems().total is right immediately.
const { total } = await apify.dataset(run.defaultDatasetId).listItems({ limit: 1 });
const report = await apify.keyValueStore(run.defaultKeyValueStoreId).getRecord('REPORT');
console.log(`\ndataset ${run.defaultDatasetId}: ${total} items`);
console.log(`report rows: ${report?.value?.rows}, evidence kept: ${report?.value?.captures}`);
