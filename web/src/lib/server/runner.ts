// Starting and checking job runners: one process per job (src/jobs/run-job.js), which
// writes the job's folder. Detached, so a job outlives this server.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { JOBS_DIR, REPO, jobPath } from "@/lib/server/dapi";

// The new runner's id goes into the job at once, with whatever the route says the job
// now is (running, at a step): until the runner writes it itself, the job would still
// name the runner that last exited, and the page's liveness check would take a job that
// just restarted for one that died.
export function startRunner(id: string, args: string[] = [], changes: Record<string, unknown> = {}) {
  const log = fs.openSync(jobPath(id, "runner.log"), "a");
  const child = spawn(process.execPath, [path.join(REPO, "src/jobs/run-job.js"), id, ...args], {
    cwd: REPO,
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, DAPI_JOBS_DIR: JOBS_DIR },
  });
  child.unref();
  const file = jobPath(id, "job.json");
  try {
    const job = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify({ ...job, ...changes, failed: null, runnerPid: child.pid, updatedAt: new Date().toISOString() }, null, 2));
  } catch {
    // a job folder still being written: the runner records its id itself
  }
  return child.pid;
}

// Whether the runner that last wrote this job is still alive.
export function runnerAlive(pid?: number) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
