import Link from "next/link";
import { ArrowRight, CheckCircle2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Footer, Mark, TopBar } from "@/components/shell";
import { JobArt } from "@/components/job-art";
import { GLASS } from "@/lib/glass";
import { READ_ONLY, listJobs } from "@/lib/server/dapi";
import { canSee } from "@/lib/server/access";
import { PUBLIC, currentUser } from "@/lib/server/session";
import { Account } from "@/components/account";
import { dataShape } from "@/lib/server/shape";
import { STAGE_TEXT, cost, pausedByYou, stageOf, stoppedItself, took } from "@/lib/stage";
import { cn } from "@/lib/utils";
import type { Job } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Jobs · Dapi" };

// One word per state, the same on every screen (DESIGN.md, Voice).
const STATUS: Record<Job["status"], string> = {
  running: "Running",
  waiting: "Ready to run",
  held: "Paused",
  done: "Delivered",
  failed: "Stopped",
  declined: "Declined",
  cancelled: "Paused at the plan",
  stopped: "Stopped",
};
const statusOf = (j: Job) => (j.status === "stopped" && j.paused ? "Paused on Apify" : STATUS[j.status]);

// The client's own pauses and the pipeline stopping itself are kept apart: a pause always
// carries on from where it stopped; a stop is shown in red.
const FILTERS = [
  { key: "all", label: "All", has: () => true },
  { key: "delivered", label: "Delivered", has: (j: Job) => j.status === "done" },
  { key: "active", label: "In progress", has: (j: Job) => j.status === "running" || j.status === "waiting" },
  { key: "paused", label: "Paused", has: (j: Job) => pausedByYou(j) },
  { key: "stopped", label: "Stopped", has: (j: Job) => stoppedItself(j) },
];

export default async function Jobs({ searchParams }: PageProps<"/jobs">) {
  const { show } = await searchParams;
  // On the public demo: the featured jobs and the visitor's own, nobody else's.
  const user = PUBLIC ? await currentUser() : null;
  const jobs = listJobs().filter((j) => canSee(j, user));
  const filter = FILTERS.find((f) => f.key === show) ?? FILTERS[0];
  const shown = jobs.filter(filter.has);
  // On "All", the work in progress and what was delivered come first; stopped attempts
  // sit in their own section below.
  const groups =
    filter.key === "all"
      ? [
          { title: null, jobs: shown.filter((j) => !pausedByYou(j) && !stoppedItself(j)) },
          { title: "Paused", jobs: shown.filter(pausedByYou) },
          { title: "Stopped", jobs: shown.filter(stoppedItself), compact: true },
        ]
      : [{ title: null, jobs: shown, compact: filter.key === "stopped" }];
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar actions={<Account next="/jobs" />} />
      <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-5 pt-8 pb-14 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[32px] leading-tight font-bold tracking-[-0.03em]">Jobs</h1>
            <p className="mt-1 text-[15px] text-ink-2">{PUBLIC ? "Example jobs anyone can open, and the jobs you've run." : "Every job turns a spec into a dataset you can prove."}</p>
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
                {/* Stopped attempts are a short list, not cards: they're for looking up, not for show. */}
                {"compact" in g && g.compact ? (
                  <ul className="divide-y divide-rule overflow-hidden rounded-xl border bg-sheet">
                    {g.jobs.map((job) => (
                      <li key={job.id}>
                        <JobRow job={job} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {g.jobs.map((job) => (
                      <li key={job.id}>
                        <JobCard job={job} />
                      </li>
                    ))}
                  </ul>
                )}
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
      <Footer readOnly={READ_ONLY} />
    </div>
  );
}

// A stopped job, on one line: what it was, where, why it stopped, when.
function JobRow({ job }: { job: Job }) {
  const host = job.sourceUrl ? new URL(job.sourceUrl).host.replace(/^www\./, "") : null;
  return (
    <Link href={`/jobs/${job.id}`} className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-0.5 px-5 py-3 hover:bg-raised sm:grid-cols-[minmax(0,1fr)_160px_120px_72px_16px]">
      <span className="min-w-0">
        <span className="block truncate text-[14.5px] font-medium">{job.title ?? `Job ${job.id}`}</span>
        {host && <span className="block truncate text-[13px] text-ink-2 sm:hidden">{host}</span>}
      </span>
      <span className="hidden truncate text-[13px] text-ink-2 sm:block">{host}</span>
      <span className="text-[13px] font-medium text-pencil-red">{statusOf(job)}</span>
      <span className="hidden text-right text-[13px] text-ink-2 tabular-nums sm:block">{new Date(job.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
      <ArrowRight aria-hidden className="hidden size-4 text-ink-3 transition-transform group-hover:translate-x-0.5 sm:block" />
    </Link>
  );
}

function JobCard({ job }: { job: Job }) {
  const host = job.sourceUrl ? new URL(job.sourceUrl).host.replace(/^www\./, "") : null;
  const stage = stageOf(job);
  const live = job.status === "running";
  const bad = stoppedItself(job);
  const short = job.status === "done" && job.expected != null && (job.rows ?? 0) < job.expected;
  const meta = [took(job.apify?.seconds), cost(job.apify?.usd), new Date(job.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })].filter(Boolean);
  return (
    <Link href={`/jobs/${job.id}`} className="group relative block h-[268px] overflow-hidden rounded-2xl bg-night shadow-[0_10px_30px_-16px_rgb(15_26_36/0.5)] transition-transform duration-300 hover:-translate-y-1">
      <JobArt shape={dataShape(job.id)} muted={bad} className="absolute inset-0" />
      <span className="absolute top-3.5 left-3.5 inline-flex items-center gap-1.5 rounded-full bg-sheet/95 py-1 pr-2.5 pl-1.5 text-[12px] font-medium text-ink shadow-sm">
        <Mark className="size-4" lit={stage} now={live ? stage : undefined} label={STAGE_TEXT[stage - 1]} />
        <span className={bad ? "text-pencil-red" : undefined}>{statusOf(job)}</span>
      </span>
      <div className={cn(GLASS, "absolute inset-x-3 bottom-3 px-4 pt-3.5 pb-4")}>
        <p className="line-clamp-2 text-[15.5px] leading-snug font-semibold">{job.title ?? "Reading the spec…"}</p>
        {host && <p className="mt-0.5 text-[13px] text-white/70">{host}</p>}
        <div className="mt-3.5 flex items-end justify-between gap-3">
          {job.runId ? (
            <span className="inline-flex items-center gap-1.5 text-[21px] leading-none font-bold tracking-[-0.02em] tabular-nums">
              {(job.rows ?? 0).toLocaleString("en-US")}
              {job.expected != null && <span className="text-[13px] font-medium text-white/60">/ {job.expected.toLocaleString("en-US")}</span>}
              {job.status === "done" && (short ? <span className="text-[12px] font-semibold text-[#ffb4a3]">{(job.expected! - (job.rows ?? 0)).toLocaleString("en-US")} missing</span> : <CheckCircle2 aria-label="Every row the source lists" className="size-4 text-verified" />)}
            </span>
          ) : (
            <span className="text-[13px] text-white/60">No run yet</span>
          )}
          <span className="text-right text-[12.5px] text-white/75">{meta.join(" · ")}</span>
        </div>
      </div>
    </Link>
  );
}
