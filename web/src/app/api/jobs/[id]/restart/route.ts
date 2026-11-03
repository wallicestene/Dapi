// "Start again" for a job whose runner was lost (a deploy or restart stopped it): it
// picks up at the step it was on, from what that step saved.

import { READ_ONLY, jobPath, pipeline } from "@/lib/server/dapi";
import { runnerAlive, startRunner } from "@/lib/server/runner";
import { jobFor } from "@/lib/server/access";

export async function POST(_request: Request, ctx: RouteContext<"/api/jobs/[id]/restart">) {
  const { id } = await ctx.params;
  const access = await jobFor(id, "act");
  if (access instanceof Response) return access;
  const { job } = access;
  if (READ_ONLY) return Response.json({ error: "Read-only copy." }, { status: 403 });
  if (runnerAlive(job.runnerPid)) return Response.json({ error: "This job is already running." }, { status: 409 });
  const { LOST, resumeArgs } = await pipeline<{ LOST: string; resumeArgs: (dir: string, job: object) => string[] }>("src/jobs/resume.js");
  if (!(job.status === "failed" && job.failed === LOST)) return Response.json({ error: "Only a job whose runner was lost starts again here." }, { status: 409 });
  startRunner(id, resumeArgs(jobPath(id), job), { status: "running", autoResumes: 0 });
  return Response.json({ ok: true });
}
