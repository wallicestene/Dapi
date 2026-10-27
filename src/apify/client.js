// The Apify client for Dapi's own account, used from outside the platform.

import { fileURLToPath } from 'node:url';
import { ApifyClient } from 'apify-client';

// APIFY_TOKEN lives in dapi/.env, which is gitignored. Never hard-code it.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
  // No .env file: use whatever the shell environment has.
}
if (!process.env.APIFY_TOKEN) throw new Error('APIFY_TOKEN is not set: add it to dapi/.env');

export const apify = new ApifyClient({ token: process.env.APIFY_TOKEN });
export const RUNNER = 'dapi-runner';
