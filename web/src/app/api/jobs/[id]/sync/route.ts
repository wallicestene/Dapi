// Keeps a job in step with its run on Apify after the runner has stopped watching:
// a run resurrected or still going gets a runner to follow it again; a finished run's
// own report (status, time, cost) is recorded if the job doesn't have it yet.

import { READ_ONLY, getJob, jobPath, pipeline, validId } from "@/lib/server/dapi";
import { runnerAlive, startRunner } from "@/lib/server/runner";
import { jobFor } from "@/lib/server/access";

interface ApifyRun {
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  usageTotalUsd?: number;
  stats?: { runTimeSecs?: number; computeUnits?: number; migrationCount?: number; restartCount?: number; resurrectCount?: number };
}

export async function POST(_request: Request, ctx: RouteContext<"/api/jobs/[id]/sync">) {
  const { id } = await ctx.params;
  // On the public demo: a job someone may not see doesn't exist for them; only its owner acts on it.
  const access = await jobFor(id, "see");
  if (access instanceof Response) return access;
  const job = validId(id) ? getJob(id) : null;
  if (!job) return Response.json({ error: "no such job" }, { status: 404 });
  if (runnerAlive(job.runnerPid)) return Response.json({ state: "watching" });
  // A job that says it's under way but whose runner is gone before any run started
  // (a crash in the investigation): say so, rather than "running" forever.
  if (!job.runId) {
    // A job written in the last 20 s has just been started or resumed: its runner may not
    // have taken over yet, so it isn't called dead.
    const fresh = Date.now() - Date.parse(job.updatedAt ?? "1970-01-01") < 20_000;
    if (["running", "waiting"].includes(job.status) && job.runnerPid && !fresh) {
      const { updateJob, emit } = await pipeline<{ updateJob: (dir: string, changes: object) => void; emit: (dir: string, e: object) => void }>("src/jobs/store.js");
      // A runner stopped from outside (a deploy, a restart) picks up at its step, twice
      // at most: something that keeps killing it is a real failure.
      const resumes = Number((job as { autoResumes?: number }).autoResumes ?? 0);
      if (!READ_ONLY && resumes < 2) {
        const { resumeArgs } = await pipeline<{ resumeArgs: (dir: string, job: object) => string[] }>("src/jobs/resume.js");
        emit(jobPath(id), { step: job.step, kind: "resume", text: "Dapi's runner for this job stopped. Dapi picked it up at this step." });
        startRunner(id, resumeArgs(jobPath(id), job), { status: job.status, autoResumes: resumes + 1 });
        return Response.json({ state: "resumed" });
      }
      emit(jobPath(id), { step: job.step, kind: "error", text: "Dapi's runner for this job stopped unexpectedly. Start the job again." });
      updateJob(jobPath(id), { status: "failed", failed: "The runner stopped unexpectedly." });
      return Response.json({ state: "runner-died" });
    }
    return Response.json({ state: "no-run" });
  }

  const { apify } = await pipeline<{ apify: { run: (id: string) => { get: () => Promise<ApifyRun> } } }>("src/apify/client.js");
  const run = await apify.run(job.runId).get();
  if (["READY", "RUNNING"].includes(run.status)) {
    if (READ_ONLY) return Response.json({ state: "running-unwatched", status: run.status });
    startRunner(id, ["--follow"]);
    return Response.json({ state: "following", status: run.status });
  }
  if (job.apify?.status !== run.status) {
    const { updateJob } = await pipeline<{ updateJob: (dir: string, changes: object) => void }>("src/jobs/store.js");
    updateJob(jobPath(id), {
      runStatus: run.status,
      apify: {
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt ?? null,
        seconds: run.stats?.runTimeSecs ?? null,
        computeUnits: run.stats?.computeUnits ?? null,
        usd: run.usageTotalUsd ?? null,
        migrations: run.stats?.migrationCount ?? 0,
        restarts: run.stats?.restartCount ?? 0,
        resurrects: run.stats?.resurrectCount ?? 0,
      },
    });
  }
  return Response.json({ state: "settled", status: run.status });
}
