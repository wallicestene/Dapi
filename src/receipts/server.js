// Receipt view: the delivered table, where every cell opens its receipt: the exact
// request, the server's response with the value highlighted (or, for HTML, the
// captured page itself with the element outlined), when it was captured, and its
// hash, re-checked in the browser. Reads the frame's output from ./storage.
// Usage: node src/receipts/server.js [port]   then open http://localhost:4173

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { locate, markedPage } from './locate.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const storage = path.join(root, 'storage');
const port = Number(process.argv[2] ?? 4173);

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function loadRows() {
  const dir = path.join(storage, 'datasets/default');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => readJson(path.join(dir, f)));
}

const evidenceCache = new Map();
function loadEvidence(key) {
  if (!/^ev-[0-9a-f]{64}$/.test(key)) throw new Error('bad evidence key');
  if (!evidenceCache.has(key)) evidenceCache.set(key, readJson(path.join(storage, 'key_value_stores/dapi-evidence', `${key}.json`)));
  return evidenceCache.get(key);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const send = (status, type, body) => {
    res.writeHead(status, { 'content-type': type });
    res.end(body);
  };
  const json = (body) => send(200, 'application/json', JSON.stringify(body));
  try {
    if (url.pathname === '/') return send(200, 'text/html; charset=utf-8', fs.readFileSync(path.join(root, 'src/receipts/index.html')));
    if (url.pathname === '/api/table') {
      const report = readJson(path.join(storage, 'key_value_stores/default/REPORT.json'));
      return json({ rows: loadRows(), report });
    }
    if (url.pathname === '/api/evidence') {
      const e = loadEvidence(url.searchParams.get('key'));
      const paths = url.searchParams.getAll('path');
      return json({
        capturedAt: e.capturedAt,
        request: e.request,
        response: e.response,
        bodySha256: e.bodySha256,
        bodyBytes: Buffer.byteLength(e.body),
        located: paths.map((p) => ({ path: p, ...locate(e, p) })),
      });
    }
    if (url.pathname === '/api/evidence/page') {
      const e = loadEvidence(url.searchParams.get('key'));
      return send(200, 'text/html; charset=utf-8', markedPage(e, url.searchParams.get('path')));
    }
    // The raw body, exactly as captured, so the browser can re-hash it.
    if (url.pathname === '/api/evidence/body') {
      const e = loadEvidence(url.searchParams.get('key'));
      return send(200, 'text/plain; charset=utf-8', e.body);
    }
    return send(404, 'text/plain', 'not found');
  } catch (err) {
    return send(500, 'text/plain', err.message);
  }
});

server.listen(port, () => console.log(`receipts: http://localhost:${port}`));
