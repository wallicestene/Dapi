// Evidence records: the hashed copy of a response the frame kept at capture. Read from
// the named key-value store on Apify, or from local storage after a local run.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = new Map();
let store = null;

export async function loadEvidence(key) {
  if (!/^ev-[0-9a-f]{64}$/.test(key)) throw new Error('bad evidence key');
  if (cache.has(key)) return cache.get(key);
  const local = path.join(root, 'storage/key_value_stores/dapi-evidence', `${key}.json`);
  let evidence;
  if (fs.existsSync(local)) {
    evidence = JSON.parse(fs.readFileSync(local, 'utf8'));
  } else {
    if (!store) {
      const { apify } = await import('../apify/client.js');
      const { id } = await apify.keyValueStores().getOrCreate('dapi-evidence');
      store = apify.keyValueStore(id);
    }
    evidence = (await store.getRecord(key))?.value;
    if (!evidence) throw new Error(`no evidence ${key}`);
  }
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  cache.set(key, evidence);
  return evidence;
}
