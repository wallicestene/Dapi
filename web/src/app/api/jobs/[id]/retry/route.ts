// Try the extraction again: for a job whose extraction failed its checks, Muse Spark
// writes it afresh from the saved spec, findings and strategy; nothing before is redone.

import fs from "node:fs";
import { READ_ONLY, getJob, jobPath, validId } from "@/lib/server/dapi";
import { runnerAlive, startRunner } from "@/lib/server/runner";

export async function POST(_request: Request, ctx: RouteContext<"/api/jobs/[id]/retry">) {
  const { id } = await ctx.params;
  const job = validId(id) ? getJob(id) : null;
  if (READ_ONLY) return Response.json({ error: "Read-only copy." }, { status: 403 });
  if (!job || job.status !== "failed" || job.step !== "code") return Response.json({ error: "Only a job whose extraction failed can start again from it." }, { status: 409 });
  if (!fs.existsSync(jobPath(id, "findings.json"))) return Response.json({ error: "This job has no saved investigation to start from." }, { status: 409 });
  if (runnerAlive(job.runnerPid)) return Response.json({ error: "This job is already running." }, { status: 409 });
  fs.rmSync(jobPath(id, "hold.json"), { force: true });
  startRunner(id, ["--from-code"], { status: "running", step: "code" });
  return Response.json({ ok: true });
}
