// Resurrect a stopped run on Apify: it keeps its dataset, saved state and queue and
// carries on where it stopped; a runner follows it to the end.

import { READ_ONLY, getJob, jobPath, pipeline, validId } from "@/lib/server/dapi";
import { runnerAlive, startRunner } from "@/lib/server/runner";

export async function POST(_request: Request, ctx: RouteContext<"/api/jobs/[id]/resurrect">) {
  const { id } = await ctx.params;
  const job = validId(id) ? getJob(id) : null;
  if (!job?.runId) return Response.json({ error: "This job has no run to resurrect." }, { status: 404 });
  if (READ_ONLY) return Response.json({ error: "Read-only copy." }, { status: 403 });
  if (runnerAlive(job.runnerPid)) return Response.json({ error: "The run is already being followed." }, { status: 409 });
  const { apify } = await pipeline<{ apify: { run: (id: string) => { resurrect: () => Promise<{ status: string }> } } }>("src/apify/client.js");
  const run = await apify.run(job.runId).resurrect();
  const { updateJob } = await pipeline<{ updateJob: (dir: string, changes: object) => void }>("src/jobs/store.js");
  updateJob(jobPath(id), { status: "running", step: "run", runStatus: run.status });
  startRunner(id, ["--follow"]);
  return Response.json({ status: run.status });
}
