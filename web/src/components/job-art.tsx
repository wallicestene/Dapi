import { cn } from "@/lib/utils";
import type { DataShape } from "@/lib/types";

// A job's art is its own data: the table, zoomed out. Each line is a row, each column a
// slot sized to its longest value, each value a bar as long as the value, a dot where
// the site left it blank, in the mark's four colours in turn. No two jobs match, and a
// job with no rows yet shows its empty table: the spec's columns, waiting.
const TONE = ["var(--source)", "var(--extract)", "var(--deliver)", "var(--verified)"];
const H = 268;
const PAD = 18;
const GAP = 8;
const BAR = 4;
const LEAD = 7;

export function JobArt({ shape, muted, ratio = 400 / 268, className }: { shape: DataShape | null; muted?: boolean; ratio?: number; className?: string }) {
  const W = Math.round(H * ratio);
  const columns = shape?.columns ?? 0;
  const rows = shape?.rows.length ? shape.rows : Array.from({ length: 30 }, () => Array<number>(columns).fill(0));
  const longest = Array.from({ length: columns }, (_, i) => Math.max(1, ...rows.map((r) => r[i])));
  const weight = longest.map((l) => Math.min(4, Math.max(1, l / 12)));
  const total = weight.reduce((a, b) => a + b, 0);
  const room = W - PAD * 2 - GAP * (columns - 1);
  const slots = weight.reduce<[number, number][]>((acc, w) => {
    const x = acc.length ? acc[acc.length - 1][0] + acc[acc.length - 1][1] + GAP : PAD;
    return [...acc, [x, (room * w) / total]];
  }, []);
  return (
    <div aria-hidden className={cn("overflow-hidden bg-night", className)}>
      {columns > 0 && (
        // The rows fade out before the card's glass, so the text sits on plain night.
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMinYMin slice" className={cn("absolute inset-0 size-full [mask-image:linear-gradient(to_bottom,#000_38%,transparent_66%)]", muted && "opacity-40 grayscale")}>
          {rows.map((row, y) =>
            row.map((length, i) =>
              length ? (
                <rect key={`${y}-${i}`} x={slots[i][0]} y={PAD + y * LEAD} width={Math.max(BAR, (slots[i][1] * length) / longest[i])} height={BAR} rx={2} fill={TONE[i % 4]} />
              ) : (
                <circle key={`${y}-${i}`} cx={slots[i][0] + 2} cy={PAD + y * LEAD + 2} r={1.3} fill="#3a4a58" />
              )
            )
          )}
        </svg>
      )}
    </div>
  );
}
