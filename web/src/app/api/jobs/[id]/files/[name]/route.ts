// Files from a job's folder the screen shows: the pictures the agent looked at, the
// spec as given, and the extraction code (for anyone who wants to read it).

import fs from "node:fs";
import { jobPath, validId } from "@/lib/server/dapi";

const TYPES: [RegExp, string][] = [
  [/^img-\d+\.png$/, "image/png"],
  [/^input\.pdf$/, "application/pdf"],
  [/^input\.(md|txt)$/, "text/plain; charset=utf-8"],
  [/^site\.js$/, "text/plain; charset=utf-8"],
  [/^report\.json$/, "application/json"],
];

export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]/files/[name]">) {
  const { id, name } = await ctx.params;
  const type = TYPES.find(([re]) => re.test(name))?.[1];
  const file = validId(id) && type ? jobPath(id, name) : null;
  if (!file || !fs.existsSync(file)) return new Response("not found", { status: 404 });
  return new Response(fs.readFileSync(file), { headers: { "content-type": type!, "cache-control": "private, max-age=3600" } });
}
