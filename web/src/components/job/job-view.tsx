"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Footer, Mark, TopBar } from "@/components/shell";
import { TickMark } from "@/components/tick";
import { cn } from "@/lib/utils";
import { useAlerts } from "@/lib/alerts";
import { ArrowRight, Bell, BellOff, CircleAlert, Hand, Pause, Play } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import { SHORT, defaultTab, n, stepStates, type Report, type Tab } from "@/lib/steps";
import type { Job, JobEvent } from "@/lib/types";
import { SpecPanel } from "./spec-panel";
import { SitePanel } from "./site-panel";
import { CodePanel } from "./code-panel";
import { SamplesPanel } from "./samples-panel";
import { RunPanel } from "./run-panel";
import { FootedPanel } from "./footed-panel";

// A step's own control, in its card's corner, with a tooltip saying what it does: pause
// after the step under way (spec, site), resume the step a job paused before, and go
// back to a plan paused with "Not now". The run's own pause is in the Apify strip.
type Control = { icon: "pause" | "play"; label: string; tip: string; pending?: boolean; run: () => Promise<void> };

const post = async (url: string, body?: object) => {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't do that. Try again.");
};

function controlFor(job: Job, s: { tab: Tab; state: string }): Control | null {
  const reload = () => window.location.reload();
  if ((s.tab === "spec" || s.tab === "site") && s.state === "now" && job.status === "running") {
    return job.holdRequested
      ? { icon: "pause", pending: true, label: "Pausing after this step. Click to keep going", tip: "Pausing after this step: it finishes and saves, then the job waits. Click to keep going instead.", run: () => post(`/api/jobs/${job.id}/hold`, { on: false }) }
      : { icon: "pause", label: "Pause after this step", tip: "Pause after this step. It finishes and saves everything, then the job waits before the next step until you resume.", run: () => post(`/api/jobs/${job.id}/hold`, { on: true }) };
  }
  if (job.status === "held" && s.tab === (job.heldBefore === "site" ? "site" : "code")) {
    return { icon: "play", label: "Resume from this step", tip: "Resume. This step starts from what was saved; nothing before it is redone.", run: () => post(`/api/jobs/${job.id}/continue`).then(reload) };
  }
  if (s.tab === "run" && job.status === "cancelled") {
    return { icon: "play", label: "Back to the plan", tip: "Back to the plan. The extraction is written and tested; the time and cost are worked out fresh, then you press Go.", run: () => post(`/api/jobs/${job.id}/reopen`).then(reload) };
  }
  return null;
}

function StepControl({ control }: { control: Control }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = control.icon === "pause" ? Pause : Play;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={control.label}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await control.run();
            } catch (err) {
              setError((err as Error).message);
            }
            setBusy(false);
          }}
          className={cn(
            "absolute right-2.5 bottom-2.5 z-10 grid size-7 place-items-center rounded-full border transition-[transform,background-color,border-color] hover:scale-105 active:scale-95 disabled:opacity-60",
            control.icon === "play" ? "border-ink bg-ink text-sheet" : control.pending ? "border-source/50 bg-[#f1eeff] text-source" : "border-border bg-white text-ink hover:border-ink-3"
          )}
        >
          {control.pending && <span aria-hidden className="absolute inset-0 animate-ping rounded-full border border-source/40" />}
          <Icon aria-hidden className={cn("size-3.5", control.icon === "play" && "translate-x-px fill-current")} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="max-w-[260px] px-3 py-2 text-[12.5px] leading-snug">
        {error ?? control.tip}
      </TooltipContent>
    </Tooltip>
  );
}

// A job paused between steps: what's saved, and where to resume (the step's own ▶).
function HeldBanner({ job }: { job: Job }) {
  const next = job.heldBefore === "site" ? "investigating the site" : "writing the extraction";
  const saved = job.heldBefore === "site" ? "Your spec is saved." : "Your spec, the investigation and Muse Wonder's strategy are saved.";
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-xl border border-source/30 bg-[#f4f2ff] px-5 py-3">
      <Pause aria-hidden className="size-4 text-source" />
      <p className="text-[14px]">
        <span className="font-semibold">Paused before {next}.</span> <span className="text-ink-2">{saved} Press ▶ on the step to resume.</span>
      </p>
    </section>
  );
}

