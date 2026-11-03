// Back to the plan: a job paused at the plan ("Not now") gets its plan again, worked out
// fresh from the extraction that passed its test; nothing before it is redone.

import fs from "node:fs";
import { READ_ONLY, getJob, jobPath, validId } from "@/lib/server/dapi";
import { runnerAlive, startRunner } from "@/lib/server/runner";

export async function POST(_request: Request, ctx: RouteContext<"/api/jobs/[id]/reopen">) {
  const { id } = await ctx.params;
  const job = validId(id) ? getJob(id) : null;
  if (READ_ONLY) return Response.json({ error: "Read-only copy." }, { status: 403 });
  if (!job || job.status !== "cancelled" || !fs.existsSync(jobPath(id, "site.js"))) return Response.json({ error: "Only a job paused at its plan can go back to it." }, { status: 409 });
  if (runnerAlive(job.runnerPid)) return Response.json({ error: "This job is already running." }, { status: 409 });
  // The earlier "Not now" would answer the plan at once: it goes.
  fs.rmSync(jobPath(id, "approve.json"), { force: true });
  startRunner(id, ["--from", "plan"], { status: "running", step: "plan" });
  return Response.json({ ok: true });
}
