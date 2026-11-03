// The home page's live receipt, built from a finished job: its first rows in a few
// columns and, for each value, the lines of the captured response it was read from, the
// value's line marked. Writes web/src/lib/showcase.json. Use only a job on a source we
// may show (AGENTS.md, Sources we may use), with the credit its licence asks for.
//
// Usage: node src/receipts/showcase.js <job> --title "..." --credit "..." "<column>=<short>" ...

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEvidence } from './evidence.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args.splice(args.indexOf(name), 2)[1] : null);
const title = flag('--title');
const credit = flag('--credit');
const [id, ...picked] = args;
if (!id || !picked.length) throw new Error('usage: showcase.js <job> --title "..." --credit "..." "<column>=<short>" ...');
const columns = picked.map((p) => p.split('='));
const job = JSON.parse(fs.readFileSync(`${root}jobs/${id}/job.json`, 'utf8'));
const items = fs.readFileSync(`${root}jobs/${id}/rows.jsonl`, 'utf8').split('\n').filter(Boolean).slice(0, 4).map((l) => JSON.parse(l));

// Only fields the job delivers are shown beside the value; anything else the site sent
// (notes, internal ids, other people's details) stays out of the page.
const delivered = new Set(items.flatMap((it) => Object.values(it['#receipt'] ?? {}).flatMap((r) => (r.paths ?? []).map((p) => p.split('.').at(-1)))));

// The object holding the value, as the response has it, its keys in order.
function around(body, path) {
  const keys = path.split('.');
  let parent = JSON.parse(body);
  for (const k of keys.slice(0, -1)) parent = parent[k];
  const field = keys.at(-1);
  const entries = Object.entries(parent).filter(([k, v]) => (v === null || typeof v !== 'object') && (k === keys.at(-1) || delivered.has(k)));
  const at = entries.findIndex(([k]) => k === field);
  const shown = entries.slice(Math.max(0, at - 2), Math.max(0, at - 2) + 5);
  return { field, parent: keys.slice(-3, -1).filter((k) => !/^\d+$/.test(k)).join('.'), lines: shown.map(([k, v]) => ({ key: k, value: JSON.stringify(v), hit: k === field })) };
}

const rows = [];
for (const item of items) {
  const row = {};
  for (const [column] of columns) {
    const receipt = item['#receipt']?.[column];
    if (!receipt?.evidence || !receipt.paths?.length) throw new Error(`no receipt for ${column}`);
    // Each value carries its own receipt: the response it came from, when, and its seal.
    const evidence = await loadEvidence(receipt.evidence);
    row[column] = {
      value: String(item[column] ?? ''),
      original: item['#original']?.[column] ?? null,
      path: receipt.paths[0],
      ...around(evidence.body, receipt.paths[0]),
      request: `${evidence.request.method} ${evidence.request.url}`,
      capturedAt: evidence.capturedAt,
      sha256: evidence.bodySha256,
    };
  }
  rows.push(row);
}

const showcase = {
  job: id,
  title: title ?? job.title,
  host: new URL(job.sourceUrl).host,
  columns,
  total: job.expected ?? job.rows,
  rows: job.rows,
  credit,
  rowsShown: rows,
};
fs.writeFileSync(`${root}web/src/lib/showcase.json`, `${JSON.stringify(showcase, null, 1)}\n`);
console.log(`showcase.json: job ${id}, ${rows.length} rows x ${columns.length} columns, ${showcase.rows} of ${showcase.total}`);
