// Keeps a job in step with its run on Apify after the runner has stopped watching:
// a run resurrected or still going gets a runner to follow it again; a finished run's
// own report (status, time, cost) is recorded if the job doesn't have it yet.

import { READ_ONLY, getJob, jobPath, pipeline, validId } from "@/lib/server/dapi";
import { runnerAlive, startRunner } from "@/lib/server/runner";

interface ApifyRun {
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  usageTotalUsd?: number;
  stats?: { runTimeSecs?: number; computeUnits?: number; migrationCount?: number; restartCount?: number; resurrectCount?: number };
}

export async function POST(_request: Request, ctx: RouteContext<"/api/jobs/[id]/sync">) {
  const { id } = await ctx.params;
  const job = validId(id) ? getJob(id) : null;
  if (!job) return Response.json({ error: "no such job" }, { status: 404 });
  if (!job.runId) return Response.json({ state: "no-run" });
  if (runnerAlive(job.runnerPid)) return Response.json({ state: "watching" });

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
