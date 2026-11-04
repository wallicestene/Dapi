"use client";

import Link from "next/link";
import { useState } from "react";
import showcase from "@/lib/showcase.json";
import { cn } from "@/lib/utils";
import { TickMark } from "@/components/tick";

// The home page's live receipt: a finished job's first rows and, for each value, the
// response it was read from, as captured on Apify. Click a value to see where it came
// from. Built by src/receipts/showcase.js from a job on a source we may show.
type Cell = {
  value: string;
  original: string | null;
  path: string;
  field: string;
  parent: string;
  lines: { key: string; value: string; hit: boolean }[];
  request: string;
  capturedAt: string;
  sha256: string;
};
const rows = showcase.rowsShown as Record<string, Cell>[];
const COLUMNS = showcase.columns as [string, string][];
const site = showcase.host.replace(/^www\./, "");
const when = (at: string) => new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" });
// The seal, short: enough to recognise it; the whole fingerprint is on hover and in the job.
const short = (sha: string) => `${sha.slice(0, 8)}…${sha.slice(-6)}`;
// A long line shows its start; the marked line shows the value itself, wherever it sits
// (a feed's cell can hold a link before the name).
function clip(raw: string, value: string, hit: boolean) {
  if (raw.length <= 46) return raw;
  const at = hit ? raw.indexOf(value) : -1;
  if (at < 0 || at + value.length <= 44) return `${raw.slice(0, 44)}…"`;
  const end = Math.min(at - 1 + 42, raw.length - 1);
  return `"…${raw.slice(at - 1, end)}${end < raw.length - 1 ? "…" : ""}"`;
}

export function ReceiptDemo() {
  const [at, setAt] = useState({ row: 1, column: COLUMNS[0][0] });
  const cell = rows[at.row][at.column];
  return (
    <div className="overflow-hidden rounded-xl border bg-sheet shadow-[0_1px_0_rgba(29,44,58,0.04),0_12px_32px_-12px_rgba(29,44,58,0.18)]">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <span className="text-[14px] font-semibold">{showcase.title}</span>
        <span className="ml-auto text-[13px] text-ink-2 tabular-nums">
          {showcase.rows.toLocaleString("en-US")} of {showcase.total.toLocaleString("en-US")} rows
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] table-fixed text-[13.5px]">
          <colgroup>
            {COLUMNS.map(([c], i) => (
              <col key={c} style={{ width: i === 0 ? "34%" : `${66 / (COLUMNS.length - 1)}%` }} />
            ))}
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
                          on ? "bg-verified text-ink shadow-[inset_0_0_0_1.5px_var(--ink)]" : "hover:bg-active"
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
      {/* One height for every cell, so picking one never moves the page. */}
      <div className="border-t bg-raised px-4 py-4">
        <div className="flex min-w-0 items-baseline gap-x-2">
          <span className="truncate text-[15px] font-semibold">{cell.value}</span>
          <span className="shrink-0 text-[13px] text-ink-2">
            {cell.original && cell.original !== cell.value ? <>translated from the site&apos;s &ldquo;{cell.original}&rdquo;</> : "traced to the site's own data"}
          </span>
        </div>
        {/* What a visitor needs: where it came from, when, and that it can't have changed.
            The request, the proxy and the whole SHA-256 are one click away, on the job. */}
        <dl className="mt-2.5 grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]">
          <dt className="text-ink-2">From</dt>
          <dd title={cell.request}>{site}&apos;s own data, the response its public page loads</dd>
          <dt className="text-ink-2">Captured</dt>
          <dd>{when(cell.capturedAt)} UTC</dd>
          <dt className="text-ink-2">Sealed</dt>
          <dd className="flex items-center gap-1.5" title={`SHA-256 ${cell.sha256}: a fingerprint of the response. Change one character and it no longer matches.`}>
            <TickMark tick="traced" /> the moment it was captured
            <span className="font-mono text-[11px] text-ink-3">{short(cell.sha256)}</span>
          </dd>
        </dl>
        <pre className="mt-3 h-[calc(7lh+22px)] overflow-x-auto rounded-lg border bg-sheet px-3 py-2.5 font-mono text-[12px] leading-[1.7]">
          <span className="text-ink-2">{`${cell.path.split(".").slice(0, -1).join(".")} {`}</span>
          {"\n"}
          {cell.lines.map((l) => (
            <span key={l.key} className={cn("block", l.hit && "-mx-1.5 rounded bg-verified px-1.5")}>
              {`  "${l.key}": ${clip(l.value, cell.value, l.hit)},`}
            </span>
          ))}
          <span className="text-ink-2">{"}"}</span>
        </pre>
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <Link href={`/jobs/${showcase.job}`} className="text-[13px] font-medium underline">
            Open the whole job and every receipt
          </Link>
          {/* The source's licence asks for this credit wherever its data is shown. */}
          {showcase.credit && <span className="text-[11.5px] text-ink-3">{showcase.credit}</span>}
        </div>
      </div>
    </div>
  );
}
