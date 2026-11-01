"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TickLegend, TickMark } from "@/components/tick";
import { cn } from "@/lib/utils";
import { n } from "@/lib/steps";
import type { Cell, Job, RowsPage } from "@/lib/types";

export interface Selection {
  row: number;
  column: string;
  cell: Cell;
}

const PAGE = 50;
// The identity column stays in view while the rest scroll sideways.
const STICKY = "sticky left-12 z-[1] shadow-[1px_0_0_var(--rule)]";
// Numbers and dates line up on their right edge, like figures on a working paper.
const numeric = (v: string) => /^-?[\d,.]+$/.test(v.trim()) || /^\d{1,2} [A-Z][a-z]{2} \d{4}$/.test(v.trim()) || /^\d{4}-\d{2}-\d{2}/.test(v.trim());

export function DataSheet({ job, selected, onSelect }: { job: Job; selected: Selection | null; onSelect: (s: Selection) => void }) {
  const live = job.status === "running";
  const [scope, setScope] = useState("all");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  // While rows are landing, the sheet follows the newest ones until you page or filter.
  const [follow, setFollow] = useState(live);
  const [page, setPage] = useState<RowsPage | null>(null);
  const [error, setError] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    const ticket = ++request.current;
    const params = new URLSearchParams({ scope, q, limit: String(PAGE) });
    const load = async () => {
      try {
        let res = await fetch(`/api/jobs/${job.id}/rows?${params}&offset=${offset}`);
        let data: RowsPage = await res.json();
        if (follow && data.total > PAGE) {
          res = await fetch(`/api/jobs/${job.id}/rows?${params}&offset=${data.total - PAGE}`);
          data = await res.json();
        }
        if (ticket === request.current) {
          setPage(data);
          setError(false);
        }
      } catch {
        if (ticket === request.current) setError(true);
      }
    };
    const timer = setTimeout(load, q ? 200 : 0);
    return () => clearTimeout(timer);
  }, [job.id, job.rows, scope, q, offset, follow]);

  const first = page ? (follow ? Math.max(0, page.total - PAGE) : offset) : 0;
  const columns = page?.columns ?? [];
  const rightAligned = new Set(columns.filter((c) => page?.rows.length && page.rows.every((r) => !r.cells[c].value || numeric(r.cells[c].value))));
  const expected = job.expected ?? null;
  const short = expected !== null && (job.rows ?? 0) < expected;

  const go = (o: number) => {
    setFollow(false);
    setOffset(Math.max(0, o));
  };

  return (
    <section aria-label="Delivered rows" className="min-w-0 overflow-hidden rounded-lg border bg-sheet">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setFollow(false);
              setOffset(0);
            }}
            placeholder="Filter rows"
            aria-label="Filter rows"
            className="h-8 w-60 border-control bg-white pl-8 text-[13px] placeholder:text-ink-3"
          />
        </div>
        <ToggleGroup
          type="single"
          value={scope}
          onValueChange={(v) => {
            if (!v) return;
            setScope(v);
            setFollow(false);
            setOffset(0);
          }}
          aria-label="Which rows"
          className="gap-1"
        >
          {[
            ["all", "All", page?.all],
            ["exceptions", "Exceptions", page?.exceptions],
            ["missing", "Missing", page?.missing],
          ].map(([value, label, count]) => (
            <ToggleGroupItem
              key={value as string}
              value={value as string}
              className="h-8 rounded-full border border-rule px-3 text-[12px] text-ink-2 data-[state=on]:border-ink data-[state=on]:bg-sheet data-[state=on]:text-ink"
            >
              {label} <span className="ml-1 tabular-nums">{count === undefined ? "–" : n(count as number)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {live && (
          <label className="ml-auto flex items-center gap-2 text-[12px] text-ink-2">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-ink" />
            Follow new rows
          </label>
        )}
      </div>

      <div className="max-h-[calc(100vh-330px)] min-h-[260px] overflow-auto">
        <table className="w-max min-w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-sheet">
            <tr className="border-b">
              <th scope="col" className="sticky left-0 z-10 w-12 min-w-12 bg-sheet px-3 py-2 text-right text-[12px] font-normal text-ink-2">
                #
              </th>
              {columns.map((c, i) => (
                <th
                  key={c}
                  scope="col"
                  className={cn("px-3 py-2 text-left text-[12px] font-normal whitespace-nowrap text-ink-2", rightAligned.has(c) && "text-right", i === 0 && STICKY, i === 0 && "bg-sheet")}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page?.rows.map((row) => (
              <tr key={row.index} className={cn("border-b border-rule", selected?.row === row.index && "bg-active")}>
                <td className={cn("sticky left-0 z-[1] w-12 min-w-12 px-3 py-0 text-right text-ink-3", selected?.row === row.index ? "bg-active" : "bg-sheet")}>{row.index + 1}</td>
                {columns.map((c, i) => {
                  const cell = row.cells[c];
                  const isSel = selected?.row === row.index && selected.column === c;
                  return (
                    <td key={c} className={cn("p-0", i === 0 && STICKY, i === 0 && (selected?.row === row.index ? "bg-active" : "bg-sheet"))}>
                      <button
                        type="button"
                        onClick={() => onSelect({ row: row.index, column: c, cell })}
                        aria-pressed={isSel}
                        aria-label={`${c}, row ${row.index + 1}: ${cell.value || "blank"}`}
                        className={cn(
                          "flex h-10 w-full max-w-[260px] min-w-[72px] items-center gap-1.5 px-3 text-left outline-none hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink",
                          rightAligned.has(c) && "justify-end",
                          isSel && "outline-2 -outline-offset-2 outline-ink"
                        )}
                      >
                        <span className={cn("truncate", !cell.value && "text-ink-3")}>{cell.value || "—"}</span>
                        <TickMark tick={cell.tick} quiet />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            {page && !page.rows.length && (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-6 text-[14px] text-ink-2">
                  {q ? `No rows contain “${q}”.` : scope === "missing" ? "No row is missing a value." : scope === "exceptions" ? "No exceptions: every checked value held." : live ? "The first rows land in a few seconds." : "No rows."}
                </td>
              </tr>
            )}
            {!page && !error && (
              <tr>
                <td colSpan={2} className="px-4 py-6 text-[14px] text-ink-2">
                  Loading rows…
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td colSpan={columns.length + 1 || 2} className="px-4 py-6 text-[14px] text-pencil-red">
                  Couldn&apos;t load the rows. They&apos;re safe in the Apify dataset; reload to try again.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-ink px-3 pt-2.5 pb-2" style={{ borderBottom: "3px double var(--ink)" }}>
        <p className="text-[13px] font-semibold">
          {job.status === "done" ? "Footed against the source's own count" : "Footed so far against the source's own count"}
          <span className="ml-3 inline-flex items-center gap-1 tabular-nums">
            {n(job.rows ?? 0)} of {expected === null ? "…" : n(expected)}
            {job.status === "done" && <TickMark tick={short ? "missing" : "footed"} />}
          </span>
        </p>
        {page && page.total > PAGE && (
          <div className="flex items-center gap-1 text-[12px] text-ink-2">
            <span className="mr-1 tabular-nums">
              {n(first + 1)}–{n(Math.min(first + PAGE, page.total))} of {n(page.total)}
            </span>
            <Button variant="ghost" size="icon-sm" aria-label="Previous rows" disabled={first === 0} onClick={() => go(first - PAGE)}>
              <ChevronLeft />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Next rows" disabled={first + PAGE >= page.total} onClick={() => go(first + PAGE)}>
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
      <TickLegend className="px-3 py-2.5" />
    </section>
  );
}
