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
  checks: { column: string; expected: string; actual: string; status: "exact" | "warn" | "fail"; why?: "spacing" | "typo" | "column" | "site" | "dispute"; belongsTo?: string }[];
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
  // A pause is the client's own stop: the run waits to resume, nothing failed.
  const paused = job.status === "stopped" && Boolean(job.paused);
  const stoppedHere = ["failed", "declined", "cancelled", "stopped"].includes(job.status) && !paused;
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

  // A step's name in each state: not reached, under way, done.
  const label = (t: Tab, todo: string, now: string, done: string) => (state(t) === "done" ? done : state(t) === "todo" ? todo : now);
  const notRun = stoppedHere ? "not run" : null;

  const steps: StepState[] = [
    {
      tab: "spec",
      label: label("spec", "Spec", "Reading the spec", "Spec read"),
      line: read ? `${(read.columns as unknown[]).length} columns, ${(read.samples as unknown[]).length} sample${(read.samples as unknown[]).length === 1 ? "" : "s"}` : "your columns and samples",
      tick: read ? "traced" : null,
      state: state("spec"),
    },
    {
      tab: "site",
      label: declined ? "Site refused" : label("site", "Site", "Investigating the site", "Site investigated"),
      line: declined ? "can't be extracted" : source ? (source.route === "embedded" ? "data embedded in the page" : "its own data feed") : "how it serves its data",
      tick: declined ? "missing" : source && state("site") === "done" ? "traced" : null,
      state: state("site"),
    },
    {
      tab: "code",
      label: label("code", "Extraction", "Writing the extraction", "Extraction written"),
      line: written ? `${written.lines} lines, attempt ${written.attempt}` : state("code") === "todo" && notRun ? notRun : "by Muse Spark",
      tick: tested?.passed ? "traced" : job.status === "failed" && job.step === "code" ? "fail" : null,
      state: state("code"),
    },
    {
      tab: "samples",
      label: label("samples", "Samples", "Checking your samples", "Samples agreed"),
      line: samples.length ? sampleLine(samples) : notRun ?? "against your rows",
      tick: !samples.length ? null : bad ? "fail" : near ? "near" : "sample",
      state: state("samples"),
    },
    {
      tab: "run",
      label: job.status === "waiting" ? "Ready to run" : paused ? "Paused on Apify" : label("run", "Run on Apify", "Running on Apify", "Ran on Apify"),
      line:
        job.status === "waiting"
          ? "waiting for your Go"
          : paused
            ? `${n(job.rows ?? 0)} rows · resume to carry on`
            : job.runId
            ? `${n(job.rows ?? 0)} rows · ${n(job.failedRequests ?? 0)} failed requests`
            : notRun ?? "on your Apify account",
      tick: finished ? "traced" : job.status === "stopped" && !paused ? "missing" : null,
      state: state("run"),
    },
    {
      tab: "footed",
      label: "Footed",
      line: finished && expected !== null ? `${n(job.rows ?? 0)} of ${n(expected)}` : notRun ?? "after the last row",
      tick: finished ? ((job.rows ?? 0) >= (expected ?? 0) ? "footed" : "missing") : null,
      state: state("footed"),
    },
  ];
  return steps;
}

// The samples' values: how many came out exactly, and what the rest are.
function sampleLine(samples: SampleCheck[]) {
  const checks = samples.flatMap((s) => s.checks);
  const exactValues = checks.filter((c) => c.status === "exact").length;
  const failing = checks.filter((c) => c.status === "fail").length;
  const missingSamples = samples.filter((s) => s.status === "not found").length;
  return [
    `${exactValues} of ${checks.length} values exact`,
    nearLine(samples),
    failing && `${failing} differ`,
    missingSamples && `${missingSamples} sample${missingSamples === 1 ? "" : "s"} not found`,
  ]
    .filter(Boolean)
    .join(", ");
}

// What the near matches are, in the user's terms: "1 spacing", "1 typo in the spec".
function nearLine(samples: SampleCheck[]) {
  const whys = samples.filter((s) => s.status === "warn").flatMap((s) => s.checks.filter((c) => c.status === "warn").map((c) => (c.why === "dispute" ? "site" : c.why ?? "spacing")));
  const words = { spacing: "spacing", typo: "typo", column: "misplaced", site: "site disagrees" };
  return (Object.keys(words) as (keyof typeof words)[])
    .filter((w) => whys.includes(w))
    .map((w) => `${whys.filter((x) => x === w).length} ${words[w]}`)
    .join(", ");
}

// The tab to show when nobody has picked one: the step under way, or the data once
// the job is done.
export function defaultTab(job: Job, events: JobEvent[]): Tab {
  if (job.status === "done" || job.status === "stopped") return "run";
  const now = stepStates(job, events, null).find((s) => s.state === "now" || s.state === "stopped");
  return now?.tab ?? "run";
}
