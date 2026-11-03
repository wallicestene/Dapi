import { cn } from "@/lib/utils";
import type { Tick } from "@/lib/types";

// The marks on values and steps. Green for a check that held, red for an exception; a
// constant set by the spec, or a value the source leaves blank, carries no mark. Icons,
// not letters: a mark has to read without a legend.
export const TICK_TEXT: Record<Tick, string> = {
  traced: "Traced to where it came from",
  sample: "Agrees with your sample",
  near: "Differs from your sample, with the reason",
  fail: "Differs from your sample",
  missing: "Missing, with the reason",
  spec: "Set by your spec",
  blank: "The source has no value here",
};

// `quiet` is for the table, where nearly every value is traced: the routine tick
// recedes so the exceptions stand out.
export function TickMark({ tick, quiet, className }: { tick: Tick | "footed"; quiet?: boolean; className?: string }) {
  const green = "text-pencil-green";
  const red = "text-pencil-red";
  const label = tick === "footed" ? "Every row the source lists" : TICK_TEXT[tick];
  if (tick === "spec" || tick === "blank") return null;
  const path = {
    traced: "M2.2 6.6 4.9 9.3 10 2.6",
    // Two ticks: checked, and it agrees with your sample.
    sample: "M.8 6.8 3.2 9.2 7.6 3M5.6 8.6l.6.6L11.2 3",
    // A tick in a ring: every row the source lists is here.
    footed: "M6 .9a5.1 5.1 0 1 0 0 10.2A5.1 5.1 0 0 0 6 .9ZM3.6 6.1l1.7 1.7 3.1-3.6",
    fail: "M3 3l6 6M9 3l-6 6",
    missing: "M3 3l6 6M9 3l-6 6",
    near: "M2 4.6c1.3-1.2 2.7-1.2 4 0s2.7 1.2 4 0M2 8.4c1.3-1.2 2.7-1.2 4 0s2.7 1.2 4 0",
  }[tick];
  return (
    <svg role="img" aria-label={label} viewBox="0 0 12 12" className={cn("inline-block size-3 shrink-0", tick === "traced" ? (quiet ? "text-pencil-green/45" : green) : tick === "sample" || tick === "footed" ? green : red, className)}>
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// The legend docked under the table: every mark, scaled as it appears.
export function TickLegend({ className }: { className?: string }) {
  const items: [Tick | "footed", string][] = [
    ["traced", "traced to where it came from"],
    ["sample", "agrees with your sample"],
    ["near", "differs from your sample, with the reason"],
    ["footed", "every row the source lists"],
    ["missing", "missing, with the reason"],
  ];
  return (
    <ul className={cn("flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-ink-2", className)}>
      {items.map(([t, text]) => (
        <li key={t} className="flex items-center gap-1.5">
          <TickMark tick={t} />
          {text}
        </li>
      ))}
    </ul>
  );
}