// What the job needs from you, or what went wrong, said under its title at any step, with
// a button to the step that explains it. Pauses you chose have their own banner.
function JobNotice({ job, events, steps, onOpen }: { job: Job; events: JobEvent[]; steps: ReturnType<typeof stepStates>; onOpen: (tab: Tab) => void }) {
  const plan = [...events].reverse().find((e) => e.kind === "plan");
  const stopped = steps.find((s) => s.state === "stopped");
  const expected = job.expected ?? null;
  const notice =
    job.status === "waiting"
      ? {
          tone: "go" as const,
          title: "Ready to run: your Go starts it on Apify",
          lines: (plan?.needsYou as string[] | undefined) ?? [],
          action: "Review the plan",
          tab: "run" as Tab,
        }
      : ["failed", "declined"].includes(job.status) || (job.status === "stopped" && !job.paused)
        ? {
            tone: "stop" as const,
            title: job.status === "declined" ? "Dapi can't extract this source" : `Stopped${stopped ? ` at ${stopped.label.toLowerCase()}` : ""}`,
            lines: [job.declined ?? job.failed ?? ""].filter(Boolean),
            action: "See why",
            tab: (stopped?.tab ?? "run") as Tab,
          }
        : job.status === "done" && expected !== null && (job.rows ?? 0) < expected
          ? {
              tone: "stop" as const,
              title: `${n(expected - (job.rows ?? 0))} rows missing`,
              lines: ["Each one is named, with the reason, on the Count step."],
              action: "See which",
              tab: "footed" as Tab,
            }
          : null;
  if (!notice) return null;
  const go = notice.tone === "go";
  return (
    <section role="status" className={cn("flex flex-wrap items-start gap-3 rounded-xl border px-5 py-3", go ? "border-deliver/40 bg-[#e6f7f5]" : "border-pencil-red/40 bg-red-wash")}>
      {go ? <Hand aria-hidden className="mt-0.5 size-4 shrink-0 text-[#0b6f65]" /> : <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-pencil-red" />}
      <div className="min-w-0 flex-1 text-[14px]">
        <p className={cn("font-semibold", go ? "text-ink" : "text-red-ink")}>{notice.title}</p>
        {notice.lines.length > 0 && (
          <ul className={cn("mt-0.5 flex flex-col gap-0.5", go ? "text-ink-2" : "text-red-ink/85")}>
            {notice.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
      </div>
      <Button variant="outline" onClick={() => onOpen(notice.tab)} className="h-8 shrink-0 gap-1.5 border-control bg-sheet px-3 text-[13px]">
        {notice.action} <ArrowRight aria-hidden className="size-3.5" />
      </Button>
    </section>
  );
}

export function JobView({
  initialJob,
  initialEvents,
  initialReport,
  readOnly,
  account,
}: {
  initialJob: Job;
  initialEvents: JobEvent[];
  initialReport: Report | null;
  readOnly: boolean;
  account?: ReactNode;
}) {
  const [job, setJob] = useState(initialJob);
  const alerts = useAlerts(job);
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
  const live = !["done", "failed", "declined", "cancelled", "stopped", "held"].includes(job.status);
  const host = job.sourceUrl ? new URL(job.sourceUrl).host : null;
  const expected = job.expected ?? null;

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar
        crumb={job.title ?? `Job ${job.id}`}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={alerts.toggle}
              aria-pressed={alerts.on}
              title={alerts.needsPermission ? "Allow desktop alerts: a notification when this job needs your Go or finishes, even in another tab" : alerts.on ? "Alerts on: a chime, the tab title and a notification when this job needs you or finishes" : "Alerts off"}
              aria-label={alerts.needsPermission ? "Allow desktop alerts" : alerts.on ? "Turn alerts off" : "Turn alerts on"}
              className="relative text-ink-2"
            >
              {alerts.on ? <Bell /> : <BellOff />}
              {alerts.needsPermission && <span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-full bg-deliver ring-2 ring-sheet" />}
            </Button>
            {/* Apify's console is the owner's: the public copy doesn't link into it. */}
            {job.runUrl && !readOnly && (
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
            {account}
          </>
        }
      />

      <main className="flex flex-1 flex-col gap-4 px-6 pt-5 pb-8 md:px-7">
        {/* The title takes the room it needs (wrapping, never pushing the count off its line);
            the count sits right, and only once there is a run to count. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
          <div className="min-w-0 flex-1">
            <div className="min-w-0">
              <h1 className="max-w-[900px] text-[28px] leading-tight font-bold tracking-[-0.03em] text-balance">{job.title ?? "Reading your spec…"}</h1>
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
          {job.runId && (
            <div className="shrink-0 sm:text-right" aria-live="polite">
              <p className="text-[38px] leading-none font-bold tracking-[-0.03em] whitespace-nowrap">
                {/* The final figure, invisible, holds the width while the ticker counts up. */}
                <span className="inline-grid">
                  <span aria-hidden className="invisible col-start-1 row-start-1">{n(job.rows ?? 0)}</span>
                  <NumberTicker value={job.rows ?? 0} className="col-start-1 row-start-1 text-right" />
                </span>
                {expected !== null && (
                  <>
                    <span className="text-ink-3"> / </span>
                    {n(expected)}
                  </>
                )}
              </p>
              <p className="mt-1.5 text-[13px] text-ink-2">
                {job.status === "done" ? "rows delivered, counted against the source" : live ? "rows so far" : job.paused && job.status === "stopped" ? "rows so far · paused" : "rows so far · stopped"}
              </p>
            </div>
          )}
        </div>

        {job.status === "held" && <HeldBanner job={job} />}
        <JobNotice job={job} events={events} steps={steps} onOpen={setPicked} />
        <TabsPrimitive.Root value={tab} onValueChange={(v) => setPicked(v as Tab)} className="flex flex-1 flex-col gap-4">
          {/* Each step carries the mark lit to its stage; the one under way has a quiet beam
              in that stage's colour, and the step's own control (pause, resume) in its corner. */}
          <TooltipProvider delayDuration={150}>
            <TabsPrimitive.List aria-label="Steps" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              {steps.map((s) => {
                const control = readOnly ? null : controlFor(job, s);
                return (
                  <div key={s.tab} className="relative">
                    <TabsPrimitive.Trigger
                      value={s.tab}
                      className={cn(
                        "group relative h-full w-full overflow-hidden rounded-xl border bg-sheet px-3.5 pt-3 pb-3.5 text-left outline-none transition-[background-color,box-shadow,border-color] hover:border-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                        "data-[state=active]:border-ink data-[state=active]:bg-white data-[state=active]:shadow-[0_8px_24px_-12px_rgb(15_26_36/0.3)]",
                        s.state === "todo" && "bg-transparent",
                        s.state === "stopped" && "border-pencil-red/50",
                        s.state === "now" && job.status === "waiting" && "border-deliver ring-3 ring-deliver/20",
                        // The run is Apify's: its colours, blended, while it runs.
                        s.tab === "run" && s.state === "now" && job.status === "running" && "bg-[linear-gradient(115deg,rgb(36_109_255/0.12),rgb(32_163_78/0.08)_50%,rgb(248_102_6/0.10))]"
                      )}
                    >
                      {s.state === "now" && job.status === "running" && (
                        <BorderBeam size={60} duration={6} borderWidth={1.5} colorFrom={s.tab === "run" ? "#246DFF" : BEAM[STEP_STAGE[s.tab]][0]} colorTo={s.tab === "run" ? "#20A34E" : BEAM[STEP_STAGE[s.tab]][1]} />
                      )}
                      <span className="flex items-center gap-2">
                        <Mark className="size-5 shrink-0" lit={s.state === "todo" ? 0 : STEP_STAGE[s.tab]} now={s.state === "now" && job.status === "running" ? STEP_STAGE[s.tab] : undefined} />
                        <span className={cn("truncate text-[13.5px] font-semibold", s.state === "todo" ? "text-ink-3" : s.state === "stopped" ? "text-pencil-red" : "text-ink")}>
                          <span className="sm:hidden">{SHORT[s.tab]}</span>
                          <span className="hidden sm:inline">{s.label}</span>
                        </span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {s.tab === "run" && <img src="/brand/apify-logomark.svg" alt="on Apify" className={cn("ml-auto size-3.5", s.state === "todo" && "opacity-40 grayscale")} />}
                        {s.tick && <TickMark tick={s.tick} className={s.tab === "run" ? undefined : "ml-auto"} />}
                      </span>
                      <span className={cn("mt-1 block truncate pl-7 text-[12px] text-ink-2", control && "pr-8")}>{s.line}</span>
                    </TabsPrimitive.Trigger>
                    {control && <StepControl control={control} />}
                  </div>
                );
              })}
            </TabsPrimitive.List>
          </TooltipProvider>

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
            <FootedPanel job={job} events={events} report={report} readOnly={readOnly} />
          </TabsPrimitive.Content>
        </TabsPrimitive.Root>
      </main>
      <Footer readOnly={readOnly} fluid />
    </div>
  );
}
