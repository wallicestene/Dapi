"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { n } from "@/lib/steps";
import type { Job, JobEvent } from "@/lib/types";
import { DataSheet, type Selection } from "./data-sheet";
import { ReceiptPanel } from "./receipt-panel";

export function RunPanel({ job, events, readOnly }: { job: Job; events: JobEvent[]; readOnly: boolean }) {
  const [selected, setSelected] = useState<Selection | null>(null);
  const plan = [...events].reverse().find((e) => e.kind === "plan");

  if (!job.runId) {
    if (job.status === "waiting" && plan) return <PlanCard job={job} plan={plan} readOnly={readOnly} />;
    return (
      <section className="rounded-lg border bg-sheet px-5 py-4 text-[14px] text-ink-2">
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
  const notes = events
    .filter((e) => e.step === "run" && ["watch", "repairing", "restarting", "broken", "translating", "translated", "apify", "following", "stopped", "apify-finished"].includes(e.kind))
    .slice(-4);
  return (
    <div className="grid flex-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      {(notes.length > 0 || (job.status === "stopped" && !readOnly)) && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-sheet px-5 py-2 lg:col-span-2">
          <ul className="text-[13px]" aria-label="During the run">
            {notes.map((e) => (
              <li key={e.n} className={e.kind === "broken" || e.kind === "repairing" || e.kind === "stopped" ? "py-1 text-pencil-red" : "py-1 text-ink-2"}>
                {e.text}
              </li>
            ))}
          </ul>
          {job.status === "stopped" && !readOnly && <ResurrectButton job={job} />}
        </div>
      )}
      <DataSheet job={job} selected={selected} onSelect={setSelected} />
      <ReceiptPanel job={job} events={events} selected={selected} translatedFrom={(plan?.translate as { from: string } | null)?.from ?? null} />
    </div>
  );
}

// A stopped run carries on where it stopped: same dataset, saved state and queue.
function ResurrectButton({ job }: { job: Job }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2 py-1">
      {error && <span className="text-[13px] text-pencil-red">{error}</span>}
      <Button
        disabled={busy}
        className="h-8"
        onClick={async () => {
          setBusy(true);
          const res = await fetch(`/api/jobs/${job.id}/resurrect`, { method: "POST" });
          if (res.ok) window.location.reload();
          else {
            setError((await res.json().catch(() => ({}))).error ?? "Couldn't resurrect the run.");
            setBusy(false);
          }
        }}
      >
        {busy ? "Resurrecting…" : "Resurrect the run"}
      </Button>
    </div>
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
    ["Records the source lists", n(plan.records as number)],
    ["Requests", `about ${n(plan.requests as number)}`],
    ["Time on Apify", `roughly ${plan.minutes} min`],
    ["How it's fetched", plan.proxy === "direct" ? "directly, no proxy" : `Apify ${plan.proxy} proxy`],
  ];
  const reasoning = typeof plan.reasoning === "string" ? plan.reasoning.trim() : "";
  const translate = plan.translate as { from: string; to: string; columns: string[] } | null;
  const disputes = (plan.disputes as { column: string; sample: string; site: string }[] | undefined) ?? [];
  return (
    <section className="max-w-[760px] rounded-lg border bg-sheet">
      <div className="px-5 pt-4 pb-3">
        <h2 className="text-[16px] font-semibold">The plan</h2>
        <p className="mt-1 text-[14px] text-ink-2">{plan.text}</p>
      </div>
      <dl className="grid grid-cols-2 border-y border-rule sm:grid-cols-4">
        {facts.map(([k, v]) => (
          <div key={k} className="border-r border-rule px-5 py-3 last:border-r-0">
            <dt className="text-[12px] text-ink-2">{k}</dt>
            <dd className="mt-0.5 text-[18px] font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {translate && (
        <p className="mx-5 mt-4 text-[14px]">
          Your samples are in {translate.to}; the site is in {translate.from}. Dapi extracts the site as it is, then Muse Spark translates {translate.columns.join(", ")} into {translate.to}, following your samples&apos; wording. Every receipt keeps the site&apos;s own words.
        </p>
      )}
      {disputes.length > 0 && (
        <div className="mx-5 mt-4 rounded-md border border-pencil-red/30 bg-red-wash px-4 py-3 text-[14px] text-red-ink">
          <p className="font-medium">Where the site disagrees with your sample</p>
          <ul className="mt-1 space-y-1 [overflow-wrap:anywhere]">
            {disputes.map((d) => (
              <li key={d.column}>
                {d.column}: your sample has <q>{d.sample}</q>; the site shows <q>{d.site}</q>. Dapi delivers what the site shows.
              </li>
            ))}
          </ul>
        </div>
      )}
      {reasoning && (
        <details className="mx-5 mt-4 rounded-md border border-rule bg-white px-4 py-2.5 text-[14px]">
          <summary className="cursor-pointer font-medium">Why this way in and this pace</summary>
          <p className="mt-2 leading-relaxed whitespace-pre-line text-ink-2">{reasoning}</p>
        </details>
      )}
      {(plan.personalData as { column: string }[] | undefined)?.length ? (
        <p className="mx-5 mt-4 text-[14px] text-ink-2">
          {(plan.personalData as { column: string }[]).map((p) => p.column).join(", ")} name or contact people. They&apos;re collected as the site shows them to any visitor, nothing more.
        </p>
      ) : null}
      {robotsQuestion && (
        <div className="mx-5 mt-4 rounded-md border border-pencil-red/30 bg-red-wash px-4 py-3 text-[14px] text-red-ink">
          {robotsQuestion} Dapi follows robots.txt unless you say otherwise; if you do, every request it skips today is fetched and marked in its receipt.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 px-5 py-4">
        {readOnly ? (
          <p className="text-[13px] text-ink-2">This copy is for exploring finished jobs; runs start from a local copy of Dapi.</p>
        ) : (
          <>
            <Button disabled={busy} onClick={() => answer(true)} className="h-9 px-4">
              {robotsQuestion ? "Run, following robots.txt" : "Run on Apify"}
            </Button>
            {robotsQuestion && (
              <Button variant="outline" disabled={busy} onClick={() => answer(true, true)} className="h-9 border-control bg-sheet px-4">
                Run, and fetch what robots.txt disallows
              </Button>
            )}
            <Button variant="ghost" disabled={busy} onClick={() => answer(false)} className="h-9 px-3 text-ink-2">
              Stop here
            </Button>
          </>
        )}
        {error && <p className="text-[13px] text-pencil-red">{error}</p>}
      </div>
    </section>
  );
}
