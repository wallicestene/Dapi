"use client";

import Avatar from "boring-avatars";
import { cn } from "@/lib/utils";

// A job's art: a Bauhaus composition (boring-avatars) in the mark's colours, drawn from
// the source's host, so jobs on the same site share it, then blurred into a field of
// colour that text sits on, under dark glass. Jobs that didn't deliver go grey.
const COLORS = ["#6a4cff", "#f12727", "#12b5a5", "#9ad82b", "#1d2c3a"];

export function JobArt({ seed, muted, className }: { seed: string; muted?: boolean; className?: string }) {
  return (
    <div aria-hidden className={cn("overflow-hidden bg-night", className)}>
      <div
        className={cn(
          "absolute inset-x-0 top-1/2 aspect-square -translate-y-1/2 scale-125 blur-[28px] saturate-[1.3] transition-transform duration-700 group-hover:scale-[1.4]",
          muted && "opacity-40 grayscale"
        )}
      >
        <Avatar name={seed} variant="bauhaus" colors={COLORS} square size="100%" />
      </div>
    </div>
  );
}

