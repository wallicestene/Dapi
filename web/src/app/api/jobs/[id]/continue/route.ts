// Resume a job paused between steps: a runner starts the next step from what the job
// folder saved (the spec; the investigation and its strategy).

import fs from "node:fs";
import { READ_ONLY, getJob, jobPath, pipeline, validId } from "@/lib/server/dapi";
import { startRunner } from "@/lib/server/runner";

export async function POST(_request: Request, ctx: RouteContext<"/api/jobs/[id]/continue">) {
  const { id } = await ctx.params;
  const job = validId(id) ? getJob(id) : null;
  if (READ_ONLY) return Response.json({ error: "Read-only copy." }, { status: 403 });
  if (!job || job.status !== "held" || !job.heldBefore) return Response.json({ error: "This job isn't paused between steps." }, { status: 409 });
  fs.rmSync(jobPath(id, "hold.json"), { force: true });
  startRunner(id, ["--from", job.heldBefore]);
  const { updateJob } = await pipeline<{ updateJob: (dir: string, changes: object) => void }>("src/jobs/store.js");
  updateJob(jobPath(id), { status: "running", step: job.heldBefore });
  return Response.json({ ok: true });
}
