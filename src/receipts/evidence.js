// Evidence records: the hashed copy of a response the frame kept at capture. Read from
// the named key-value store on Apify, or from local storage after a local run.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = new Map();
let store = null;

// Found by name, never created here: the runner Actor (limited permissions) can only use
// a store it created itself, so one made from this side would lock every run out (it
// did, Nov 3).
async function evidenceStore(fresh = false) {
  if (!store || fresh) {
    const { apify } = await import('../apify/client.js');
    const { items } = await apify.keyValueStores().list({ limit: 1000 });
    const found = items.find((s) => s.name === 'dapi-evidence');
    if (!found) throw new Error('no evidence store yet: the first run creates it');
    store = apify.keyValueStore(found.id);
  }
  return store;
}

export async function loadEvidence(key) {
  if (!/^ev-[0-9a-f]{64}$/.test(key)) throw new Error('bad evidence key');
  if (cache.has(key)) return cache.get(key);
  const local = path.join(root, 'storage/key_value_stores/dapi-evidence', `${key}.json`);
  let evidence;
  if (fs.existsSync(local)) {
    evidence = JSON.parse(fs.readFileSync(local, 'utf8'));
  } else {
    evidence = (await (await evidenceStore()).getRecord(key).catch(() => null))?.value;
    // The store may have been rebuilt under the same name since it was looked up: look
    // it up again before saying the evidence is gone.
    if (!evidence) evidence = (await (await evidenceStore(true)).getRecord(key))?.value;
    if (!evidence) throw new Error(`no evidence ${key}`);
  }
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  cache.set(key, evidence);
  return evidence;
}
