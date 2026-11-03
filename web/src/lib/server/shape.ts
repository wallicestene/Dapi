import fs from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { jobPath, readJson } from "@/lib/server/dapi";
import type { DataShape } from "@/lib/types";

// A job's data at a glance, for its card art. Only the head of rows.jsonl is read, so a
// 43,037-row job costs the same as a 40-row one.
const ROWS = 30;
const COLUMNS = 12;

export function dataShape(id: string): DataShape | null {
  const columns = readJson<{ columns: { name: string }[] }>(jobPath(id, "spec.json"))?.columns.slice(0, COLUMNS).map((c) => c.name);
  if (!columns?.length) return null;
  const rows: number[][] = [];
  for (const line of headLines(jobPath(id, "rows.jsonl"), ROWS)) {
    try {
      const row = JSON.parse(line);
      rows.push(columns.map((c) => String(row[c] ?? "").length));
    } catch {
      // a line still being written
    }
  }
  return { columns: columns.length, rows };
}

function headLines(file: string, n: number): string[] {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return [];
  }
  const chunk = Buffer.alloc(64 * 1024);
  const decoder = new StringDecoder("utf8");
  let text = "";
  try {
    for (let at = 0, read = 1; read > 0 && text.split("\n").length <= n; at += read) {
      read = fs.readSync(fd, chunk, 0, chunk.length, at);
      text += decoder.write(chunk.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return text.split("\n").slice(0, n).filter(Boolean);
}
