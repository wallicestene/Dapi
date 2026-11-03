// Server-sent events for one job: its summary whenever it changes, and each new event
// the agent writes. Ends once the job has finished one way or another.

import fs from "node:fs";
import { getEvents, getJob, jobPath, validId } from "@/lib/server/dapi";
import { jobFor } from "@/lib/server/access";

const FINISHED = new Set(["done", "failed", "declined", "cancelled", "stopped"]);

export async function GET(request: Request, ctx: RouteContext<"/api/jobs/[id]/stream">) {
  const { id } = await ctx.params;
  // On the public demo: a job someone may not see doesn't exist for them; only its owner acts on it.
  const access = await jobFor(id, "see");
  if (access instanceof Response) return access;
  if (!validId(id) || !getJob(id)) return new Response("no such job", { status: 404 });
  const since = Number(new URL(request.url).searchParams.get("since") ?? 0);

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      let sent = since;
      let jobStamp = "";
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const tick = () => {
        try {
          const stamp = fs.statSync(jobPath(id, "job.json")).mtimeMs.toString();
          const job = getJob(id);
          if (job && stamp !== jobStamp) {
            jobStamp = stamp;
            send("job", job);
          }
          const events = getEvents(id, sent);
          if (events.length) {
            sent += events.length;
            send("events", events);
          }
          if (job && FINISHED.has(job.status)) {
            clearInterval(timer);
            send("end", { status: job.status });
            controller.close();
          }
        } catch {
          // the job file is being replaced; try again on the next tick
        }
      };
      tick();
      timer = setInterval(tick, 1000);
      request.signal.addEventListener("abort", () => clearInterval(timer));
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}
