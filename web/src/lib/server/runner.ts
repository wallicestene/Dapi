// Starting and checking job runners: one process per job (src/jobs/run-job.js), which
// writes the job's folder. Detached, so a job outlives this server.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { JOBS_DIR, REPO, jobPath } from "@/lib/server/dapi";

export function startRunner(id: string, args: string[] = []) {
  const log = fs.openSync(jobPath(id, "runner.log"), "a");
  const child = spawn(process.execPath, [path.join(REPO, "src/jobs/run-job.js"), id, ...args], {
    cwd: REPO,
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, DAPI_JOBS_DIR: JOBS_DIR },
  });
  child.unref();
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
