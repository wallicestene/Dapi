"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Mark, TopBar } from "@/components/shell";
import { TickMark } from "@/components/tick";
import { cn } from "@/lib/utils";
import { STAGE_TEXT, stageOf } from "@/lib/stage";
import { BorderBeam } from "@/components/ui/border-beam";
import { NumberTicker } from "@/components/ui/number-ticker";

// Which of the mark's four stages each step belongs to, and the beam that runs round the
// step under way: that stage's colour, fading to a light tint of it.
const STEP_STAGE: Record<Tab, number> = { spec: 1, site: 1, code: 2, samples: 2, run: 3, footed: 4 };
const BEAM: Record<number, [string, string]> = {
  1: ["var(--source)", "#c4b8ff"],
  2: ["var(--extract)", "#ffb0a8"],
  3: ["var(--deliver)", "#9eece3"],
  4: ["var(--verified)", "#dcf7a8"],
};
import { defaultTab, n, stepStates, type Report, type Tab } from "@/lib/steps";
import type { Job, JobEvent } from "@/lib/types";
import { SpecPanel } from "./spec-panel";
import { SitePanel } from "./site-panel";
import { CodePanel } from "./code-panel";
import { SamplesPanel } from "./samples-panel";
import { RunPanel } from "./run-panel";
import { FootedPanel } from "./footed-panel";

