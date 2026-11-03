import fs from "node:fs";
import path from "node:path";
import { JOBS_DIR, listJobs } from "@/lib/server/dapi";
import type { User } from "@/lib/server/session";
import type { Job } from "@/lib/types";

// The public demo runs on its owner's Meta and Apify accounts, so everyone gets a turn
// and the month's budget holds: a few jobs per person, one at a time, a few at once on
// the server, a daily cap, and no new jobs once Meta's charges (jobs/usage.jsonl) near
// the budget. Meta's own spend limit is the hard stop behind this.
export const LIMITS = {
  perUser: Number(process.env.DAPI_JOBS_PER_USER ?? 3),
  atOnce: 2,
  perDay: 30,
  budgetUsd: Number(process.env.DAPI_BUDGET_USD ?? 60),
};

const going = (j: Job) => ["running", "waiting", "held"].includes(j.status);
// A spec declined for its address costs one short Muse Spark read: it doesn't use a turn.
const counts = (j: Job) => !(j.status === "declined" && j.declined?.startsWith("Dapi only reads public"));

export function spentThisMonth() {
  const month = new Date().toISOString().slice(0, 7);
  try {
    return fs
      .readFileSync(path.join(JOBS_DIR, "usage.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { at: string; usd: number })
      .filter((u) => u.at.startsWith(month))
      .reduce((t, u) => t + u.usd, 0);
  } catch {
    return 0;
  }
}

export function turnsLeft(user: User) {
  return Math.max(0, LIMITS.perUser - listJobs().filter((j) => j.owner?.id === user.id && counts(j)).length);
}

// Whether this person may start a job now, and if not, why, in plain words.
export function mayStart(user: User | null): { ok: true; left: number } | { ok: false; reason: string } {
  if (!user) return { ok: false, reason: "Sign in with GitHub to run a job." };
  const jobs = listJobs().filter((j) => j.owner);
  const mine = jobs.filter((j) => j.owner!.id === user.id);
  const left = turnsLeft(user);
  if (!left) return { ok: false, reason: `You've used your ${LIMITS.perUser} jobs on the demo. Thanks for trying Dapi.` };
  const busy = mine.find(going);
  if (busy) return { ok: false, reason: `Your job “${busy.title ?? busy.id}” is still going: one at a time.` };
  if (jobs.filter((j) => j.status === "running").length >= LIMITS.atOnce) return { ok: false, reason: `${LIMITS.atOnce} jobs are running right now. Try again in a few minutes.` };
  const today = new Date().toISOString().slice(0, 10);
  if (jobs.filter((j) => j.createdAt.startsWith(today) && counts(j)).length >= LIMITS.perDay) return { ok: false, reason: `The demo has run its ${LIMITS.perDay} jobs for today. Come back tomorrow.` };
  if (spentThisMonth() >= LIMITS.budgetUsd) return { ok: false, reason: "The demo's budget for this month is used up. The video shows Dapi end to end." };
  return { ok: true, left };
}
