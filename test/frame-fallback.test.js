// A detail request that fails every retry must still deliver its rows: blank detail
// columns, receipts saying why, and the completeness count still whole.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

test('failed detail requests deliver their fallback rows', async () => {
  // Storage of its own, so the test never touches a real run's output.
  process.env.CRAWLEE_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dapi-test-'));
  const { Actor } = await import('apify');
  const { runFrame } = await import('../src/frame/frame.js');

  const server = http
    .createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ items: [{ name: 'Alpha Ltd' }, { name: 'Beta Ltd' }, { name: 'Gamma Ltd' }] }));
    })
    .listen(4999);

  // Detail requests go to a port nothing listens on, so they fail every retry.
  const site = {
    start: [{ url: 'http://127.0.0.1:4999/list', label: 'LIST' }],
    async handle({ request, json, trace, enqueue, expect }) {
      if (request.label !== 'LIST') return;
      expect('companies', json.items.length);
      json.items.forEach((item, i) => {
        const row = { Name: trace(`items.${i}.name`) };
        enqueue({
          url: `http://127.0.0.1:1/profile/${i}`,
          label: 'DETAIL',
          note: `profile of ${item.name}`,
          maxRetries: 0,
          fallback: [{ row, kind: 'companies' }],
        });
      });
    },
  };
  const spec = { title: 'fallback test', columns: [{ name: 'Name' }, { name: 'Website' }], samples: [] };

  await Actor.init();
  const report = await runFrame({ site, spec });
  server.close();
  // Close the SDK without process.exit(), which would end the test runner too.
  await Actor.exit({ exit: false });

  assert.equal(report.rows, 3);
  assert.deepEqual(report.completeness, [{ kind: 'companies', expected: 3, got: 3 }]);
  assert.equal(report.partial.length, 3);
  assert.deepEqual(report.failed.map((f) => f.what).sort(), ['profile of Alpha Ltd', 'profile of Beta Ltd', 'profile of Gamma Ltd']);
  assert.deepEqual(report.columnProblems, []);
});
