import type { ReactNode } from "react";

export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border bg-sheet">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-2.5">
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Waiting({ children }: { children: ReactNode }) {
  return (
    <section className="flex items-center gap-3 rounded-lg border bg-sheet px-5 py-4 text-[14px] text-ink-2">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-ink" />
      {children}
    </section>
  );
}

export const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
