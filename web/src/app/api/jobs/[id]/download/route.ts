// The delivered rows as a file, in the spec's columns: translated where the job
// translated them. (The Apify dataset holds the site's own words.) ?format= picks CSV
// (the default), xlsx, json, xml or html; while a job runs, it's the rows so far.

import fs from "node:fs";
import { getJob, jobPath, readJson, validId } from "@/lib/server/dapi";
import { FORMATS, type Format } from "@/lib/server/export";

export async function GET(request: Request, ctx: RouteContext<"/api/jobs/[id]/download">) {
  const { id } = await ctx.params;
  const job = validId(id) ? getJob(id) : null;
  const file = job ? jobPath(id, "rows.jsonl") : null;
  if (!job || !file || !fs.existsSync(file)) return new Response("no rows", { status: 404 });
  const asked = new URL(request.url).searchParams.get("format") ?? "csv";
  if (!(asked in FORMATS)) return new Response(`unknown format: ${asked}`, { status: 400 });
  const format = FORMATS[asked as Format];
  const columns = readJson<{ columns: { name: string }[] }>(jobPath(id, "spec.json"))?.columns.map((c) => c.name) ?? [];
  const rows = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .map((r) => Object.fromEntries(columns.map((c) => [c, String(r[c] ?? "")])));
  const title = job.title ?? `Dapi job ${id}`;
  const body = format.build({ title, source: job.sourceUrl ? new URL(job.sourceUrl).host : null, columns, rows });
  const name = title.replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return new Response(body as BodyInit, {
    headers: { "content-type": format.type, "content-disposition": `attachment; filename="${name}.${format.ext}"` },
  });
}
