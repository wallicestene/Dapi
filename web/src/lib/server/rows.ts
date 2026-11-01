// Delivered rows, page by page, each cell with the tick that says how it was checked.
// rows.jsonl grows while the run goes, so the parsed rows are cached by file size.

import fs from "node:fs";
import { jobPath, pipeline, readJson } from "@/lib/server/dapi";
import type { Cell, Row, RowsPage, Tick, Why } from "@/lib/types";

interface Item {
  [column: string]: unknown;
  "#receipt"?: Record<string, { evidence?: string; paths?: string[]; constant?: boolean; unavailable?: string }>;
  "#partial"?: string;
  "#original"?: Record<string, string>;
}

interface Spec {
  columns: { name: string; constant: string | null }[];
  samples: { label: string; values: Record<string, string> }[];
}

interface SampleResult {
  label: string;
  status: string;
  row: number | null;
  checks: { column: string; expected: string; status: "exact" | "warn" | "fail"; why?: Why; belongsTo?: string }[];
}

const cache = new Map<string, { size: number; rows: Row[]; columns: string[]; translated: { from: string; to: string } | null }>();

async function load(id: string) {
  const file = jobPath(id, "rows.jsonl");
  const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
  const hit = cache.get(id);
  if (hit && hit.size === size) return hit;

  const spec = readJson<Spec>(jobPath(id, "spec.json"));
  const columns = spec?.columns.map((c) => c.name) ?? [];
  const constants = new Set(spec?.columns.filter((c) => c.constant !== null).map((c) => c.name));
  const items: Item[] = size
    ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];

  // The tester's own comparison, so the sample ticks match what the run reported.
  const { compareSamples } = await pipeline<{ compareSamples: (rows: unknown[], samples: Spec["samples"]) => SampleResult[] }>("src/compare.js");
  const plain = items.map((it) => Object.fromEntries(columns.map((c) => [c, it[c] ?? ""])));
  const samples = spec?.samples.length ? compareSamples(plain, spec.samples) : [];
  // Values the investigation found the site itself contradicts: delivered as the site
  // has them, shown as a known disagreement rather than a failure.
  const disputes = readJson<{ samples?: { disputes?: { column: string; site: string }[] } }>(jobPath(id, "findings.json"))?.samples?.disputes ?? [];
  const sampleAt = new Map<number, SampleResult>();
  for (const s of samples) {
    for (const c of s.checks) {
      const d = disputes.find((x) => x.column === c.column);
      if (c.status === "fail" && d && s.row !== null && String(plain[s.row]?.[c.column]) === d.site) Object.assign(c, { status: "warn", why: "site" });
    }
    if (s.row !== null) sampleAt.set(s.row, s);
  }

  const rows: Row[] = items.map((item, index) => {
    const cells: Record<string, Cell> = {};
    const sample = sampleAt.get(index);
    for (const column of columns) {
      const value = String(item[column] ?? "");
      const receipt = item["#receipt"]?.[column] ?? {};
      let tick: Tick;
      let reason: string | undefined;
      if (receipt.unavailable) {
        tick = "missing";
        reason = receipt.unavailable;
      } else if (receipt.evidence) {
        tick = "traced";
      } else if (constants.has(column)) {
        tick = "spec";
      } else if (item["#partial"] && value === "") {
        // A fallback row: the detail request failed, so this column never arrived.
        tick = "missing";
        reason = item["#partial"];
      } else {
        tick = "blank";
      }
      const cell: Cell = { value, tick, evidence: receipt.evidence, paths: receipt.paths, reason, original: item["#original"]?.[column] };
      const check = sample?.checks.find((c) => c.column === column);
      if (check) {
        cell.sample = { label: sample!.label, expected: check.expected, why: check.why, belongsTo: check.belongsTo };
        if (tick !== "missing") cell.tick = check.status === "exact" ? "sample" : check.status === "warn" ? "near" : "fail";
      }
      cells[column] = cell;
    }
    return { index, cells };
  });

  const translated = readJson<{ translated?: { from: string; to: string } }>(jobPath(id, "report.json"))?.translated ?? null;
  const entry = { size, rows, columns, translated };
  cache.set(id, entry);
  return entry;
}

const isException = (r: Row) => Object.values(r.cells).some((c) => c.tick === "near" || c.tick === "fail" || c.tick === "missing");
const isMissing = (r: Row) => Object.values(r.cells).some((c) => c.tick === "missing");

export async function rowsPage(
  id: string,
  { offset = 0, limit = 50, scope = "all", q = "" }: { offset?: number; limit?: number; scope?: string; q?: string }
): Promise<RowsPage> {
  const { rows, columns, translated } = await load(id);
  let view = scope === "exceptions" ? rows.filter(isException) : scope === "missing" ? rows.filter(isMissing) : rows;
  const needle = q.trim().toLowerCase();
  if (needle) view = view.filter((r) => Object.values(r.cells).some((c) => c.value.toLowerCase().includes(needle)));
  return {
    columns,
    rows: view.slice(offset, offset + limit),
    total: view.length,
    all: rows.length,
    exceptions: rows.filter(isException).length,
    missing: rows.filter(isMissing).length,
    translated: translated ? { from: translated.from, to: translated.to } : null,
  };
}
