"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTE_WORD } from "@/lib/stage";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { TickMark } from "@/components/tick";
import { cn } from "@/lib/utils";
import type { Job, JobEvent } from "@/lib/types";
import type { Report } from "@/lib/steps";
import { Panel, Waiting, clock } from "./panel";

// While the code step runs: which attempt Muse Spark is on (or that Dapi is testing it),
// for how long, and the columns it's writing code for, each with the route Muse Wonder's
// strategy chose. The shimmering lines only say work is under way.
const SKETCH = [62, 84, 40, 76, 58, 90, 34, 70, 52];

function Working({ events, attempts }: { events: JobEvent[]; attempts: JobEvent[] }) {
  const last = attempts.at(-1);
  const testing = last?.kind === "written";
  const attempt = attempts.filter((e) => e.kind === "written" || e.kind === "unwritten").length + (testing ? 0 : 1);
  const since = last?.at ?? events.find((e) => e.step === "code")?.at;
  const strategy = [...events].reverse().find((e) => e.kind === "strategy");
  const columns = ((strategy?.columns as { column: string; route: string }[] | undefined) ?? []).slice(0, 14);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = since ? Math.max(0, Math.round((now - Date.parse(since)) / 1000)) : 0;
  return (
    <section className="relative overflow-hidden rounded-xl border bg-sheet lg:col-span-2">
      <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
            <span className="rounded-full bg-deliver/15 px-2 py-0.5 text-[11.5px] font-semibold text-[#0b6f65]">Muse Spark</span>
            {testing ? `Testing attempt ${attempt} against your sample rows` : `Writing attempt ${attempt} of the extraction`}
            <span className="ml-auto text-[13px] font-medium text-ink-3 tabular-nums">{seconds} s</span>
          </p>
          <div aria-hidden className="flex flex-col gap-2 rounded-lg bg-night px-4 py-4">
            {SKETCH.map((w, i) => (
              <span key={i} className="flex gap-2" style={{ paddingLeft: `${(i % 3) * 14}px` }}>
                <span className="h-2 animate-pulse rounded-full bg-[#2b3a48]" style={{ width: `${w * 0.55}%`, animationDelay: `${i * 120}ms` }} />
                {i % 2 === 0 && <span className={cn("h-2 animate-pulse rounded-full", ["bg-source/70", "bg-deliver/70", "bg-verified/70"][i % 3])} style={{ width: `${18 + (i * 7) % 20}%`, animationDelay: `${i * 120 + 60}ms` }} />}
              </span>
            ))}
          </div>
        </div>
        {columns.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] font-medium text-ink-2">Code for {columns.length} columns, as the strategy reads them</p>
            <ul className="flex flex-wrap gap-1.5">
              {columns.map((c) => (
                <li key={c.column} className="inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 text-[12.5px]">
                  {c.column}
                  <span className="text-ink-3">{ROUTE_WORD[c.route] ?? c.route}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

// When every attempt was used: start again from the extraction, keeping the spec, the
// investigation and the strategy (the slow, expensive part); nothing before is redone.
function TryAgain({ job }: { job: Job }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="flex flex-wrap items-center gap-4 rounded-xl border border-pencil-red/30 bg-red-wash px-5 py-4 lg:col-span-2">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-red-ink">The extraction didn&apos;t pass its checks.</p>
        <p className="text-[13.5px] text-red-ink/80">Try again: Muse Spark writes it afresh. Your spec, the investigation and Muse Wonder&apos;s strategy are kept.</p>
      </div>
      {error && <p className="text-[13px] text-pencil-red">{error}</p>}
      <Button
        disabled={busy}
        className="h-10 gap-2 px-4"
        onClick={async () => {
          setBusy(true);
          const res = await fetch(`/api/jobs/${job.id}/retry`, { method: "POST" });
          if (res.ok) window.location.reload();
          else {
            setError((await res.json().catch(() => ({}))).error ?? "Couldn't start again. Try once more.");
            setBusy(false);
          }
        }}
      >
        <RotateCcw aria-hidden className="size-4" /> {busy ? "Starting…" : "Try the extraction again"}
      </Button>
    </section>
  );
}

export function CodePanel({ job, events }: { job: Job; events: JobEvent[] }) {
  const attempts = events.filter((e) => e.step === "code" && ["written", "unwritten", "tested", "restart"].includes(e.kind as string));
  const working = job.status === "running" && job.step === "code";
  const spent = job.status === "failed" && job.step === "code";
  if (!attempts.length && !working) return <Waiting>Muse Spark writes the extraction from your spec and what the investigation found, then Dapi tests it against your sample rows.</Waiting>;
  const written = [...attempts].reverse().find((e) => e.kind === "written");
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      {working && <Working events={events} attempts={attempts.filter((e) => e.kind !== "restart")} />}
      {spent && <TryAgain job={job} />}
      {attempts.length > 0 && (
      <Panel title="Attempts" action={<CodeSheet job={job} />}>
        <ol className="divide-y divide-rule">
          {attempts.map((e) => {
            const report = e.report as Report | null | undefined;
            return (
              e.kind === "restart" ? (
                <li key={e.n} className="flex items-center gap-3 bg-raised px-5 py-2 text-[13px] font-medium text-ink-2">
                  <RotateCcw aria-hidden className="size-3.5" /> {e.text}
                </li>
              ) : (
              <li key={e.n} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 px-5 py-3 text-[14px]">
                <span className="text-[12px] text-ink-3 tabular-nums">{clock(e.at)}</span>
                <div>
                  <p className="flex items-center gap-2">
                    {e.kind === "tested" && <TickMark tick={e.passed ? "traced" : "fail"} />}
                    {e.kind === "unwritten" && <TickMark tick="fail" />}
                    {e.text}
                  </p>
                  {e.kind === "tested" && report && (
                    <p className="mt-1 text-[13px] text-ink-2">
                      Test run: {report.rows} rows, {report.captures} responses kept as evidence
                      {report.completeness.map((c) => `, ${c.kind} ${c.got} of ${c.expected ?? "?"}`).join("")}.
                    </p>
                  )}
                  {e.kind === "tested" && !e.passed && (
                    <ul className="mt-1 list-disc pl-5 text-[13px] text-pencil-red">
                      {(e.problems as string[]).slice(0, 4).map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
              )
            );
          })}
        </ol>
      </Panel>
      )}
      {written?.notes ? (
        <Panel title="Muse Spark's notes">
          <p className="px-5 py-3 text-[14px] leading-relaxed whitespace-pre-line">{String(written.notes)}</p>
        </Panel>
      ) : null}
    </div>
  );
}

// You never need the code, but it's there to read.
function CodeSheet({ job }: { job: Job }) {
  const [code, setCode] = useState<string | null>(null);
  return (
    <Sheet onOpenChange={(open) => open && !code && fetch(`/api/jobs/${job.id}/files/site.js`).then((r) => r.text()).then(setCode)}>
      <SheetTrigger className="text-[13px] font-medium underline">Read the code</SheetTrigger>
      <SheetContent side="right" className="w-full bg-sheet sm:max-w-[720px]">
        <SheetHeader>
          <SheetTitle>The extraction</SheetTitle>
          <SheetDescription>Written by Muse Spark for this site; it runs inside Dapi&apos;s frame, which keeps the evidence and does the counting.</SheetDescription>
        </SheetHeader>
        <pre className="mx-4 mb-4 flex-1 overflow-auto rounded-md border bg-white p-3 font-mono text-[12px] leading-relaxed">{code ?? "Loading…"}</pre>
      </SheetContent>
    </Sheet>
  );
}
