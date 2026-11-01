import type { Job, JobEvent } from "@/lib/types";
import { Panel, Waiting } from "./panel";

interface Column {
  name: string;
  constant: string | null;
}

export function SpecPanel({ job, events }: { job: Job; events: JobEvent[] }) {
  const read = events.find((e) => e.kind === "read");
  if (!read) return <Waiting>Muse Spark is reading your spec: its columns, sample rows and rules.</Waiting>;
  const columns = read.columns as Column[];
  const rules = read.rules as string[];
  const questions = read.questions as string[];
  const problems = read.problems as string[];
  const personal = (read.personalData as { column: string; why: string }[] | undefined) ?? [];
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel title={`Columns (${columns.length})`} action={<a href={`/api/jobs/${job.id}/files/${job.input}`} target="_blank" rel="noreferrer" className="text-[13px] font-medium underline">Open the spec you gave</a>}>
        <ol className="divide-y divide-rule">
          {columns.map((c, i) => (
            <li key={c.name} className="flex items-baseline gap-3 px-5 py-2.5 text-[14px]">
              <span className="w-5 shrink-0 text-right text-[12px] text-ink-3">{i + 1}</span>
              <span className="font-medium">{c.name}</span>
              {c.constant !== null && <span className="ml-auto text-[13px] text-ink-2">always “{c.constant}”</span>}
            </li>
          ))}
        </ol>
      </Panel>
      <div className="flex flex-col gap-4">
        <Panel title="Rules">
          <ul className="list-disc space-y-1.5 py-3 pr-5 pl-9 text-[14px]">
            {rules.length ? rules.map((r) => <li key={r}>{r}</li>) : <li className="list-none text-ink-2">None beyond the columns.</li>}
          </ul>
        </Panel>
        <Panel title={`Sample rows (${(read.samples as string[]).length})`}>
          <p className="px-5 py-3 text-[14px]">
            {(read.samples as string[]).length
              ? `${(read.samples as string[]).join(", ")}. These are the test cases: the extraction must reproduce them before it runs.`
              : "None. Without sample rows there is nothing to test the extraction against."}
          </p>
        </Panel>
        {personal.length > 0 && (
          <section className="rounded-lg border border-pencil-red/40 bg-red-wash px-5 py-3 text-[14px] text-red-ink">
            <h2 className="font-semibold">Personal data in the spec</h2>
            <ul className="mt-1.5 space-y-1">
              {personal.map((p) => (
                <li key={p.column}>
                  {p.column}: {p.why}
                </li>
              ))}
            </ul>
            <p className="mt-2">Dapi extracts public data about organisations, not people.</p>
          </section>
        )}
        {(questions.length > 0 || problems.length > 0) && (
          <Panel title="Unclear in the spec">
            <ul className="space-y-1.5 px-5 py-3 text-[14px]">
              {[...questions, ...problems].map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}
