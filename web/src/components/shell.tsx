import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Dapi's mark: a D in four parts, one per stage of a job. The stem is the source, the
// top arc the extraction, the bottom arc the delivery, and the tick (verified) is where
// one ends and the other begins. The tick's halo takes the background colour (`bg`).
// `lit` shows a job's progress: stages after it are grey, and `now` breathes.
const STEM = "M14 50V14";
const EXTRACT = "M23 14H32A18 18 0 0 1 46.36 21.15";
const DELIVER = "M46.36 21.15A18 18 0 0 1 32 50H23";
const TICK = "M26.5 34.5L31.5 40L52 14";

export function Mark({
  className,
  bg = "var(--sheet)",
  draw = false,
  lit = 4,
  now,
  dim = "var(--active)",
  label,
}: {
  className?: string;
  bg?: string;
  draw?: boolean;
  lit?: number;
  now?: number;
  dim?: string;
  label?: string;
}) {
  const small = className?.match(/size-(\d+)/)?.[1];
  const tight = small !== undefined && Number(small) <= 8; // 32 px and under: heavier strokes
  const w = tight ? 12 : 11;
  const part = (n: number, color: string) => ({
    stroke: lit >= n ? color : dim,
    className: cn(["mark-source", "mark-extract", "mark-deliver", "mark-tick"][n - 1], now === n && "mark-now"),
  });
  return (
    <svg viewBox="4 4 56 56" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn(draw && "mark-draw", className)}>
      <path d={STEM} pathLength={1} strokeWidth={w} strokeLinecap="round" fill="none" {...part(1, "var(--source)")} />
      <path d={EXTRACT} pathLength={1} strokeWidth={w} fill="none" {...part(2, "var(--extract)")} />
      <path d={DELIVER} pathLength={1} strokeWidth={w} fill="none" {...part(3, "var(--deliver)")} />
      <path d={TICK} pathLength={1} stroke={bg} strokeWidth={tight ? 13.5 : 13} strokeLinecap="round" strokeLinejoin="round" fill="none" className="mark-tick" />
      {lit >= 4 && <path d={TICK} pathLength={1} strokeWidth={tight ? 8.5 : 7} strokeLinecap="round" strokeLinejoin="round" fill="none" {...part(4, "var(--verified)")} />}
    </svg>
  );
}

// The mark and the name, linking home.
export function Wordmark({ bg }: { bg?: string }) {
  return (
    <Link href="/" className="flex items-center gap-2 rounded-sm">
      <Mark className="size-6" bg={bg} />
      <span className="text-[21px] font-bold tracking-[-0.04em]">Dapi</span>
    </Link>
  );
}

export function TopBar({ crumb, actions }: { crumb?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-5 border-b bg-sheet px-4 sm:gap-7 sm:px-6 md:px-7">
      <Wordmark />
      <nav aria-label="Main" className="flex min-w-0 items-center gap-5 text-[14px] font-medium">
        <Link href="/jobs" className={crumb ? "text-ink-2 hover:text-ink" : "text-ink"}>
          Jobs
        </Link>
        {crumb && <span className="hidden truncate text-ink md:inline">{crumb}</span>}
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
    </header>
  );
}
