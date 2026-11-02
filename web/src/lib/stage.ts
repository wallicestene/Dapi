import type { Job } from "./types";

// Where a job is, as the mark's four stages: source, extract, deliver, verified.
export function stageOf(job: Pick<Job, "status" | "step">) {
  return job.status === "done" ? 4 : { spec: 1, site: 1, code: 2, plan: 2, run: 3, footed: 4 }[job.step];
}

export const STAGE_TEXT = ["Stage 1 of 4: reading the spec and the site", "Stage 2 of 4: writing and testing the extraction", "Stage 3 of 4: running on Apify", "Delivered: every value traced"];

export function took(seconds?: number | null) {
  if (!seconds) return null;
  return seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;
}

export function cost(usd?: number | null) {
  if (!usd) return null;
  return usd < 0.01 ? "under $0.01" : `$${usd.toFixed(2)}`;
}
