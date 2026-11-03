// The user's answer to the plan: run it (optionally fetching what robots.txt
// disallows, which the run then marks in every receipt), or stop the job.

import fs from "node:fs";
import { READ_ONLY, getJob, jobPath, validId } from "@/lib/server/dapi";
import { jobFor } from "@/lib/server/access";

export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/approve">) {
  const { id } = await ctx.params;
  // On the public demo: a job someone may not see doesn't exist for them; only its owner acts on it.
  const access = await jobFor(id, "act");
  if (access instanceof Response) return access;
  const job = validId(id) ? getJob(id) : null;
  if (!job) return Response.json({ error: "no such job" }, { status: 404 });
  if (READ_ONLY) return Response.json({ error: "Read-only copy." }, { status: 403 });
  if (job.status !== "waiting") return Response.json({ error: "This job isn't waiting for a decision." }, { status: 409 });
  const body = await request.json().catch(() => ({}));
  const answer = { go: body.go === true, robotsOverride: body.robotsOverride === true, at: new Date().toISOString() };
  fs.writeFileSync(jobPath(id, "approve.json"), JSON.stringify(answer, null, 2) + "\n", { flag: "wx" });
  return Response.json(answer);
}
