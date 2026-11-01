// Job folders: one per job under jobs/ (or DAPI_JOBS_DIR), numbered in sequence.
// The runner appends what the agent does to events.jsonl and keeps a short summary
// in job.json; the web app only reads these files, so a job survives the web server
// restarting and anyone can see what happened afterwards.
//
//   jobs/0001/job.json        summary: title, status, current step, counts, run links
//   jobs/0001/events.jsonl    one event per line, in order
//   jobs/0001/input.pdf       the spec as the user gave it
//   jobs/0001/spec.json, findings.json, site.js   what each step produced
//   jobs/0001/img-3.png       pictures the agent looked at
//   jobs/0001/rows.jsonl      delivered rows, copied from the Apify dataset as they land
//   jobs/0001/approve.json    written by the web app when the user says Go

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const JOBS_DIR = path.resolve(process.env.DAPI_JOBS_DIR ?? path.join(root, 'jobs'));

export function createJob(inputPath) {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  const taken = fs.readdirSync(JOBS_DIR).filter((d) => /^\d{4}$/.test(d)).map(Number);
  const id = String(Math.max(0, ...taken) + 1).padStart(4, '0');
  const dir = path.join(JOBS_DIR, id);
  fs.mkdirSync(dir);
  const input = `input${path.extname(inputPath).toLowerCase() || '.txt'}`;
  fs.copyFileSync(inputPath, path.join(dir, input));
  writeJson(dir, 'job.json', { id, input, status: 'running', step: 'spec', createdAt: new Date().toISOString() });
  return { id, dir };
}

export const jobDir = (id) => path.join(JOBS_DIR, id);

export function readJson(dir, name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  } catch {
    return null;
  }
}

export function writeJson(dir, name, value) {
  // Write then rename, so a reader never sees half a file.
  const tmp = path.join(dir, `.${name}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, path.join(dir, name));
}

export function updateJob(dir, changes) {
  const job = { ...readJson(dir, 'job.json'), ...changes, updatedAt: new Date().toISOString() };
  writeJson(dir, 'job.json', job);
  return job;
}

// One event: { at, step, kind, text, ...data }. `text` is the plain sentence the user
// reads; the rest is detail for the screen to draw. A picture (`image`, a Buffer) is
// saved next to the log and replaced by its file name.
export function emit(dir, event) {
  const n = fs.existsSync(path.join(dir, 'events.jsonl'))
    ? fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).length
    : 0;
  const { image, ...rest } = event;
  const line = { n, at: new Date().toISOString(), ...rest };
  if (image) {
    line.image = `img-${n}.png`;
    fs.writeFileSync(path.join(dir, line.image), image);
  }
  fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify(line) + '\n');
  return line;
}

export function readEvents(dir) {
  try {
    return fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
