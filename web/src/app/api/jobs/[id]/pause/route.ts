// Pause a run on Apify: it stops gracefully and keeps its dataset, queue and saved
// state; Resume (resurrect) carries on where it stopped. The marker tells the runner the
// stop was the client's, so it reports a pause rather than a stopped run.

import fs from "node:fs";
import { READ_ONLY, getJob, jobPath, pipeline, validId } from "@/lib/server/dapi";
import { jobFor } from "@/lib/server/access";

export async function POST(_request: Request, ctx: RouteContext<"/api/jobs/[id]/pause">) {
  const { id } = await ctx.params;
  // On the public demo: a job someone may not see doesn't exist for them; only its owner acts on it.
  const access = await jobFor(id, "act");
  if (access instanceof Response) return access;
  const job = validId(id) ? getJob(id) : null;
  if (READ_ONLY) return Response.json({ error: "Read-only copy." }, { status: 403 });
  if (!job?.runId || job.status !== "running" || job.step !== "run") return Response.json({ error: "Only a run in progress can be paused." }, { status: 409 });
  fs.writeFileSync(jobPath(id, "pause.json"), JSON.stringify({ at: new Date().toISOString() }));
  const { apify } = await pipeline<{ apify: { run: (id: string) => { abort: (o: { gracefully: boolean }) => Promise<{ status: string }> } } }>("src/apify/client.js");
  const run = await apify.run(job.runId).abort({ gracefully: true });
  return Response.json({ status: run.status });
}
