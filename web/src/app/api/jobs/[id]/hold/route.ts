// Pause after this step: while the spec or the site step runs, the client asks the job
// to stop at the next step boundary. The step itself finishes; the runner holds before
// the next one. Asked again with { on: false }, the request is withdrawn.

import fs from "node:fs";
import { READ_ONLY, getJob, jobPath, pipeline, validId } from "@/lib/server/dapi";

export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/hold">) {
  const { id } = await ctx.params;
  const job = validId(id) ? getJob(id) : null;
  if (READ_ONLY) return Response.json({ error: "Read-only copy." }, { status: 403 });
  if (!job || job.status !== "running" || !["spec", "site"].includes(job.step)) return Response.json({ error: "A job can pause after reading the spec or investigating the site." }, { status: 409 });
  const { on = true } = await request.json().catch(() => ({}));
  if (on) fs.writeFileSync(jobPath(id, "hold.json"), JSON.stringify({ at: new Date().toISOString() }));
  else fs.rmSync(jobPath(id, "hold.json"), { force: true });
  const { updateJob } = await pipeline<{ updateJob: (dir: string, changes: object) => void }>("src/jobs/store.js");
  updateJob(jobPath(id), { holdRequested: Boolean(on) });
  return Response.json({ holdRequested: Boolean(on) });
}
