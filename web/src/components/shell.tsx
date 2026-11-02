import Link from "next/link";
import type { ReactNode } from "react";
import { Mark } from "./mark";

export { Mark };

// The mark and the name, linking home.
export function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2 rounded-sm">
      <Mark className="size-6" />
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
