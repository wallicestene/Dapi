import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
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

const BUILT_WITH = ["Muse Spark", "Muse Wonder", "Muse Voice Transcribe"];

// The same footer on every page: what Dapi is, where to go, what it's built on, and the
// one rule it keeps. `fluid` lines it up with a full-width app screen (a job).
export function Footer({ readOnly = false, fluid = false }: { readOnly?: boolean; fluid?: boolean }) {
  const frame = fluid ? "w-full px-6 md:px-7" : "mx-auto w-full max-w-[1240px] px-5 sm:px-8";
  const links: [string, string][] = [
    ["How it works", "/#how"],
    ["Examples", "/#examples"],
    ["Jobs", "/jobs"],
    ...(readOnly ? [] : ([["Start a job", "/jobs/new"]] as [string, string][])),
  ];
  return (
    <footer className="mt-auto bg-night text-[#b8c0b9]">
      <div className={cn(frame, "grid gap-10 pt-14 pb-8 md:grid-cols-[minmax(0,1fr)_auto_auto] md:gap-16")}>
        <div className="flex flex-col gap-3">
          <Link href="/" className="flex items-center gap-2 self-start rounded-sm text-white">
            <Mark className="size-7" />
            <span className="text-[23px] font-bold tracking-[-0.04em]">Dapi</span>
          </Link>
          <p className="max-w-[300px] text-[15px] leading-relaxed">Web data you can prove. Send a spec, get the dataset, with a receipt for every value.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-col gap-2.5 text-[14px]">
          <p className="mb-1 text-[12px] font-semibold tracking-[0.04em] text-white uppercase">Product</p>
          {links.map(([label, href]) => (
            <Link key={href} href={href} className="hover:text-white">
              {label}
            </Link>
          ))}
          <a href="https://github.com/wallicestene/Dapi" target="_blank" rel="noreferrer" className="hover:text-white">
            Source code
          </a>
        </nav>
        <div className="flex flex-col gap-2.5 text-[14px]">
          <p className="mb-1 text-[12px] font-semibold tracking-[0.04em] text-white uppercase">Built with</p>
          {BUILT_WITH.map((m) => (
            <span key={m}>Meta {m}</span>
          ))}
          <a href="https://apify.com" target="_blank" rel="noreferrer" className="hover:text-white">
            Apify
          </a>
        </div>
      </div>
      <div className={frame}>
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-white/10 py-5 text-[13px]">
          <span>© 2026 Dapi</span>
          <span className="sm:ml-auto">Public data only. No logins, no paywalls, no CAPTCHA solving.</span>
        </div>
      </div>
    </footer>
  );
}
