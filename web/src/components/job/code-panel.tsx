"use client";

import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { TickMark } from "@/components/tick";
import type { Job, JobEvent } from "@/lib/types";
import type { Report } from "@/lib/steps";
import { Panel, Waiting, clock } from "./panel";

export function CodePanel({ job, events }: { job: Job; events: JobEvent[] }) {
  const attempts = events.filter((e) => e.step === "code" && ["written", "unwritten", "tested"].includes(e.kind as string));
  if (!attempts.length) return <Waiting>Muse Spark writes the extraction from your spec and what the investigation found, then Dapi tests it against your sample rows.</Waiting>;
  const written = [...attempts].reverse().find((e) => e.kind === "written");
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel title="Attempts" action={<CodeSheet job={job} />}>
        <ol className="divide-y divide-rule">
          {attempts.map((e) => {
            const report = e.report as Report | null | undefined;
            return (
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
            );
          })}
        </ol>
      </Panel>
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
