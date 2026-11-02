import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Mark, TopBar } from "@/components/shell";
import { JobArt } from "@/components/job-art";
import { TickMark } from "@/components/tick";
import { READ_ONLY, listJobs } from "@/lib/server/dapi";
import { STAGE_TEXT, cost, stageOf, took } from "@/lib/stage";
import { cn } from "@/lib/utils";
import type { Job } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Jobs · Dapi" };

const STATUS: Record<Job["status"], string> = {
  running: "Running",
  waiting: "Waiting for your Go",
  done: "Delivered",
  failed: "Stopped: failed a check",
  declined: "Refused",
  cancelled: "Stopped by you",
  stopped: "Run stopped",
};

const FILTERS = [
  { key: "all", label: "All", has: () => true },
  { key: "delivered", label: "Delivered", has: (j: Job) => j.status === "done" },
  { key: "active", label: "In progress", has: (j: Job) => j.status === "running" || j.status === "waiting" },
  { key: "stopped", label: "Stopped", has: (j: Job) => ["failed", "declined", "cancelled", "stopped"].includes(j.status) },
];

export default async function Jobs({ searchParams }: PageProps<"/jobs">) {
  const { show } = await searchParams;
  const jobs = listJobs();
  const filter = FILTERS.find((f) => f.key === show) ?? FILTERS[0];
  const shown = jobs.filter(filter.has);
  // On "All", the work in progress and what was delivered come first; stopped attempts
  // sit in their own section below.
  const stopped = FILTERS[3].has;
  const groups = filter.key === "all" ? [{ title: null, jobs: shown.filter((j) => !stopped(j)) }, { title: "Stopped", jobs: shown.filter(stopped) }] : [{ title: null, jobs: shown }];
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-5 pt-8 pb-14 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[32px] leading-tight font-bold tracking-[-0.03em]">Jobs</h1>
            <p className="mt-1 text-[15px] text-ink-2">Every job turns a spec into a dataset you can prove.</p>
          </div>
          {!READ_ONLY && (
            <Button asChild className="h-10 gap-2 px-4">
              <Link href="/jobs/new">
                <Plus aria-hidden /> New job
              </Link>
            </Button>
          )}
        </div>

        <nav aria-label="Filter jobs" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const on = f === filter;
            return (
              <Link
                key={f.key}
                href={f.key === "all" ? "/jobs" : `/jobs?show=${f.key}`}
                aria-current={on ? "page" : undefined}
                className={cn("inline-flex h-8 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition-colors", on ? "border-ink bg-ink text-sheet" : "border-border bg-sheet text-ink-2 hover:border-ink-3 hover:text-ink")}
              >
                {f.label}
                <span className={cn("tabular-nums", on ? "text-sheet/70" : "text-ink-3")}>{jobs.filter(f.has).length}</span>
              </Link>
            );
          })}
        </nav>

        {shown.length ? (
          groups
            .filter((g) => g.jobs.length)
            .map((g) => (
              <section key={g.title ?? "main"} className="flex flex-col gap-3">
                {g.title && <h2 className="mt-4 text-[15px] font-semibold text-ink-2">{g.title}</h2>}
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {g.jobs.map((job) => (
                    <li key={job.id}>
                      <JobCard job={job} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-sheet px-6 py-16 text-center">
            <Mark className="size-12" lit={0} />
            <p className="text-[16px] font-semibold">{jobs.length ? "No jobs here" : "No jobs yet"}</p>
            {!READ_ONLY && !jobs.length && (
              <Button asChild className="h-9 px-4">
                <Link href="/jobs/new">Start one from a spec</Link>
              </Button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function JobCard({ job }: { job: Job }) {
  const host = job.sourceUrl ? new URL(job.sourceUrl).host.replace(/^www\./, "") : null;
  const stage = stageOf(job);
  const live = job.status === "running";
  const bad = ["failed", "declined", "cancelled", "stopped"].includes(job.status);
  const short = job.status === "done" && job.expected != null && (job.rows ?? 0) < job.expected;
  const meta = [took(job.apify?.seconds), cost(job.apify?.usd), new Date(job.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })].filter(Boolean);
  return (
    <Link href={`/jobs/${job.id}`} className="group flex h-full flex-col overflow-hidden rounded-xl border bg-sheet transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-ink-3 hover:shadow-[0_10px_28px_-14px_rgb(15_26_36/0.35)]">
      <div className="relative">
        <JobArt seed={host ?? job.id} muted={bad} className="h-28" />
        <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-sheet/95 py-1 pr-2.5 pl-1.5 text-[12px] font-medium shadow-sm">
          <Mark className="size-4" bg="var(--sheet)" lit={stage} now={live ? stage : undefined} label={STAGE_TEXT[stage - 1]} />
          <span className={bad ? "text-pencil-red" : undefined}>{STATUS[job.status]}</span>
        </span>
        <span className="absolute top-3 right-3 rounded-full bg-night/70 px-2 py-0.5 text-[11px] font-medium text-white tabular-nums">#{job.id}</span>
      </div>
      <div className="flex flex-1 flex-col gap-1 px-4 pt-3.5 pb-4">
        <p className="line-clamp-2 text-[15.5px] leading-snug font-semibold">{job.title ?? "Reading the spec…"}</p>
        {host && <p className="text-[13px] text-ink-2">{host}</p>}
        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          {job.runId ? (
            <span className="inline-flex items-center gap-1.5 text-[20px] leading-none font-bold tracking-[-0.02em] tabular-nums">
              {(job.rows ?? 0).toLocaleString("en-US")}
              {job.expected != null && <span className="text-[13px] font-medium text-ink-3">/ {job.expected.toLocaleString("en-US")}</span>}
              {job.status === "done" && <TickMark tick={short ? "missing" : "footed"} />}
            </span>
          ) : (
            <span className="text-[13px] text-ink-3">No run yet</span>
          )}
          <span className="text-right text-[12.5px] text-ink-2">{meta.join(" · ")}</span>
        </div>
      </div>
    </Link>
  );
}
