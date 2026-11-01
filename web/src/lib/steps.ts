// The six steps of a job as the screen shows them, each with its tick and one line of
// result, worked out from the job's summary and its events.

import type { Job, JobEvent, Tick } from "@/lib/types";

export type Tab = "spec" | "site" | "code" | "samples" | "run" | "footed";

export interface StepState {
  tab: Tab;
  label: string;
  line: string;
  tick: Tick | "footed" | null; // null: not reached yet, or under way
  state: "todo" | "now" | "done" | "stopped";
}

export interface SampleCheck {
  label: string;
  status: "pass" | "warn" | "fail" | "not found";
  row: number | null;
  checks: { column: string; expected: string; actual: string; status: "exact" | "warn" | "fail" }[];
}

export interface Report {
  rows: number;
  completeness: { kind: string; expected: number | null; got: number }[];
  failed: { what: string; error: string }[];
  partial: { what: string; row: string[] }[];
  sourceDuplicates: { row: Record<string, string>; times: number }[];
  captures: number;
  resumed: number;
  skipped: { url: string }[];
  robotsOverridden: number;
  samples: SampleCheck[];
}

const last = (events: JobEvent[], kind: string, step?: string) =>
  [...events].reverse().find((e) => e.kind === kind && (!step || e.step === step));

export const n = (x: number) => x.toLocaleString("en-US");

export function latestSamples(events: JobEvent[], report: Report | null): SampleCheck[] {
  if (report?.samples?.length) return report.samples;
  const tested = last(events, "tested");
  return ((tested?.report as Report | undefined)?.samples ?? []) as SampleCheck[];
}

export function stepStates(job: Job, events: JobEvent[], report: Report | null): StepState[] {
  const order: Tab[] = ["spec", "site", "code", "samples", "run", "footed"];
  const at = (t: Tab) => order.indexOf(t);
  const jobTab: Tab = job.step === "plan" ? "run" : job.step === "code" && last(events, "tested") ? "samples" : (job.step as Tab);
  const stoppedHere = ["failed", "declined", "cancelled", "stopped"].includes(job.status);
  const finished = job.status === "done";

  const state = (t: Tab): StepState["state"] => {
    if (finished || at(t) < at(jobTab)) return "done";
    if (at(t) === at(jobTab)) return stoppedHere ? "stopped" : "now";
    return "todo";
  };

  const read = last(events, "read");
  const source = last(events, "source");
  const declined = last(events, "declined");
  const written = last(events, "written");
  const tested = last(events, "tested");
  const samples = latestSamples(events, report);
  const exact = samples.filter((s) => s.status === "pass").length;
  const near = samples.filter((s) => s.status === "warn").length;
  const bad = samples.filter((s) => s.status === "fail" || s.status === "not found").length;
  const expected = job.expected ?? null;

  const steps: StepState[] = [
    {
      tab: "spec",
      label: state("spec") === "done" ? "Spec read" : "Reading the spec",
      line: read ? `${(read.columns as unknown[]).length} columns, ${(read.samples as unknown[]).length} samples` : "your columns and samples",
      tick: read ? "traced" : null,
      state: state("spec"),
    },
    {
      tab: "site",
      label: declined ? "Site refused" : state("site") === "done" ? "Site investigated" : "Investigating the site",
      line: declined ? "can't be extracted" : source ? (source.route === "embedded" ? "data embedded in the page" : "its own data feed") : "how it serves its data",
      tick: declined ? "missing" : source && state("site") === "done" ? "traced" : null,
      state: state("site"),
    },
    {
      tab: "code",
      label: state("code") === "done" ? "Extraction written" : "Writing the extraction",
      line: written ? `${written.lines} lines, attempt ${written.attempt}` : "by Muse Spark",
      tick: tested?.passed ? "traced" : job.status === "failed" && job.step === "code" ? "fail" : null,
      state: state("code"),
    },
    {
      tab: "samples",
      label: "Samples agreed",
      line: samples.length ? [`${exact} exact`, near && `${near} spacing`, bad && `${bad} differ`].filter(Boolean).join(", ") : "against your rows",
      tick: !samples.length ? null : bad ? "fail" : near ? "near" : "sample",
      state: state("samples"),
    },
    {
      tab: "run",
      label: job.status === "waiting" ? "Ready to run" : state("run") === "done" ? "Ran on Apify" : "Running on Apify",
      line:
        job.status === "waiting"
          ? "waiting for your Go"
          : job.runId
            ? `${n(job.rows ?? 0)} rows · ${n(job.failedRequests ?? 0)} failed requests`
            : "on your Apify account",
      tick: finished ? "traced" : job.status === "stopped" ? "missing" : null,
      state: state("run"),
    },
    {
      tab: "footed",
      label: "Footed",
      line: finished && expected !== null ? `${n(job.rows ?? 0)} of ${n(expected)}` : "after the last row",
      tick: finished ? ((job.rows ?? 0) >= (expected ?? 0) ? "footed" : "missing") : null,
      state: state("footed"),
    },
  ];
  return steps;
}

// The tab to show when nobody has picked one: the step under way, or the data once
// the job is done.
export function defaultTab(job: Job, events: JobEvent[]): Tab {
  if (job.status === "done" || job.status === "stopped") return "run";
  const now = stepStates(job, events, null).find((s) => s.state === "now" || s.state === "stopped");
  return now?.tab ?? "run";
}
