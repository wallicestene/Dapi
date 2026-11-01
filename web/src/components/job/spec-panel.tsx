import { ArrowRight } from "lucide-react";
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
  const corrections = (read.corrections as { original: string; corrected: string; why: string }[] | undefined) ?? [];
  const aligned = events.find((e) => e.kind === "record-page");
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
        {aligned && <SamplesAgainstSite event={aligned} />}
        {corrections.length > 0 && (
          <Panel title="Column names tidied">
            <ul className="space-y-1.5 px-5 py-3 text-[14px]">
              {corrections.map((c) => (
                <li key={c.original}>
                  <span className="text-ink-2 line-through decoration-pencil-red">{c.original}</span>
                  <ArrowRight aria-hidden className="mx-1.5 inline size-3.5 text-ink-3" />
                  <span className="sr-only">became</span>
                  <span className="font-medium">{c.corrected}</span>
                  <span className="block text-[13px] text-ink-2">{c.why}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        {personal.length > 0 && (
          <Panel title="Columns about people">
            <ul className="space-y-1 px-5 pt-3 text-[14px]">
              {personal.map((p) => (
                <li key={p.column}>
                  <span className="font-medium">{p.column}</span> <span className="text-ink-2">({p.why})</span>
                </li>
              ))}
            </ul>
            <p className="px-5 pt-2 pb-3 text-[13px] text-ink-2">Collected only as the site shows them to any visitor. Dapi never gets past a bot check to reach them.</p>
          </Panel>
        )}
        {(questions.length > 0 || problems.length > 0) && (
          <Panel title="Notes on the spec">
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

const RELATION: Record<string, string> = {
  formatted: "written differently on the site",
  translated: "translated from the site",
  differs: "the site disagrees",
  absent: "not on this record's page",
};

// How the spec's sample stands against the record page it came from.
function SamplesAgainstSite({ event }: { event: JobEvent }) {
  const columns = (event.alignment as { column: string; onPage: string; relation: string }[]).filter((c) => RELATION[c.relation]);
  const lang = (code: unknown) => {
    try {
      return new Intl.DisplayNames(["en"], { type: "language" }).of(String(code)) ?? String(code);
    } catch {
      return String(code);
    }
  };
  return (
    <Panel title="Your sample against the site">
      <p className="px-5 pt-3 text-[14px] text-ink-2">
        {event.pageLanguage !== event.sampleLanguage
          ? `Your sample is in ${lang(event.sampleLanguage)}; the site is in ${lang(event.pageLanguage)}. Dapi extracts the site's own words and translates after the run.`
          : "Compared with the record's own page on the site."}
      </p>
      <ul className="divide-y divide-rule px-5 pb-2 text-[14px] [overflow-wrap:anywhere]">
        {columns.map((c) => (
          <li key={c.column} className="py-2">
            <span className="font-medium">{c.column}</span>
            <span className={c.relation === "differs" ? " text-pencil-red" : " text-ink-2"}>: {RELATION[c.relation]}</span>
            {c.onPage && <span className="block text-[13px] text-ink-2">The site: {c.onPage}</span>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
