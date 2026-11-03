"use client";

import { useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BorderBeam } from "@/components/ui/border-beam";
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
              ? "You stopped this job before it ran."
              : "The run starts once the extraction passes its checks and you say Go."}
      </section>
    );
  }

  // What the watch saw during the run: easing off, a break and its repair, translation.
  // Once a run carries on again, its pause or stop is history.
  const carriedOn = job.status === "running";
  const notes = events
    .filter((e) => e.step === "run" && ["watch", "repairing", "restarting", "broken", "translating", "translated", "apify", "following", "stopped", "paused"].includes(e.kind))
    .filter((e) => !(carriedOn && (e.kind === "paused" || e.kind === "stopped")))
    .slice(-4);
  // Apify's own account of the run, as figures.
  const finished = [...events].reverse().find((e) => e.kind === "apify-finished");
  return (
    <div className="grid flex-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <ApifyStrip job={job} finished={finished} readOnly={readOnly} />
      {notes.length > 0 && (
        <div className="rounded-xl border bg-sheet px-5 py-2 lg:col-span-2">
          <ul className="text-[13px]" aria-label="During the run">
            {notes.map((e) => (
              <li key={e.n} className={e.kind === "broken" || e.kind === "repairing" || e.kind === "stopped" ? "py-1 text-pencil-red" : "py-1 text-ink-2"}>
                {e.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      <DataSheet job={job} selected={selected} onSelect={setSelected} />
      <ReceiptPanel job={job} events={events} selected={selected} translatedFrom={(plan?.translate as { from: string } | null)?.from ?? null} />
    </div>
  );
}

// The run on Apify, credited: Apify's mark and name, the run's state and figures, and
// the one control that fits it (Pause while it runs, Resume when it stopped). Pause stops
// the run gracefully; Resume resurrects it on Apify with its dataset, queue and state.
const APIFY_BLEND = "bg-[linear-gradient(115deg,rgb(36_109_255/0.12),rgb(32_163_78/0.08)_50%,rgb(248_102_6/0.10))]";

function ApifyStrip({ job, finished, readOnly }: { job: Job; finished?: JobEvent; readOnly: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = job.status === "running" && job.step === "run";
  const stopped = job.status === "stopped";
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
  const seconds = finished?.seconds as number | null | undefined;
  const facts = running
    ? ([["Rows so far", n(job.rows ?? 0)]] as [string, string][])
    : finished
    ? ([
        seconds != null && ["Time", seconds < 90 ? `${Math.round(seconds)} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`],
        finished.computeUnits != null && ["Compute units", (finished.computeUnits as number).toFixed(2)],
        finished.usd != null && ["Cost", `$${(finished.usd as number).toFixed(2)}`],
        finished.migrations ? ["Moved servers", `${finished.migrations}×`] : null,
        finished.resurrects ? ["Resurrected", `${finished.resurrects}×`] : null,
      ].filter(Boolean) as [string, string][])
    : [];
  const ok = finished?.status === "SUCCEEDED";
  const label = running ? "Running on Apify" : stopped ? (job.paused ? "Paused on Apify" : "Run stopped on Apify") : finished ? `Apify run ${String(finished.status).toLowerCase().replace("-", " ")}` : "On Apify";
  return (
    <div className={cn("relative flex flex-wrap items-center gap-x-6 gap-y-2 overflow-hidden rounded-xl border px-5 py-3 lg:col-span-2", running || stopped ? APIFY_BLEND : "bg-sheet")}>
      {running && <BorderBeam size={120} duration={6} borderWidth={1.5} colorFrom="#246DFF" colorTo="#20A34E" />}
      <span className="inline-flex items-center gap-2.5 text-[13.5px] font-semibold">
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
      {facts.map(([k, v]) => (
        <span key={k} className="text-[13px] text-ink-2">
          {k} <b className="font-semibold text-ink tabular-nums">{v}</b>
        </span>
      ))}
      {!readOnly && (running || stopped) && (
        <span className="ml-auto flex items-center gap-2">
          {error && <span className="text-[13px] text-pencil-red">{error}</span>}
          {running ? (
            <Button variant="outline" disabled={busy} onClick={() => act("pause")} className="h-8 gap-1.5 px-3">
              <Pause aria-hidden className="size-3.5" /> {busy ? "Pausing…" : "Pause"}
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => act("resurrect")} className="h-8 gap-1.5 px-3">
              <Play aria-hidden className="size-3.5 fill-current" /> {busy ? "Resuming…" : job.paused ? "Resume" : "Resurrect the run"}
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
    ["Way in", plan.proxy === "direct" ? "Direct" : `${String(plan.proxy).replace(/^\w/, (c) => c.toUpperCase())} proxy`],
  ];
  // Muse Spark's lines for the client; older jobs carry its notes as one paragraph.
  const reasoning = Array.isArray(plan.reasoning) ? (plan.reasoning as string[]) : typeof plan.reasoning === "string" && plan.reasoning.trim() ? [plan.reasoning.trim()] : [];
  const translate = plan.translate as { from: string; to: string; columns: string[] } | null;
  const disputes = (plan.disputes as { label?: string; column: string | null; sample: string; site: string }[] | undefined) ?? [];
  const unsettled = (plan.unsettled as string[] | undefined) ?? [];
  return (
    // The one moment Dapi hands over: a beam runs round the plan until you answer.
    <section className="relative overflow-hidden rounded-2xl border bg-white shadow-[0_12px_32px_-18px_rgb(15_26_36/0.35)]">
      {!readOnly && !busy && <BorderBeam size={120} duration={7} borderWidth={1.5} colorFrom="var(--deliver)" colorTo="var(--verified)" />}
      <div className="flex items-start gap-4 px-6 pt-5 pb-4">
        <Mark className="mt-0.5 size-10 shrink-0" lit={2} />
        <div>
          <h2 className="text-[22px] leading-tight font-bold tracking-[-0.02em]">Ready to run</h2>
          <p className="mt-1 text-[14.5px] leading-relaxed text-ink-2">{plan.text}</p>
        </div>
      </div>
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
          <p className="font-semibold">Why this way in and this pace</p>
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
            <Button variant="ghost" disabled={busy} onClick={() => answer(false)} className="h-11 px-3 text-ink-2">
              Stop here
            </Button>
            <p className="text-[13px] text-ink-2 sm:ml-auto">Rows stream into your Apify dataset as they&apos;re found.</p>
          </>
        )}
        {error && <p className="text-[13px] text-pencil-red">{error}</p>}
      </div>
    </section>
  );
}
