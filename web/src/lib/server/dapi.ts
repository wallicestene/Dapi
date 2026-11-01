// The web app's door into the pipeline in ../src. Those modules are loaded at run time
// from their own files, not bundled, so there is one implementation of the job store,
// the evidence loader and the receipt locator, and they find their .env as they do
// from the terminal.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Job, JobEvent } from "@/lib/types";

export const REPO = path.resolve(process.cwd(), "..");
export const JOBS_DIR = path.resolve(process.env.DAPI_JOBS_DIR ?? path.join(REPO, "jobs"));

// Hosted for exploring finished jobs only: no new jobs, no Go.
export const READ_ONLY = process.env.DAPI_READ_ONLY === "1";

export function pipeline<T>(relative: string): Promise<T> {
  return import(/* turbopackIgnore: true */ /* webpackIgnore: true */ pathToFileURL(path.join(REPO, relative)).href);
}

export const validId = (id: string) => /^\d{4}$/.test(id);
export const jobPath = (id: string, ...rest: string[]) => path.join(JOBS_DIR, id, ...rest);

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function getJob(id: string): Job | null {
  return validId(id) ? readJson<Job>(jobPath(id, "job.json")) : null;
}

export function listJobs(): Job[] {
  if (!fs.existsSync(JOBS_DIR)) return [];
  return fs
    .readdirSync(JOBS_DIR)
    .filter(validId)
    .map(getJob)
    .filter((j): j is Job => j !== null)
    .sort((a, b) => b.id.localeCompare(a.id));
}

export function getEvents(id: string, since = 0): JobEvent[] {
  try {
    return fs
      .readFileSync(jobPath(id, "events.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(since)
      .map((line) => JSON.parse(line) as JobEvent);
  } catch {
    return [];
  }
}
