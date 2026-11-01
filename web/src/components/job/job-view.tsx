"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/shell";
import { TickMark } from "@/components/tick";
import { cn } from "@/lib/utils";
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
          <div className="min-w-0">
            <h1 className="condensed text-[28px] leading-tight font-semibold tracking-[-0.01em]">{job.title ?? "Reading your spec…"}</h1>
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
          <div className="text-right" aria-live="polite">
            <p className="condensed text-[38px] leading-none font-semibold">
              {job.runId ? n(job.rows ?? 0) : "–"}
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
          <TabsPrimitive.List aria-label="Steps" className="grid grid-cols-2 overflow-hidden rounded-lg border bg-sheet sm:grid-cols-3 xl:grid-cols-6">
            {steps.map((s) => (
              <TabsPrimitive.Trigger
                key={s.tab}
                value={s.tab}
                className={cn(
                  "relative border-r border-b border-rule px-3.5 py-3 text-left outline-none last:border-r-0 hover:bg-raised focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink xl:border-b-0",
                  "data-[state=active]:bg-raised data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:bottom-0 data-[state=active]:after:h-0.75 data-[state=active]:after:bg-ink"
                )}
              >
                <span className={cn("flex items-center gap-1.5 text-[13px] font-semibold", s.state === "todo" ? "text-ink-3" : "text-ink")}>
                  {s.tick ? <TickMark tick={s.tick} /> : s.state === "now" ? <span role="img" aria-label="under way" className="size-2 shrink-0 rounded-full bg-ink" /> : null}
                  {s.label}
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-ink-2">{s.line}</span>
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
