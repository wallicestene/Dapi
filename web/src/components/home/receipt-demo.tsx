"use client";

import Link from "next/link";
import { useState } from "react";
import showcase from "@/lib/showcase.json";
import { cn } from "@/lib/utils";

// The home page's live receipt: FSSC's first delivered rows (job 0024) and the response
// they were read from, as captured on Apify. Click a value to see where it came from.
type Cell = { value: string; path: string; field: string; parent: string; lines: { key: string; value: string; hit: boolean }[] };
const rows = showcase.rows as Record<string, Cell>[];
const COLUMNS: [string, string][] = [
  ["Organization name", "Organization"],
  ["City", "City"],
  ["Country", "Country"],
  ["Certificate valid until", "Valid until"],
];

const captured = new Date(showcase.capturedAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" });
const via = showcase.via.replace(/^Apify Proxy /, "Apify ").toLowerCase().replace(/^apify/, "Apify");

export function ReceiptDemo() {
  const [at, setAt] = useState({ row: 1, column: "City" });
  const cell = rows[at.row][at.column];
  return (
    <div className="overflow-hidden rounded-xl border bg-sheet shadow-[0_1px_0_rgba(29,44,58,0.04),0_12px_32px_-12px_rgba(29,44,58,0.18)]">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <span className="text-[14px] font-semibold">{showcase.title}</span>
        <span className="ml-auto text-[13px] text-ink-2 tabular-nums">43,037 of 43,037 rows</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] table-fixed text-[13.5px]">
          <colgroup>
            <col className="w-[34%]" />
            <col className="w-[25%]" />
            <col className="w-[21%]" />
            <col className="w-[20%]" />
          </colgroup>
          <thead>
            <tr className="border-b text-left text-[12px] text-ink-2">
              {COLUMNS.map(([c, short]) => (
                <th key={c} className="px-3 py-2 font-normal first:pl-4">
                  {short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-rule last:border-0">
                {COLUMNS.map(([c]) => {
                  const on = at.row === i && at.column === c;
                  return (
                    <td key={c} className="px-1 py-1 first:pl-2.5 last:pr-2.5">
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => setAt({ row: i, column: c })}
                        className={cn(
                          "block w-full truncate rounded-md px-1.5 py-1.5 text-left transition-colors",
                          on ? "bg-verified font-semibold text-ink shadow-[inset_0_0_0_1.5px_var(--ink)]" : "hover:bg-active"
                        )}
                      >
                        {row[c].value}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t bg-raised px-4 py-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[15px] font-semibold">{cell.value}</span>
          <span className="text-[13px] text-ink-2">traced to the server&apos;s own response</span>
        </div>
        <dl className="mt-2.5 grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]">
          <dt className="text-ink-2">Request</dt>
          <dd className="font-mono text-[11.5px] [overflow-wrap:anywhere]">{showcase.request}</dd>
          <dt className="text-ink-2">Captured</dt>
          <dd>
            {captured} UTC, via {via} proxy
          </dd>
          <dt className="text-ink-2">SHA-256</dt>
          <dd className="font-mono text-[11.5px] [overflow-wrap:anywhere]">{showcase.sha256}</dd>
        </dl>
        <pre className="mt-3 overflow-x-auto rounded-lg border bg-sheet px-3 py-2.5 font-mono text-[12px] leading-[1.7]">
          <span className="text-ink-2">{`${cell.path.split(".").slice(0, -1).join(".")} {`}</span>
          {"\n"}
          {cell.lines.map((l) => (
            <span key={l.key} className={cn("block", l.hit && "-mx-1.5 rounded bg-verified px-1.5")}>
              {`  "${l.key}": ${l.value.length > 46 ? `${l.value.slice(0, 44)}…"` : l.value},`}
            </span>
          ))}
          <span className="text-ink-2">{"}"}</span>
        </pre>
        <Link href={`/jobs/${showcase.job}`} className="mt-3 inline-block text-[13px] font-medium underline">
          Open the whole job and every receipt
        </Link>
      </div>
    </div>
  );
}