export function JobView({
  initialJob,
  initialEvents,
  initialReport,
  readOnly,
}: {
  initialJob: Job;
  initialEvents: JobEvent[];
  initialReport: Report | null;
  readOnly: boolean;
}) {
  const [job, setJob] = useState(initialJob);
  const [events, setEvents] = useState(initialEvents);
  const [report, setReport] = useState(initialReport);
  const [picked, setPicked] = useState<Tab | null>(null);

  // Live: the job's summary and each new event, until the job finishes.
  useEffect(() => {
    if (["done", "failed", "declined", "cancelled", "stopped"].includes(initialJob.status)) return;
    const source = new EventSource(`/api/jobs/${initialJob.id}/stream?since=${initialEvents.length}`);
    source.addEventListener("job", (e) => setJob(JSON.parse((e as MessageEvent).data)));
    source.addEventListener("events", (e) => {
      const fresh: JobEvent[] = JSON.parse((e as MessageEvent).data);
      setEvents((prev) => [...prev, ...fresh.filter((f) => f.n >= prev.length)]);
    });
    source.addEventListener("end", () => source.close());
    return () => source.close();
  }, [initialJob.id, initialJob.status, initialEvents.length]);

  // In step with Apify: a run resurrected or left unwatched gets a runner to follow it
  // again (then the page reloads to stream it); a finished run's own report is recorded.
  useEffect(() => {
    if (["declined", "cancelled", "failed"].includes(initialJob.status) || (initialJob.status === "done" && initialJob.apify)) return;
    const check = () =>
      fetch(`/api/jobs/${initialJob.id}/sync`, { method: "POST" })
        .then((r) => (r.ok ? r.json() : null))
        .then((r) => {
          if ((r?.state === "following" && initialJob.status !== "running") || r?.state === "runner-died") window.location.reload();
        })
        .catch(() => {});
    check();
    // While a job is under way, look again now and then: a runner can die at any step.
    const timer = initialJob.status === "running" || initialJob.status === "waiting" ? setInterval(check, 60_000) : undefined;
    return () => clearInterval(timer);
  }, [initialJob.id, initialJob.runId, initialJob.status]);

  // The run's report arrives with the footing event.
  useEffect(() => {
    if (job.status !== "done" || report) return;
    fetch(`/api/jobs/${job.id}/files/report.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => r && setReport(r))
      .catch(() => {});
  }, [job.status, job.id, report]);

  const steps = useMemo(() => stepStates(job, events, report), [job, events, report]);
  const tab = picked ?? defaultTab(job, events);
  const live = !["done", "failed", "declined", "cancelled", "stopped"].includes(job.status);
  // The mark as the job's progress: source, extract, deliver, verified.
  const stage = stageOf(job);
  const host = job.sourceUrl ? new URL(job.sourceUrl).host : null;
  const expected = job.expected ?? null;

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar
        crumb={job.title ?? `Job ${job.id}`}
        actions={
          <>
            {job.runUrl && (
              <Button variant="outline" asChild className="hidden h-8 border-control bg-sheet sm:inline-flex">
                <a href={job.runUrl} target="_blank" rel="noreferrer">
                  Open run on Apify
                </a>
              </Button>
            )}
            {!readOnly && (
              <Button asChild className="h-8">
                <Link href="/jobs/new">New job</Link>
              </Button>
            )}
          </>
        }
      />

      <main className="flex flex-1 flex-col gap-4 px-6 pt-5 pb-8 md:px-7">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div className="flex min-w-0 items-start gap-3.5">
            <Mark className="mt-0.5 size-10 shrink-0" lit={stage} now={live && job.status !== "waiting" ? stage : undefined} label={STAGE_TEXT[stage - 1]} />
            <div className="min-w-0">
              <h1 className="text-[28px] leading-tight font-bold tracking-[-0.03em]">{job.title ?? "Reading your spec…"}</h1>
              <p className="mt-1 text-[14px] text-ink-2">
                {host ? (
                  <>
                    <a href={job.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-ink">
                      {host}
                    </a>
                    {job.rowUnit && <> · each row is {job.rowUnit}</>}
                  </>
                ) : (
                  `Job ${job.id}, started ${new Date(job.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`
                )}
              </p>
            </div>
          </div>
          <div className="text-right" aria-live="polite">
            <p className="text-[38px] leading-none font-bold tracking-[-0.03em]">
              {job.runId ? <NumberTicker value={job.rows ?? 0} /> : "–"}
              <span className="text-ink-3"> / </span>
              {expected !== null ? n(expected) : job.records ? <span className="text-ink-3">…</span> : "–"}
            </p>
            <p className="mt-1.5 text-[13px] text-ink-2">
              {job.status === "done"
                ? `rows delivered · footed against the source's count`
                : job.runId
                  ? `rows delivered · ${live ? "streaming" : job.status}`
                  : job.status === "declined"
                    ? "nothing run: the source refused"
                    : "rows delivered once the run starts"}
            </p>
          </div>
        </div>

        <TabsPrimitive.Root value={tab} onValueChange={(v) => setPicked(v as Tab)} className="flex flex-1 flex-col gap-4">
          {/* Each step carries the mark lit to its stage; the one under way has a beam running round it. */}
          <TabsPrimitive.List aria-label="Steps" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {steps.map((s) => (
              <TabsPrimitive.Trigger
                key={s.tab}
                value={s.tab}
                className={cn(
                  "group relative overflow-hidden rounded-xl border bg-sheet px-3.5 pt-3 pb-3.5 text-left outline-none transition-[background-color,box-shadow,border-color] hover:border-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                  "data-[state=active]:border-ink data-[state=active]:bg-white data-[state=active]:shadow-[0_8px_24px_-12px_rgb(15_26_36/0.3)]",
                  s.state === "todo" && "bg-transparent",
                  s.state === "stopped" && "border-pencil-red/50",
                  s.state === "now" && job.status === "waiting" && "border-deliver ring-3 ring-deliver/20"
                )}
              >
                {s.state === "now" && job.status === "running" && <BorderBeam size={80} duration={4} borderWidth={2} colorFrom={BEAM[STEP_STAGE[s.tab]][0]} colorTo={BEAM[STEP_STAGE[s.tab]][1]} />}
                <span className="flex items-center gap-2">
                  <Mark className="size-5 shrink-0" lit={s.state === "todo" ? 0 : STEP_STAGE[s.tab]} now={s.state === "now" && job.status === "running" ? STEP_STAGE[s.tab] : undefined} />
                  <span className={cn("truncate text-[13.5px] font-semibold", s.state === "todo" ? "text-ink-3" : s.state === "stopped" ? "text-pencil-red" : "text-ink")}>{s.label}</span>
                  {s.tick && <TickMark tick={s.tick} className="ml-auto" />}
                </span>
                <span className="mt-1 block truncate pl-7 text-[12px] text-ink-2">{s.line}</span>
              </TabsPrimitive.Trigger>
            ))}
          </TabsPrimitive.List>

          <TabsPrimitive.Content value="spec" className="outline-none">
            <SpecPanel job={job} events={events} />
          </TabsPrimitive.Content>
          <TabsPrimitive.Content value="site" className="outline-none">
            <SitePanel job={job} events={events} />
          </TabsPrimitive.Content>
          <TabsPrimitive.Content value="code" className="outline-none">
            <CodePanel job={job} events={events} />
          </TabsPrimitive.Content>
          <TabsPrimitive.Content value="samples" className="outline-none">
            <SamplesPanel events={events} report={report} />
          </TabsPrimitive.Content>
          <TabsPrimitive.Content value="run" className="flex flex-1 flex-col outline-none">
            <RunPanel job={job} events={events} readOnly={readOnly} />
          </TabsPrimitive.Content>
          <TabsPrimitive.Content value="footed" className="outline-none">
            <FootedPanel job={job} events={events} report={report} />
          </TabsPrimitive.Content>
        </TabsPrimitive.Root>
      </main>
    </div>
  );
}
