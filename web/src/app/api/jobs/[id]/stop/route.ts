// Stop a job now, at any step. Pause waits for the step to finish, and a step that keeps
// starting over (a server cut every few minutes mid-investigation) never does. The runner
// ends with the browser it drives, a run on Apify is aborted (its rows so far stay), and
// the job is marked stopped by its owner, so nothing picks it up again.

import { READ_ONLY, jobPath, pipeline } from "@/lib/server/dapi";
import { runnerAlive } from "@/lib/server/runner";
import { jobFor } from "@/lib/server/access";

const FINAL = ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"];

export async function POST(_request: Request, ctx: RouteContext<"/api/jobs/[id]/stop">) {
  const { id } = await ctx.params;
  const access = await jobFor(id, "act");
  if (access instanceof Response) return access;
  const { job } = access;
  if (READ_ONLY) return Response.json({ error: "Read-only copy." }, { status: 403 });
  const { LOST, STOPPED } = await pipeline<{ LOST: string; STOPPED: string }>("src/jobs/resume.js");
  const underWay = ["running", "waiting", "held"].includes(job.status) || (job.status === "failed" && job.failed === LOST);
  if (!underWay) return Response.json({ error: "This job isn't running." }, { status: 409 });

  // The runner was started detached, so it leads its own process group: ending the group
  // ends the browser it drives too.
  const pid = job.runnerPid;
  if (pid && runnerAlive(pid)) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      process.kill(pid, "SIGTERM");
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (job.runId && !FINAL.includes(job.runStatus ?? "")) {
    const { apify } = await pipeline<{ apify: { run: (id: string) => { abort: (o: { gracefully: boolean }) => Promise<unknown> } } }>("src/apify/client.js");
    await apify.run(job.runId).abort({ gracefully: true }).catch(() => {});
  }
  const { emit, updateJob } = await pipeline<{ emit: (dir: string, e: object) => void; updateJob: (dir: string, c: object) => void }>("src/jobs/store.js");
  emit(jobPath(id), { step: job.step, kind: "stopped", text: STOPPED });
  updateJob(jobPath(id), { status: "failed", failed: STOPPED, runnerPid: null, holdRequested: false });
  return Response.json({ ok: true });
}
