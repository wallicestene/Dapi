import { cn } from "@/lib/utils";
import type { Tick } from "@/lib/types";

// The auditor's tick marks. Green pencil for a check that held, red for an exception;
// a constant set by the spec, or a value the source leaves blank, carries no mark.
export const TICK_TEXT: Record<Tick, string> = {
  traced: "Traced to the server's response",
  sample: "Agrees with your sample",
  near: "Near your sample: spacing, a slip in the spec, or a value under another column",
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
  const label = tick === "footed" ? "Footed to the source's total" : TICK_TEXT[tick];
  if (tick === "spec" || tick === "blank") return null;
  if (tick === "sample" || tick === "footed") {
    return (
      <span role="img" aria-label={label} className={cn("condensed inline-block w-3 text-center text-[12px] leading-none font-bold", green, className)}>
        {tick === "sample" ? "S" : "F"}
      </span>
    );
  }
  const path = {
    traced: "M2.2 6.6 4.9 9.3 10 2.6",
    fail: "M3 3l6 6M9 3l-6 6",
    missing: "M3 3l6 6M9 3l-6 6",
    near: "M2 4.6c1.3-1.2 2.7-1.2 4 0s2.7 1.2 4 0M2 8.4c1.3-1.2 2.7-1.2 4 0s2.7 1.2 4 0",
  }[tick];
  return (
    <svg role="img" aria-label={label} viewBox="0 0 12 12" className={cn("inline-block size-3 shrink-0", tick === "traced" ? (quiet ? "text-pencil-green/45" : green) : red, className)}>
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// The legend docked under the table: every mark, scaled as it appears.
export function TickLegend({ className }: { className?: string }) {
  const items: [Tick | "footed", string][] = [
    ["traced", "traced to the server's response"],
    ["sample", "agrees with your sample"],
    ["near", "near your sample, with the reason"],
    ["footed", "footed to the source's total"],
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
