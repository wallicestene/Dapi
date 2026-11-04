// The six steps of a job as the screen shows them, each with its tick and one line of
// result, worked out from the job's summary and its events.

import type { Job, JobEvent, Tick } from "@/lib/types";

export type Tab = "spec" | "site" | "code" | "samples" | "run" | "footed";

// Each step's name in a word, for phones, where the full label doesn't fit.
export const SHORT: Record<Tab, string> = { spec: "Spec", site: "Site", code: "Extraction", samples: "Samples", run: "Run", footed: "Count" };

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

// A small difference between a sample and the site, the kind Dapi handles without
// asking: spacing, a likely typo in the spec, a value typed under another column. It
// counts as a match. A value the site shows differently is not small: the client sees it.
export const smallDifference = (why?: string) => why === "spacing" || why === "typo" || why === "column";
const matches = (c: SampleCheck["checks"][number]) => c.status === "exact" || (c.status === "warn" && smallDifference(c.why));

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
  // Paused between steps: everything before the step it resumes at is done.
  const held = job.status === "held" && job.heldBefore ? (job.heldBefore as Tab) : null;
  const jobTab: Tab = held ?? (job.step === "plan" ? "run" : job.step === "code" && last(events, "tested") ? "samples" : (job.step as Tab));
  // A pause is the client's own stop: the run waits to resume, nothing failed.
  const paused = job.status === "stopped" && Boolean(job.paused);
  // Only the pipeline stopping itself marks a step as stopped; the client's own pauses
  // (at the plan, between steps, the run) don't.
  const atPlan = job.status === "cancelled";
  const stoppedHere = ["failed", "declined", "stopped"].includes(job.status) && !paused;
  const finished = job.status === "done";

  const state = (t: Tab): StepState["state"] => {
    if (finished || at(t) < at(jobTab)) return "done";
    if (at(t) === at(jobTab)) return stoppedHere ? "stopped" : "now";
    return "todo";
  };

  const read = last(events, "read");
  const source = last(events, "source");
  // How the run reads the site: Muse Wonder's strategy when there is one (FDA: the first
  // look read the HTML table, the strategy its feed), else the first look's route.
  const strategy = last(events, "strategy");
  const routes = ((strategy?.columns as { route?: string }[] | undefined) ?? []).map((c) => c.route);
  const way = routes.some((r) => r === "feed" || r === "register")
    ? "its own data feed"
    : source?.route === "embedded"
      ? "data embedded in the page"
      : source?.route === "html" || routes.includes("page")
        ? "the page's own HTML"
        : "its own data feed";
  const declined = last(events, "declined");
  const written = last(events, "written");
  const tested = last(events, "tested");
  const samples = latestSamples(events, report);
  const exact = samples.filter((s) => s.status === "pass").length;
  const near = samples.filter((s) => s.status === "warn" && !s.checks.every(matches)).length;
  const bad = samples.filter((s) => s.status === "fail" || s.status === "not found").length;
  const expected = job.expected ?? null;

  // A step's name in each state: not reached, under way, done.
  const label = (t: Tab, todo: string, now: string, done: string) => (state(t) === "done" ? done : state(t) === "todo" ? todo : now);
  const notRun = stoppedHere ? "not run" : null;

  const steps: StepState[] = [
    {
      tab: "spec",
      label: label("spec", "Spec", "Reading the spec", "Spec read"),
      line: read ? `${(read.columns as unknown[]).length} column${(read.columns as unknown[]).length === 1 ? "" : "s"}, ${(read.samples as unknown[]).length} sample${(read.samples as unknown[]).length === 1 ? "" : "s"}` : "your columns and samples",
      tick: read ? "traced" : null,
      state: state("spec"),
    },
    {
      tab: "site",
      label: declined ? "Site declined" : label("site", "Site", "Investigating the site", "Site investigated"),
      line: declined ? "can't be extracted" : source ? way : "how it serves its data",
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
      label: label("samples", "Samples", "Checking your samples", "Samples checked"),
      line: samples.length ? sampleLine(samples) : notRun ?? "against your rows",
      tick: !samples.length ? null : bad ? "fail" : near ? "near" : "sample",
      state: state("samples"),
    },
    {
      tab: "run",
      label: job.status === "waiting" || atPlan ? "Ready to run" : paused ? "Paused on Apify" : label("run", "Run on Apify", "Running on Apify", "Ran on Apify"),
      line:
        job.status === "waiting"
          ? "waiting for your Go"
          : atPlan
            ? "paused at the plan"
          : paused
            ? `${n(job.rows ?? 0)} rows · resume to carry on`
            : job.runId
            ? [`${n(job.rows ?? 0)} rows`, job.failedRequests ? `${n(job.failedRequests)} failed requests` : null].filter(Boolean).join(" · ")
            : notRun ?? "on Apify",
      tick: finished ? "traced" : job.status === "stopped" && !paused ? "missing" : null,
      state: state("run"),
    },
    {
      tab: "footed",
      label: finished ? "Counted" : "Count",
      line: finished && expected !== null ? `${n(job.rows ?? 0)} of ${n(expected)}` : notRun ?? "against the source",
      tick: finished ? ((job.rows ?? 0) >= (expected ?? 0) ? "footed" : "missing") : null,
      state: state("footed"),
    },
  ];
  if (held) {
    const at = steps.find((s) => s.tab === held);
    if (at) Object.assign(at, { label: held === "site" ? "Site" : "Extraction", line: "paused before this step", tick: null });
  }
  return steps;
}

// The samples' values in one short line: how many match; the why is on the tab.
function sampleLine(samples: SampleCheck[]) {
  const checks = samples.flatMap((s) => s.checks);
  const matching = checks.filter(matches).length;
  const missingSamples = samples.filter((s) => s.status === "not found").length;
  return [`${matching} of ${checks.length} values match`, missingSamples && `${missingSamples} sample${missingSamples === 1 ? "" : "s"} not found`].filter(Boolean).join(", ");
}

// The tab to show when nobody has picked one: the step under way, or the data once
// the job is done.
export function defaultTab(job: Job, events: JobEvent[]): Tab {
  // The plan (waiting for Go, or paused with "Not now") is on the Run tab: always open there.
  if (["done", "stopped", "waiting", "cancelled"].includes(job.status)) return "run";
  const now = stepStates(job, events, null).find((s) => s.state === "now" || s.state === "stopped");
  return now?.tab ?? "run";
}
