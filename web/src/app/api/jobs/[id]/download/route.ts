// The delivered rows as a file, in the spec's columns: translated where the job
// translated them. (The Apify dataset holds the site's own words.)

import fs from "node:fs";
import { getJob, jobPath, readJson, validId } from "@/lib/server/dapi";

export async function GET(request: Request, ctx: RouteContext<"/api/jobs/[id]/download">) {
  const { id } = await ctx.params;
  const job = validId(id) ? getJob(id) : null;
  const file = job ? jobPath(id, "rows.jsonl") : null;
  if (!job || !file || !fs.existsSync(file)) return new Response("no rows", { status: 404 });
  const columns = readJson<{ columns: { name: string }[] }>(jobPath(id, "spec.json"))?.columns.map((c) => c.name) ?? [];
  const rows = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? ""])));
  const name = (job.title ?? `dapi-job-${id}`).replace(/[^\w-]+/g, "-").toLowerCase();
  if (new URL(request.url).searchParams.get("format") === "json") {
    return new Response(JSON.stringify(rows, null, 2), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${name}.json"` },
    });
  }
  const cell = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [columns.map(cell).join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n");
  // A BOM so Excel reads non-English text (ø, å) right.
  return new Response(`﻿${csv}\r\n`, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"` },
  });
}
