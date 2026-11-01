import Link from "next/link";
import type { ReactNode } from "react";

// Dapi's mark: a D whose bowl carries the auditor's tick.
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path d="M5 3.5h6.5a8.5 8.5 0 0 1 0 17H5z" fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" />
      <path d="M8.6 12.3l2.4 2.5 4.6-5.6" fill="none" stroke="var(--pencil-green)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TopBar({ crumb, actions }: { crumb?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-5 border-b bg-sheet px-4 sm:gap-7 sm:px-6 md:px-7">
      <Link href="/" className="flex items-center gap-2 rounded-sm">
        <Mark className="size-6" />
        <span className="condensed text-[21px] font-semibold tracking-[-0.01em]">Dapi</span>
      </Link>
      <nav aria-label="Main" className="flex min-w-0 items-center gap-5 text-[14px] font-medium">
        <Link href="/" className={crumb ? "text-ink-2 hover:text-ink" : "text-ink"}>
          Jobs
        </Link>
        {crumb && <span className="hidden truncate text-ink md:inline">{crumb}</span>}
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
    </header>
  );
}
