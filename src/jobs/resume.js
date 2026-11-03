// A job whose runner is gone picks up at the step it was on, from what that step saved.
// A deploy or a restart of the server stops every runner; the run on Apify, if one had
// started, carries on by itself and is followed again. Used at boot (resume-all.js), by
// the job page's check, and by "Start again".

import fs from 'node:fs';
import path from 'node:path';

export const LOST = 'The runner stopped unexpectedly.';

export function resumeArgs(dir, job) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  if (job.runId && ['run', 'footed'].includes(job.step)) return ['--follow'];
  if (['plan', 'run'].includes(job.step) && has('site.js')) return ['--from', 'plan'];
  if (job.step === 'code' && has('findings.json')) return ['--from', 'code'];
  if (job.step === 'site' && has('spec.json')) return ['--from', 'site'];
  return [];
}
