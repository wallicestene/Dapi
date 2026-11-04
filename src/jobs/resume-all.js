// At boot: every job that was under way when the server stopped (a deploy, a restart),
// or that was marked lost in the last hour, starts again at the step it was on.
// Usage: node src/jobs/resume-all.js (deploy/start.sh runs it before the web app).

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JOBS_DIR, emit, readJson, writeJson } from './store.js';
import { LOST, resumeArgs } from './resume.js';

const runner = fileURLToPath(new URL('./run-job.js', import.meta.url));
const hour = Date.now() - 3600_000;
for (const id of fs.existsSync(JOBS_DIR) ? fs.readdirSync(JOBS_DIR).filter((d) => /^\d{4}$/.test(d)).sort() : []) {
  const dir = path.join(JOBS_DIR, id);
  const job = readJson(dir, 'job.json');
  if (!job) continue;
  const lost = job.status === 'failed' && job.failed === LOST && Date.parse(job.updatedAt ?? 0) > hour;
  if (!['running', 'waiting'].includes(job.status) && !lost) continue;
  // A job that keeps getting cut off (a host that stops the machine every few minutes)
  // would start the same step over and over and pay for it each time: after three
  // pick-ups it waits for its owner's "Start again". The job page counts on the same tally.
  const resumes = Number(job.autoResumes ?? 0);
  if (resumes >= 3) {
    writeJson(dir, 'job.json', { ...job, status: 'failed', failed: LOST, runnerPid: null, updatedAt: new Date().toISOString() });
    console.log(`left job ${id} for its owner after ${resumes} pick-ups`);
    continue;
  }
  const args = resumeArgs(dir, job);
  const log = fs.openSync(path.join(dir, 'runner.log'), 'a');
  const child = spawn(process.execPath, [runner, id, ...args], { detached: true, stdio: ['ignore', log, log], env: process.env });
  child.unref();
  writeJson(dir, 'job.json', { ...job, status: job.status === 'failed' ? 'running' : job.status, failed: null, runnerPid: child.pid, autoResumes: resumes + 1, updatedAt: new Date().toISOString() });
  emit(dir, { step: job.step, kind: 'resume', text: 'The server restarted while this job ran. Dapi picked it up at this step.' });
  console.log(`resumed job ${id} at ${job.step} ${args.join(' ')}`.trim());
}
