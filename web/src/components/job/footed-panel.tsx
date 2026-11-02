import { Mark } from "@/components/shell";
import { TickMark } from "@/components/tick";
import { n, type Report } from "@/lib/steps";
import type { Job, JobEvent } from "@/lib/types";
import { Panel, Waiting } from "./panel";

// The footing: the delivered rows against the source's own counts, and every gap named.
export function FootedPanel({ job, report }: { job: Job; events: JobEvent[]; report: Report | null }) {
  if (!report) return <Waiting>When the run ends, Dapi counts the rows against what the source itself says exists, and names anything missing.</Waiting>;
  const counted = report.completeness.filter((c) => c.expected !== null);
  const expected = counted.reduce((t, c) => t + (c.expected ?? 0), 0);
  const got = counted.reduce((t, c) => t + Math.min(c.got, c.expected ?? c.got), 0);
  const footed = counted.length > 0 && counted.every((c) => c.got >= (c.expected ?? 0));
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex flex-col gap-4">
        {/* The footing itself: what arrived against what the source says exists. */}
        {counted.length > 0 && (
          <section className="flex flex-col gap-5 rounded-xl bg-night px-6 py-6 text-[#e6e9da] sm:flex-row sm:items-center">
            <Mark className="size-14 shrink-0" bg="var(--night)" lit={footed ? 4 : 3} dim="#2b3a48" />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <p className="text-[15px] text-[#b8c0b9]">{footed ? "Footed. Every row the source counts is here." : `${n(expected - got)} rows short. Each gap is named below.`}</p>
              <p className="text-[34px] leading-none font-bold tracking-[-0.03em] text-white tabular-nums">
                {n(got)} <span className="text-[18px] font-medium text-[#8fa4b8]">delivered of {n(expected)} the source lists</span>
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-[#2b3a48]">
                <div className={footed ? "h-full rounded-full bg-verified" : "h-full rounded-full bg-pencil-red"} style={{ width: `${expected ? Math.max(2, (got / expected) * 100) : 0}%` }} />
              </div>
            </div>
          </section>
        )}
        <Panel title="Against the source's own count">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b text-left text-[12px] text-ink-2">
                <th className="px-5 py-2 font-normal">Rows</th>
                <th className="px-3 py-2 text-right font-normal">The source says</th>
                <th className="px-3 py-2 text-right font-normal">Delivered</th>
                <th className="w-10 px-5 py-2 font-normal">
                  <span className="sr-only">Check</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {report.completeness.map((c) => (
                <tr key={c.kind} className="border-b border-rule last:border-0">
                  <td className="px-5 py-2.5">{c.kind}</td>
                  <td className="px-3 py-2.5 text-right">{c.expected === null ? "—" : n(c.expected)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold">{n(c.got)}</td>
                  <td className="px-5 py-2.5">
                    <TickMark tick={c.expected !== null && c.got >= c.expected ? "footed" : "missing"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title={`Failed requests (${report.failed.length})`}>
          {report.failed.length ? (
            <ul className="divide-y divide-rule">
              {report.failed.map((f) => (
                <li key={f.what} className="flex gap-2.5 px-5 py-2.5 text-[14px]">
                  <span className="mt-0.5">
                    <TickMark tick="missing" />
                  </span>
                  <span>
                    {f.what}: {f.error}
                    <span className="block text-[13px] text-ink-2">Its row was still delivered with what the list had; the missing columns say why.</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-3 text-[14px] text-ink-2">None. Every request came back.</p>
          )}
        </Panel>
        {report.sourceDuplicates.length > 0 && (
          <Panel title="Listed twice by the source">
            <ul className="divide-y divide-rule">
              {report.sourceDuplicates.map((d, i) => (
                <li key={i} className="px-5 py-2.5 text-[14px]">
                  {Object.values(d.row).slice(0, 2).join(" · ")} <span className="text-ink-2">: listed {d.times} times, kept as the source lists it.</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
      <Panel title="The run">
        <dl className="divide-y divide-rule text-[14px]">
          {[
            ["Rows delivered", n(report.rows)],
            ["Responses kept as evidence", n(report.captures)],
            ["Rows without their detail", n(report.partial.length)],
            ["Skipped for robots.txt", n(report.skipped.length)],
            ["Fetched despite robots.txt", n(report.robotsOverridden)],
            ["Resumed after a stop", report.resumed ? `${report.resumed}×, no row read twice` : "0"],
            ...(job.apify
              ? [
                  ["On Apify", `${job.apify.status.toLowerCase().replace("-", " ")}${job.apify.seconds !== null ? `, ${job.apify.seconds < 90 ? `${Math.round(job.apify.seconds)} s` : `${Math.floor(job.apify.seconds / 60)} min ${Math.round(job.apify.seconds % 60)} s`}` : ""}`],
                  ["Compute units", job.apify.computeUnits === null ? "—" : job.apify.computeUnits.toFixed(3)],
                  ["Cost of the run", job.apify.usd === null ? "—" : `$${job.apify.usd.toFixed(3)}`],
                  ...(job.apify.migrations || job.apify.resurrects
                    ? [["Server moves, resurrects", `${job.apify.migrations}, ${job.apify.resurrects}`]]
                    : []),
                ]
              : []),
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-5 py-2.5">
              <dt className="text-ink-2">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        {job.datasetUrl && (
          <p className="border-t px-5 py-3 text-[13px]">
            <a href={job.datasetUrl} target="_blank" rel="noreferrer" className="font-medium underline">
              The dataset on Apify
            </a>{" "}
            <span className="text-ink-2">exports to CSV, Excel or JSON.</span>
          </p>
        )}
      </Panel>
    </div>
  );
}
