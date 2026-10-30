// Receipt view: the delivered table, where every cell opens its receipt: the exact
// request, the server's response with the value highlighted (or, for HTML, the
// captured page itself with the element outlined), when it was captured, and its
// hash, re-checked in the browser. Reads the frame's output from ./storage.
// Usage: node src/receipts/server.js [port]   then open http://localhost:4173

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { extractEmbedded } from '../embedded.js';

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

const dig = (value, p) => (p ? p.split('.') : []).reduce((o, k) => (o == null ? undefined : o[k]), value);

// What to show for one path inside one piece of evidence, already focused on the value.
function locate(evidence, locator) {
  const embedded = locator.match(/^embedded:(s\d+\.\d+)(?:\.(.*))?$/);
  if (embedded) {
    const entry = extractEmbedded(evidence.body).find((e) => e.name === embedded[1]);
    const parts = (embedded[2] ?? '').split('.');
    // Show the whole record the value sits in (its row), with the cell marked.
    const rowPath = parts.slice(0, -1).join('.');
    return {
      kind: 'embedded',
      context: entry?.context ?? '',
      rowPath,
      row: dig(entry?.value, rowPath),
      cell: parts.at(-1),
      value: dig(entry?.value, embedded[2]),
    };
  }
  if (locator.startsWith('css:') || locator.startsWith('css*:')) {
    const all = locator.startsWith('css*:');
    const body = locator.slice(all ? 5 : 4);
    const at = body.lastIndexOf('@');
    const selector = at > 0 && /^[\w-]+$/.test(body.slice(at + 1)) ? body.slice(0, at) : body;
    const $ = cheerio.load(evidence.body);
    const matches = $(selector).length;
    return { kind: 'html', selector, all, matches };
  }
  // JSON: show the whole record the value sits in, with its key marked.
  const parts = locator.split('.');
  const parsed = JSON.parse(evidence.body);
  return { kind: 'json', path: locator, record: dig(parsed, parts.slice(0, -1).join('.')), key: parts.at(-1), value: dig(parsed, locator) };
}

// The captured page as it was, with the elements a selector matched outlined, for
// display only. The raw body stays untouched for the hash check. Scripts are removed
// and a <base> makes the page's own styles load.
function markedPage(evidence, locator) {
  const all = locator.startsWith('css*:');
  const body = locator.slice(all ? 5 : 4);
  const at = body.lastIndexOf('@');
  const selector = at > 0 && /^[\w-]+$/.test(body.slice(at + 1)) ? body.slice(0, at) : body;
  const $ = cheerio.load(evidence.body);
  $('script').remove();
  const hits = $(selector);
  (all ? hits : hits.first()).attr('data-dapi-hit', '');
  $('head').prepend(`<base href="${evidence.request.url}">`);
  $('head').append('<style>[data-dapi-hit]{outline:4px solid #f59e0b!important;outline-offset:4px;background:rgba(245,158,11,.18)!important;border-radius:4px}</style>');
  return $.html();
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
