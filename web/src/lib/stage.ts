import type { Job } from "./types";

// Where a job is, as the mark's four stages: source, extract, deliver, verified.
export function stageOf(job: Pick<Job, "status" | "step">) {
  return job.status === "done" ? 4 : { spec: 1, site: 1, code: 2, plan: 2, run: 3, footed: 4 }[job.step];
}

export const STAGE_TEXT = ["Stage 1 of 4: reading the spec and the site", "Stage 2 of 4: writing and testing the extraction", "Stage 3 of 4: running on Apify", "Delivered: every value traced"];

// How the strategy reads a column, in the client's words.
export const ROUTE_WORD: Record<string, string> = { feed: "data feed", embedded: "embedded data", page: "record page", register: "register", "shared-page": "shared page", constant: "fixed", derived: "derived", none: "gap" };

export function took(seconds?: number | null) {
  if (!seconds) return null;
  return seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;
}

export function cost(usd?: number | null) {
  if (!usd) return null;
  return usd < 0.01 ? "under $0.01" : `$${usd.toFixed(2)}`;
}

// Who stopped a job. The client's own pauses (at the plan, between steps, the run on
// Apify) always carry on from where they stopped; the pipeline stopping itself (refused,
// failed a check, a broken run) is a different thing, shown in red.
export const pausedByYou = (job: Pick<Job, "status" | "paused">) => job.status === "cancelled" || job.status === "held" || (job.status === "stopped" && Boolean(job.paused));
export const stoppedItself = (job: Pick<Job, "status" | "paused">) => job.status === "failed" || job.status === "declined" || (job.status === "stopped" && !job.paused);
