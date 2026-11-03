"use client";

import { useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Mark } from "@/components/shell";
import { n } from "@/lib/steps";
import { cn } from "@/lib/utils";
import { ROUTE_WORD } from "@/lib/stage";
import type { Job, JobEvent } from "@/lib/types";
import { DataSheet, type Selection } from "./data-sheet";
import { ReceiptPanel } from "./receipt-panel";

export function RunPanel({ job, events, readOnly }: { job: Job; events: JobEvent[]; readOnly: boolean }) {
  const [selected, setSelected] = useState<Selection | null>(null);
  const plan = [...events].reverse().find((e) => e.kind === "plan");

  if (!job.runId) {
    if (job.status === "waiting" && plan)
      return (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <PlanCard job={job} plan={plan} readOnly={readOnly} />
          <WhatYouGet job={job} events={events} />
        </div>
      );
    return (
      <section className="rounded-xl border bg-sheet px-5 py-4 text-[14px] text-ink-2">
        {job.status === "declined"
          ? "Nothing was run: the site step says why."
          : job.status === "failed"
            ? "Nothing was run: the step marked in red says what went wrong."
            : job.status === "cancelled"
              ? "Paused at the plan. The extraction is ready; press ▶ on the Run step to see the plan again."
              : "The run starts once the extraction passes its checks and you say Go."}
      </section>
    );
  }

  // What the watch saw during the run: easing off, a break and its repair, translation.
  // What happened during the run that you'd want to know: the site struggling and the
  // run easing off, a repair, Apify moving the run, translation. Pauses, resumes and
  // stops are the strip's to show.
  // Only the current run's: once a later run starts (or is followed again), earlier
  // attempts' crashes and repairs are history, not news (FDA, Nov 3: a run that
  // succeeded still showed the two crashes before it).
  let current = 0;
  events.forEach((e, i) => {
    if (e.step === "run" && (e.kind === "started" || e.kind === "following")) current = i;
  });
  const notes = events.slice(current).filter((e) => e.step === "run" && ["watch", "repairing", "restarting", "broken", "translating", "translated", "apify"].includes(e.kind)).slice(-4);
  // Whether this run started on its own (nothing in the plan needed the client).
  const autoStarted = [...events].reverse().find((e) => e.kind === "plan" || e.kind === "auto-go")?.kind === "auto-go";
  // Apify's own account of the run, as figures.
  const finished = [...events].reverse().find((e) => e.kind === "apify-finished");
  return (
    // content-start: the rows stack from the top; a short sheet never stretches the
    // strip's row and pushes the sheet down the page.
    <div className="grid flex-1 content-start items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <ApifyStrip job={job} finished={finished} readOnly={readOnly} />
      {(notes.length > 0 || autoStarted) && (
        <div className="rounded-xl border bg-sheet px-5 py-2 lg:col-span-2">
          <ul className="text-[13px]" aria-label="During the run">
            {autoStarted && <li className="py-1 text-ink-2">The run started on its own: nothing in the plan needed you.</li>}
            {notes.map((e) => (
              <li key={e.n} className={e.kind === "broken" || e.kind === "repairing" || e.kind === "stopped" ? "py-1 text-pencil-red" : "py-1 text-ink-2"}>
                {e.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      <DataSheet job={job} selected={selected} onSelect={setSelected} />
      <ReceiptPanel job={job} events={events} selected={selected} translatedFrom={(plan?.translate as { from: string } | null)?.from ?? null} readOnly={readOnly} />
    </div>
  );
}

// The run on Apify, credited: Apify's mark, the run's state, its rows at this moment, and
// its own control (Pause run, Resume run). Pausing the run stops it inside the last
// working step; it is not the pipeline's pause between steps, which lives on the step
// cards. When the run is done: its rows, time and cost (the rest is on the Footed tab).
const APIFY_BLEND = "bg-[linear-gradient(115deg,rgb(36_109_255/0.12),rgb(32_163_78/0.08)_50%,rgb(248_102_6/0.10))]";

function ApifyStrip({ job, finished, readOnly }: { job: Job; finished?: JobEvent; readOnly: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = job.status === "running" && job.step === "run";
  const stopped = job.status === "stopped";
  const done = !running && !stopped && finished;
  const seconds = finished?.seconds as number | null | undefined;
  const ok = finished?.status === "SUCCEEDED";
  const label = running ? "Running on Apify" : stopped ? (job.paused ? "Paused on Apify" : "Run stopped on Apify") : finished ? `Apify run ${String(finished.status).toLowerCase().replace("-", " ")}` : "On Apify";
  const facts = [
    `${n(job.rows ?? 0)} rows`,
    done && seconds != null ? (seconds < 90 ? `${Math.round(seconds)} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`) : null,
    done && finished.usd != null ? `$${(finished.usd as number).toFixed(2)}` : null,
  ].filter(Boolean);
  const act = async (what: "pause" | "resurrect") => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/jobs/${job.id}/${what}`, { method: "POST" });
    if (res.ok) window.location.reload();
    else {
      setError((await res.json().catch(() => ({}))).error ?? "Couldn't reach Apify. Try again.");
      setBusy(false);
    }
  };
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-5 py-2.5 lg:col-span-2", running || stopped ? APIFY_BLEND : "bg-sheet")}>
      <span className="inline-flex items-center gap-2.5 text-[14px] font-semibold">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/apify-logomark.svg" alt="Apify" className="size-5" />
        <span className={cn(finished && !ok && !stopped && !running && "text-pencil-red")}>{label}</span>
        {running && (
          <span aria-hidden className="relative flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-[#20A34E]/60" />
            <span className="relative size-2 rounded-full bg-[#20A34E]" />
          </span>
        )}
      </span>
      <span className="text-[14px] text-ink-2 tabular-nums">{facts.join(" · ")}</span>
      {!readOnly && (running || stopped) && (
        <span className="ml-auto flex items-center gap-2">
          {error && <span className="text-[13px] text-pencil-red">{error}</span>}
          {running ? (
            <Button variant="outline" disabled={busy} onClick={() => act("pause")} className="h-8 gap-1.5 px-3" title="Stops the run on Apify cleanly; the dataset, queue and saved state are kept for Resume run.">
              <Pause aria-hidden className="size-3.5" /> {busy ? "Pausing…" : "Pause run"}
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => act("resurrect")} className="h-8 gap-1.5 px-3" title="Carries the run on where it stopped, on Apify: same dataset, queue and saved state.">
              <Play aria-hidden className="size-3.5 fill-current" /> {busy ? "Resuming…" : "Resume run"}
            </Button>
          )}
        </span>
      )}
    </div>
  );
}

// Beside the plan: what one row is, and each column with how Dapi reads it.
function WhatYouGet({ job, events }: { job: Job; events: JobEvent[] }) {
  const strategy = [...events].reverse().find((e) => e.kind === "strategy");
  const columns = (strategy?.columns as { column: string; route: string }[] | undefined) ?? [];
  if (!columns.length) return null;
  return (
    <aside className="overflow-hidden rounded-xl border bg-sheet">
      <div className="border-b px-5 py-3">
        <h2 className="text-[14px] font-semibold">What you&apos;ll get</h2>
        {job.rowUnit && <p className="mt-0.5 text-[13px] text-ink-2">One row per {job.rowUnit.replace(/^(one|a|an|each) /i, "")}, {columns.length} columns</p>}
      </div>
      <ul className="divide-y divide-rule text-[13.5px]">
        {columns.map((c) => (
          <li key={c.column} className="flex items-center justify-between gap-3 px-5 py-2">
            <span className="truncate">{c.column}</span>
            <span className={cn("shrink-0 text-[12px]", c.route === "none" ? "text-pencil-red" : "text-ink-3")}>{ROUTE_WORD[c.route] ?? c.route}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function PlanCard({ job, plan, readOnly }: { job: Job; plan: JobEvent; readOnly: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const robotsQuestion = plan.robotsQuestion as string | null;
  const answer = async (go: boolean, robotsOverride = false) => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/jobs/${job.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ go, robotsOverride }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Couldn't send that. Try again.");
      setBusy(false);
    }
  };
  const facts: [string, string][] = [
    [plan.more ? "Records on the first page" : "Records the source lists", plan.records == null ? "—" : n(plan.records as number)],
    ["Requests", `≈ ${n(plan.requests as number)}`],
    ["Time on Apify", `≈ ${plan.minutes} min`],
    ["Connection", plan.proxy === "direct" ? "Direct" : `${String(plan.proxy).replace(/^\w/, (c) => c.toUpperCase())} proxy`],
  ];
  // Muse Spark's lines for the client; older jobs carry its notes as one paragraph.
  const reasoning = Array.isArray(plan.reasoning) ? (plan.reasoning as string[]) : typeof plan.reasoning === "string" && plan.reasoning.trim() ? [plan.reasoning.trim()] : [];
  const translate = plan.translate as { from: string; to: string; columns: string[] } | null;
  const disputes = (plan.disputes as { label?: string; column: string | null; sample: string; site: string }[] | undefined) ?? [];
  const unsettled = (plan.unsettled as string[] | undefined) ?? [];
  const needsYou = (plan.needsYou as string[] | undefined) ?? [];
  return (
    // The one moment Dapi hands over: a beam runs round the plan until you answer.
    <section className="relative overflow-hidden rounded-2xl border bg-white shadow-[0_12px_32px_-18px_rgb(15_26_36/0.35)]">
      <div className="flex items-start gap-4 px-6 pt-5 pb-4">
        <Mark className="mt-0.5 size-10 shrink-0" lit={2} />
        <div>
          <h2 className="text-[22px] leading-tight font-bold tracking-[-0.02em]">Ready to run</h2>
          <p className="mt-1 text-[14.5px] leading-relaxed text-ink-2">{plan.text}</p>
        </div>
      </div>
      {/* Why this plan waited for you; small things Dapi handled itself aren't listed. */}
      {needsYou.length > 0 && (
        <div className="mx-6 mb-4 rounded-xl border border-deliver/40 bg-[#e6f7f5] px-4 py-3 text-[14px]">
          <p className="font-semibold">Dapi needs your Go because</p>
          <ul className="mt-1 flex flex-col gap-1 text-ink-2">
            {needsYou.map((r) => (
              <li key={r} className="flex gap-2">
                <span aria-hidden className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-deliver" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
      <dl className="mx-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
        {facts.map(([k, v]) => (
          <div key={k} className="bg-sheet px-4 py-3.5">
            <dt className="text-[12px] text-ink-2">{k}</dt>
            <dd className="mt-1 text-[24px] leading-none font-bold tracking-[-0.02em] tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {translate && (
        <p className="mx-6 mt-4 text-[14px]">
          Your samples are in {translate.to}; the site is in {translate.from}. Dapi extracts the site as it is, then Muse Spark translates {translate.columns.join(", ")} into {translate.to}, following your samples&apos; wording. Every receipt keeps the site&apos;s own words.
        </p>
      )}
      {unsettled.length > 0 && (
        <div className="mx-6 mt-4 rounded-xl border border-source/30 bg-[#f4f2ff] px-4 py-3 text-[14px]">
          <p className="font-semibold text-ink">Not settled yet</p>
          <ul className="mt-1 space-y-1 text-ink-2">
            {unsettled.map((g) => (
              <li key={g} className="flex gap-2">
                <span aria-hidden className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-source" />
                {g}
              </li>
            ))}
          </ul>
        </div>
      )}
      {disputes.length > 0 && (
        <div className="mx-6 mt-4 rounded-xl border border-pencil-red/30 bg-red-wash px-4 py-3 text-[14px] text-red-ink">
          <p className="font-medium">Where the site disagrees with your sample</p>
          <ul className="mt-1 space-y-1 [overflow-wrap:anywhere]">
            {disputes.map((d, i) => (
              <li key={i}>
                {d.label && <span className="text-ink-2">{d.label}, </span>}
                {d.column === null ? (
                  <>this record isn&apos;t on the site. Dapi asked for it directly and got nothing back.</>
                ) : (
                  <>
                    {d.column}: your sample has {d.sample ? <q>{d.sample}</q> : "it blank"}; the site shows {d.site ? <q>{d.site}</q> : "it blank"}. Dapi delivers what the site shows.
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {reasoning.length > 0 && (
        <div className="mx-6 mt-5 text-[14px]">
          <p className="font-semibold">How Dapi will run it</p>
          <ul className="mt-1.5 flex flex-col gap-1 text-ink-2">
            {reasoning.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-deliver" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(plan.personalData as { column: string }[] | undefined)?.length ? (
        <p className="mx-6 mt-4 text-[14px] text-ink-2">
          {(plan.personalData as { column: string }[]).map((p) => p.column).join(", ")} name or contact people. They&apos;re collected as the site shows them to any visitor, nothing more.
        </p>
      ) : null}
      {robotsQuestion && (
        <div className="mx-6 mt-4 rounded-xl border border-pencil-red/30 bg-red-wash px-4 py-3 text-[14px] text-red-ink">
          {robotsQuestion} Dapi follows robots.txt unless you say otherwise; if you do, every request it skips today is fetched and marked in its receipt.
        </div>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t bg-raised px-6 py-4">
        {readOnly ? (
          <p className="text-[13px] text-ink-2">This copy is for exploring finished jobs; runs start from a local copy of Dapi.</p>
        ) : (
          <>
            <Button disabled={busy} onClick={() => answer(true)} className="h-11 gap-2 px-5 text-[15px]">
              <Play aria-hidden className="size-4 fill-current" />
              {busy ? "Starting…" : robotsQuestion ? "Go, following robots.txt" : "Go: run on Apify"}
            </Button>
            {robotsQuestion && (
              <Button variant="outline" disabled={busy} onClick={() => answer(true, true)} className="h-9 border-control bg-sheet px-4">
                Run, and fetch what robots.txt disallows
              </Button>
            )}
            <Button variant="ghost" disabled={busy} onClick={() => answer(false)} className="h-11 px-3 text-ink-2" title="Pause here. The extraction is kept; ▶ on the Run step brings the plan back.">
              Not now
            </Button>
            <p className="text-[13px] text-ink-2 sm:ml-auto">Rows stream into your Apify dataset as they&apos;re found.</p>
          </>
        )}
        {error && <p className="text-[13px] text-pencil-red">{error}</p>}
      </div>
    </section>
  );
}
