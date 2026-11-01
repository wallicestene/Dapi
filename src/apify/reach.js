// Runs the reachability probe on Apify (dapi-runner in probe mode) and returns how
// the site answered Apify's servers: directly, via datacenter proxy, or residential.

import { apify, RUNNER } from './client.js';

export async function checkReach(requests, { countryCode, pace = [] } = {}) {
  const { username } = await apify.user('me').get();
  const run = await apify
    .actor(`${username}/${RUNNER}`)
    .call({ mode: 'probe', requests, countryCode, pace }, { memory: 1024, timeout: 900 });
  const record = await apify.keyValueStore(run.defaultKeyValueStoreId).getRecord('REACH');
  return { runId: run.id, ...(record?.value ?? { recommendation: null, results: [], error: `probe run ${run.status}` }) };
}
