import { TickMark } from "@/components/tick";
import { latestSamples, type Report } from "@/lib/steps";
import type { JobEvent } from "@/lib/types";
import { Panel, Waiting } from "./panel";

const TICK = { exact: "sample", warn: "near", fail: "fail" } as const;

export function SamplesPanel({ events, report }: { events: JobEvent[]; report: Report | null }) {
  const samples = latestSamples(events, report);
  if (!samples.length) return <Waiting>Once the extraction is written, its test run is checked against every sample row in your spec.</Waiting>;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] text-ink-2">
        {report ? "Checked against the full run." : "Checked against the test run, before the full run."} Each sample row in your spec is found among the delivered rows and compared column by column.
      </p>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {samples.map((s) => (
          <Panel
            key={s.label}
            title={s.label}
            action={
              <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
                {s.status === "not found" ? "not found in the rows" : s.row === null ? "" : `row ${s.row + 1}`}
                <TickMark tick={s.status === "pass" ? "sample" : s.status === "warn" ? "near" : "fail"} />
              </span>
            }
          >
            <table className="w-full table-fixed text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-2">
                  <th className="w-[28%] px-5 py-2 font-normal">Column</th>
                  <th className="px-3 py-2 font-normal">Your sample</th>
                  <th className="px-3 py-2 font-normal">Delivered</th>
                  <th className="w-10 px-3 py-2 font-normal">
                    <span className="sr-only">Check</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.checks.map((c) => (
                  <tr key={c.column} className="border-b border-rule align-top last:border-0">
                    <td className="px-5 py-2 font-medium">{c.column}</td>
                    <td className="px-3 py-2 break-words text-ink-2">{c.expected || <span className="text-ink-3">blank</span>}</td>
                    <td className="px-3 py-2 break-words">
                      {String(c.actual) || <span className="text-ink-3">blank</span>}
                      {c.why && (
                        <span className="mt-0.5 block text-[12px] text-pencil-red">
                          {c.why === "spacing" ? "spacing differs" : c.why === "typo" ? "likely a typo in your spec" : c.why === "site" ? "the site disagrees with your sample; delivered as the site has it" : `your value is this record's ${c.belongsTo}`}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <TickMark tick={TICK[c.status]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        ))}
      </div>
    </div>
  );
}
