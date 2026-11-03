// Shapes the runner writes to a job's folder (src/jobs/store.js) and the web app reads.

export type JobStatus = "running" | "waiting" | "held" | "done" | "failed" | "declined" | "cancelled" | "stopped";
export type StepName = "spec" | "site" | "code" | "plan" | "run" | "footed";

export interface Job {
  id: string;
  input: string;
  // Who started it, on the public demo (a GitHub account): only they see and act on it.
  owner?: { id: number; login: string };
  status: JobStatus;
  step: StepName;
  createdAt: string;
  updatedAt?: string;
  finishedAt?: string;
  title?: string;
  sourceUrl?: string;
  rowUnit?: string;
  records?: number;
  rows?: number;
  expected?: number | null;
  failedRequests?: number;
  runId?: string;
  runUrl?: string;
  datasetUrl?: string;
  runStatus?: string;
  statusMessage?: string | null;
  declined?: string;
  failed?: string;
  runnerPid?: number;
  runAttempt?: number;
  // Paused by the client on Apify; Resume carries on where it stopped.
  paused?: boolean;
  // Paused between steps: the step it resumes at, and a pause asked for while a step runs.
  heldBefore?: StepName;
  holdRequested?: boolean;
  // What Apify itself reports about the run.
  apify?: {
    status: string;
    startedAt: string;
    finishedAt: string | null;
    seconds: number | null;
    computeUnits: number | null;
    usd: number | null;
    migrations: number;
    restarts: number;
    resurrects: number;
  };
}

export interface JobEvent {
  n: number;
  at: string;
  step: StepName;
  kind: string;
  text?: string;
  image?: string;
  [key: string]: unknown;
}

// How a delivered value was checked, shown as an auditor's tick beside it.
export type Tick =
  | "traced" // read from a response Dapi kept as evidence
  | "sample" // equals the spec's sample value
  | "near" // differs from the sample only by spacing, a slip, or the sample's column
  | "fail" // differs from the sample
  | "missing" // could not be fetched; the reason travels with it
  | "spec" // a constant the spec sets
  | "blank"; // the source has no value here

// Why a delivered value differs from the spec's sample without failing: spacing, a
// slip in the spec, or a sample value typed under another column.
// "dispute": the tester found the sample's value nowhere in the record's own data (same as "site").
export type Why = "spacing" | "typo" | "column" | "site" | "dispute";

export interface Cell {
  value: string;
  tick: Tick;
  evidence?: string;
  paths?: string[];
  sample?: { label: string; expected: string; why?: Why; belongsTo?: string };
  reason?: string;
  original?: string; // the site's own words, when the value was translated after the run
}

export interface Row {
  index: number;
  cells: Record<string, Cell>;
}

export interface RowsPage {
  columns: string[];
  rows: Row[];
  total: number; // rows in this scope
  all: number; // rows delivered
  exceptions: number;
  missing: number;
  translated: { from: string; to: string } | null;
}

export interface Located {
  path: string;
  kind: "json" | "embedded" | "html";
  record?: unknown;
  key?: string;
  value?: unknown;
  context?: string;
  rowPath?: string;
  row?: unknown;
  cell?: string;
  selector?: string;
  all?: boolean;
  matches?: number;
  // Fields of the record the site sent that the job doesn't deliver: counted, not shown.
  hidden?: number;
}

export interface Receipt {
  key: string;
  capturedAt: string;
  via?: string;
  request: { method: string; url: string; payload?: string | null };
  response: { status: number; contentType?: string | null };
  bodySha256: string;
  bodyBytes: number;
  located: Located[];
}

// A job's data at a glance, for its card: the first rows' values as lengths (0 for a
// blank), column by column. No rows yet: an empty table in the spec's columns.
export interface DataShape {
  columns: number;
  rows: number[][];
}
