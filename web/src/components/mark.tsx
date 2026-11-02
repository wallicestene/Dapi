"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

// Dapi's mark: a D in four parts, one per stage of a job. The stem is the source, the
// top arc the extraction, the bottom arc the delivery, and the tick (verified) is where
// one ends and the other begins. The tick's halo is cut out of the arcs with a mask, so
// the mark sits on any background with clean, solid edges; the cut follows the tick's
// own V into the bowl. `lit` shows a job's progress: stages after it take `dim`, and
// `now` breathes.
const STEM = "M14 50V14";
const SPLIT = "46.70 21.61"; // where the tick crosses the bowl
const EXTRACT = `M23 14H32A18 18 0 0 1 ${SPLIT}`;
const DELIVER = `M${SPLIT}A18 18 0 0 1 32 50H23`;
const TICK = "M27 36.5L32.5 42L52 14";

export function Mark({ className, draw = false, lit = 4, now, dim = "var(--active)", label }: { className?: string; draw?: boolean; lit?: number; now?: number; dim?: string; label?: string }) {
  const id = `mark-${useId().replace(/:/g, "")}`;
  const small = className?.match(/size-(\d+)/)?.[1];
  const tight = small !== undefined && Number(small) <= 8; // 32 px and under: heavier strokes
  const part = (n: number, color: string) => ({
    stroke: lit >= n ? color : dim,
    className: cn(["mark-source", "mark-extract", "mark-deliver", "mark-tick"][n - 1], now === n && "mark-now"),
  });
  return (
    <svg viewBox="4 4 56 56" shapeRendering="geometricPrecision" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn(draw && "mark-draw", className)}>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
        <rect width="64" height="64" fill="#fff" />
        <path d={TICK} pathLength={1} stroke="#000" strokeWidth={tight ? 13.5 : 13} strokeLinecap="round" strokeLinejoin="round" fill="none" className="mark-tick" />
      </mask>
      <g mask={`url(#${id})`} fill="none" strokeWidth={tight ? 12 : 11}>
        <path d={STEM} pathLength={1} strokeLinecap="round" {...part(1, "var(--source)")} />
        <path d={EXTRACT} pathLength={1} {...part(2, "var(--extract)")} />
        <path d={DELIVER} pathLength={1} {...part(3, "var(--deliver)")} />
      </g>
      {lit >= 4 && <path d={TICK} pathLength={1} strokeWidth={tight ? 8.5 : 7} strokeLinecap="round" strokeLinejoin="round" fill="none" {...part(4, "var(--verified)")} />}
    </svg>
  );
}
