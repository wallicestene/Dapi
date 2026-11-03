import fs from "node:fs";
import { jobPath, validId } from "@/lib/server/dapi";

// The field names a job delivers, read from its rows' receipts ("Data.4.Name" -> Name).
// A receipt shows these and the value's own field; anything else the site sent (notes,
// internal flags, other people's details) is counted, never shown.
const cache = new Map<string, { size: number; keys: Set<string> }>();

export function deliveredKeys(id: string | null): Set<string> {
  if (!id || !validId(id)) return new Set();
  const file = jobPath(id, "rows.jsonl");
  const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
  const hit = cache.get(id);
  if (hit && hit.size === size) return hit.keys;
  const keys = new Set<string>();
  for (const line of size ? fs.readFileSync(file, "utf8").split("\n") : []) {
    if (!line) continue;
    try {
      for (const r of Object.values(JSON.parse(line)["#receipt"] ?? {}) as { paths?: string[] }[])
        for (const p of r.paths ?? []) keys.add(p.split(".").at(-1)!);
    } catch {
      // a line still being written
    }
  }
  cache.set(id, { size, keys });
  return keys;
}

// A record cut down to what may be shown: the delivered fields and the marked one.
export function onlyDelivered(record: unknown, keep: Set<string>, marked?: string): { shown: unknown; hidden: number } {
  if (!record || typeof record !== "object" || Array.isArray(record)) return { shown: record, hidden: 0 };
  const entries = Object.entries(record as Record<string, unknown>);
  const shown = entries.filter(([k]) => k === marked || keep.has(k));
  return { shown: Object.fromEntries(shown), hidden: entries.length - shown.length };
}
