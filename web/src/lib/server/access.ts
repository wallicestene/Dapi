import { READ_ONLY, getJob, validId } from "@/lib/server/dapi";
import { PUBLIC, currentUser, type User } from "@/lib/server/session";
import type { Job } from "@/lib/types";

// Who may see a job and who may act on it. Run by its owner (neither public nor
// read-only), Dapi shows everything. On the public demo, the featured jobs are open to
// everyone and every other job only to the account that started it.
export const FEATURED = (process.env.DAPI_FEATURED ?? "0003").split(",").map((s) => s.trim());

export function canSee(job: Job, user: User | null) {
  if (!PUBLIC) return true;
  return FEATURED.includes(job.id) || (user !== null && job.owner?.id === user.id);
}

export function canAct(job: Job, user: User | null) {
  if (READ_ONLY) return false;
  if (!PUBLIC) return true;
  return user !== null && job.owner?.id === user.id;
}

// For API routes: the job, if this visitor may see it (or act on it), or a response to
// send instead. A job someone may not see answers as if it didn't exist.
export async function jobFor(id: string, need: "see" | "act" = "see"): Promise<{ job: Job; user: User | null } | Response> {
  const job = validId(id) ? getJob(id) : null;
  const user = PUBLIC ? await currentUser() : null;
  if (!job || !canSee(job, user)) return Response.json({ error: "No such job." }, { status: 404 });
  if (need === "act" && !canAct(job, user)) return Response.json({ error: READ_ONLY ? "Read-only copy." : "Only the person who started this job can do that." }, { status: 403 });
  return { job, user };
}
