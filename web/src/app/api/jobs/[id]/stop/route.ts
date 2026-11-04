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

  // The runner was started detached, so it leads its own process group. SIGTERM first, so
  // Playwright closes the browser it drives; but Playwright's handler catches SIGTERM and
  // the runner carries on (job 0005, Nov 4: stopped mid-investigation, it went on to the
  // plan), so whatever is still alive a second later is killed outright.
  const pid = job.runnerPid;
  const signal = (s: NodeJS.Signals) => {
    try {
      process.kill(-pid!, s);
    } catch {
      try {
        process.kill(pid!, s);
      } catch {
        // already gone
      }
    }
  };
  if (pid && runnerAlive(pid)) {
    signal("SIGTERM");
    await new Promise((r) => setTimeout(r, 1000));
    if (runnerAlive(pid)) signal("SIGKILL");
    await new Promise((r) => setTimeout(r, 200));
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
