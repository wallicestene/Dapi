"use client";

import { useEffect, useState } from "react";
import { TICK_TEXT, TickMark } from "@/components/tick";
import type { Job, JobEvent, Located, Receipt } from "@/lib/types";
import type { Selection } from "./data-sheet";

export function ReceiptPanel({ job, events, selected, translatedFrom }: { job: Job; events: JobEvent[]; selected: Selection | null; translatedFrom?: string | null }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const cell = selected?.cell;

  useEffect(() => {
    setReceipt(null);
    if (!cell?.evidence) return setState("idle");
    setState("loading");
    const params = new URLSearchParams({ key: cell.evidence });
    for (const p of cell.paths ?? []) params.append("path", p);
    let alive = true;
    fetch(`/api/evidence?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((r: Receipt) => alive && (setReceipt(r), setState("idle")))
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, [cell]);

  if (!selected || !cell) {
    // Before a value is picked: what stands behind the whole dataset.
    const footed = events.find((e) => e.kind === "footed");
    const started = events.find((e) => e.kind === "started");
    const reach = events.find((e) => e.kind === "reach");
    const robots = [...events].reverse().find((e) => e.kind === "robots");
    const facts: [string, string][] = [
      ["Source", job.sourceUrl ? new URL(job.sourceUrl).host : "—"],
      ["Responses kept as evidence", footed ? (footed.captures as number).toLocaleString("en-US") : "counted at the end"],
      ["Fetched", reach?.recommendation && reach.recommendation !== "direct" ? `through Apify's ${reach.recommendation} proxy` : "directly, from Apify's servers"],
      ["robots.txt", robots ? (robots.allowed ? "allows these requests" : "disallows some; see the plan") : "—"],
      ["Captured", started ? `from ${when(started.at)}` : "—"],
    ];
    return (
      <aside aria-label="Receipt" className="rounded-lg border bg-sheet lg:sticky lg:top-4">
        <div className="px-5 pt-4 pb-3">
          <h2 className="text-[13px] font-semibold text-ink-2">Receipt</h2>
          <p className="mt-2 text-[14px] leading-relaxed">
            Pick any value to see where it came from: the request Dapi made, the server&apos;s own words, when they were captured, and a seal your browser re-checks.
          </p>
        </div>
        <dl className="divide-y divide-rule border-t border-rule text-[13px]">
          {facts.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-5 py-2.5">
              <dt className="text-ink-2">{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </aside>
    );
  }

  return (
    <aside aria-label="Receipt" className="flex flex-col gap-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-15rem)] lg:overflow-y-auto">
      <section className="rounded-lg border bg-sheet px-5 py-4">
        <h2 className="text-[13px] font-semibold text-ink-2">
          Row {selected.row + 1} · {selected.column}
        </h2>
        <p className="mt-2 text-[15px] leading-normal break-words">{cell.value || <span className="text-ink-3">Blank</span>}</p>
        <ul className="mt-3 divide-y divide-rule border-t border-rule text-[13px] [overflow-wrap:anywhere]">
          {cell.tick !== "spec" && cell.tick !== "blank" && cell.evidence && (
            <Line tick="traced">
              {receipt ? (
                <>
                  Traced to {receipt.request.method} {shortUrl(receipt.request.url)}, captured {when(receipt.capturedAt)}
                  {receipt.via && receipt.via !== "direct" ? ` through Apify's ${receipt.via} proxy` : ""}.
                </>
              ) : (
                TICK_TEXT.traced
              )}
            </Line>
          )}
          {cell.original && (
            <li className="flex gap-2.5 py-2">
              <span className="mt-0.5 w-3 shrink-0" />
              <span>
                Translated by Muse Spark{translatedFrom ? ` from ${translatedFrom}` : ""}, the way your samples are written. The site says <q>{cell.original}</q>, and that&apos;s what the evidence below holds.
              </span>
            </li>
          )}
          {cell.sample && (cell.tick === "sample" || cell.tick === "near" || cell.tick === "fail") && (
            <Line tick={cell.tick}>
              {cell.tick === "sample"
                ? `Agrees with ${cell.sample.label} in your spec.`
                : (
                  <Difference label={cell.sample.label} expected={cell.sample.expected} actual={cell.value} why={cell.tick === "near" ? cell.sample.why ?? "spacing" : null} belongsTo={cell.sample.belongsTo} />
                )}
            </Line>
          )}
          {cell.tick === "missing" && <Line tick="missing">{cell.reason ?? "This value never arrived."}</Line>}
          {cell.tick === "spec" && <li className="py-2 text-ink-2">Set by your spec for every row; nothing to trace.</li>}
          {cell.tick === "blank" && <li className="py-2 text-ink-2">The source has no value here, so the cell is blank.</li>}
        </ul>
      </section>

      {cell.evidence && (
        <section className="rounded-lg border bg-sheet px-5 py-4">
          <h2 className="text-[13px] font-semibold text-ink-2">The server&apos;s own words</h2>
          {state === "loading" && (
            <div className="mt-3 flex h-40 items-center justify-center rounded-md bg-raised px-4 text-center text-[13px] text-ink-2">
              Fetching the response Dapi kept when it read this value…
            </div>
          )}
          {state === "error" && <p className="mt-2 text-[13px] text-pencil-red">Couldn&apos;t load this receipt. The evidence store may be unreachable; try again.</p>}
          {receipt && (
            <>
              <p className="mt-2 font-mono text-[11.5px] leading-relaxed break-all text-ink-2">
                {receipt.request.method} {receipt.request.url}
                {receipt.request.payload ? <><br />{receipt.request.payload.slice(0, 200)}</> : null}
              </p>
              {receipt.located.map((l) => (
                <Evidence key={l.path} located={l} evidenceKey={receipt.key} />
              ))}
              <Seal receipt={receipt} />
            </>
          )}
        </section>
      )}
    </aside>
  );
}

// Where a delivered value parts from the spec's sample: the same short stretch of each,
// so a one-space difference in a 300-character legal reference is visible at once.
function Difference({ label, expected, actual, why, belongsTo }: { label: string; expected: string; actual: string; why: "spacing" | "typo" | "column" | "site" | null; belongsTo?: string }) {
  if (why === "site") {
    return (
      <>
        {label} in your spec has <q>{expected}</q>, but the site shows <q>{actual}</q> for this record. Dapi delivers what the site shows.
      </>
    );
  }
  if (why === "column") {
    return (
      <>
        {label} in your spec has <q>{expected}</q> under this column, but on the site that value is the record&apos;s {belongsTo}: it was typed under the wrong column. Dapi delivers each column as the site has it.
      </>
    );
  }
  let i = 0;
  while (i < expected.length && i < actual.length && expected[i] === actual[i]) i++;
  const from = Math.max(0, i - 18);
  const clip = (s: string) => `${from > 0 ? "…" : ""}${s.slice(from, i + 18)}${s.length > i + 18 ? "…" : ""}`;
  return (
    <>
      {label} in your spec writes <q className="font-mono text-[12px]">{clip(expected)}</q>; the source has <q className="font-mono text-[12px]">{clip(actual)}</q>.{" "}
      {why === "spacing" ? "Only the spacing differs, so the value is delivered as the source has it." : why === "typo" ? "That looks like a slip in the spec, so the value is delivered as the source spells it." : "Delivered as the source has it."}
    </>
  );
}

function Line({ tick, children }: { tick: Parameters<typeof TickMark>[0]["tick"]; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 py-2">
      <span className="mt-0.5">
        <TickMark tick={tick} />
      </span>
      <span>{children}</span>
    </li>
  );
}

// The place in the evidence a value came from, with that line marked.
function Evidence({ located, evidenceKey }: { located: Located; evidenceKey: string }) {
  if (located.kind === "html") {
    const src = `/api/evidence/page?key=${evidenceKey}&path=${encodeURIComponent(located.path)}`;
    return (
      <figure className="mt-3">
        <iframe title="The captured page, with the element outlined" src={src} sandbox="" className="h-72 w-full rounded-md border bg-white" />
        <figcaption className="mt-1.5 text-[12px] text-ink-2">The page as captured, scripts removed; the element the value came from is outlined.</figcaption>
      </figure>
    );
  }
  const container = located.kind === "embedded" ? located.row : located.record;
  const markKey = located.kind === "embedded" ? located.cell : located.key;
  const lines = JSON.stringify(container ?? located.value, null, 2)?.split("\n") ?? [];
  const isMarked = (line: string, i: number) =>
    Array.isArray(container) ? i === Number(markKey) + 1 : line.trimStart().startsWith(`"${markKey}":`);
  return (
    <figure className="mt-3">
      {located.kind === "embedded" && located.context && (
        <figcaption className="mb-1.5 text-[12px] text-ink-2">A row of the table embedded in the page after …{located.context.slice(-48)}</figcaption>
      )}
      <pre className="max-h-72 overflow-auto rounded-md border bg-white px-3 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-2">
        {lines.map((line, i) => (
          <span key={i} className={isMarked(line, i) ? "-mx-3 block bg-green-wash px-3 text-green-ink" : "block"}>
            {line}
          </span>
        ))}
      </pre>
    </figure>
  );
}

// The SHA-256 recorded at capture, re-computed here from the body as the server sent it.
function Seal({ receipt }: { receipt: Receipt }) {
  const [check, setCheck] = useState<"idle" | "checking" | "match" | "mismatch" | "error">("idle");
  const recheck = async () => {
    setCheck("checking");
    try {
      const body = await (await fetch(`/api/evidence/body?key=${receipt.key}`)).text();
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""); // taste-skill-ignore: hex bytes
      setCheck(hex === receipt.bodySha256 ? "match" : "mismatch");
    } catch {
      setCheck("error");
    }
  };
  return (
    <div className="mt-3 border-t border-rule pt-3 text-[13px]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-ink-2">Seal (SHA-256)</span>
        <code className="font-mono text-[12px]" title={receipt.bodySha256}>
          {receipt.bodySha256.slice(0, 10)}…{receipt.bodySha256.slice(-8)}
        </code>
      </div>
      <div className="mt-2 flex items-center gap-2">
        {check === "match" ? (
          <p className="flex items-center gap-1.5 text-pencil-green">
            <TickMark tick="traced" /> Re-checked in your browser: the response is byte for byte what was captured.
          </p>
        ) : check === "mismatch" ? (
          <p className="text-pencil-red">The body no longer matches its seal.</p>
        ) : (
          <button type="button" onClick={recheck} disabled={check === "checking"} className="rounded-md border border-control bg-white px-2.5 py-1 text-[12px] font-medium hover:bg-raised">
            {check === "checking" ? "Re-checking…" : check === "error" ? "Couldn't fetch the body; try again" : "Re-check the seal"}
          </button>
        )}
      </div>
      <p className="mt-2 text-[12px] text-ink-2">
        {(receipt.bodyBytes / 1024).toFixed(1)} KB, HTTP {receipt.response.status}, captured {when(receipt.capturedAt)}
      </p>
    </div>
  );
}

const shortUrl = (u: string) => {
  const url = new URL(u);
  return `${url.host}${url.pathname.length > 40 ? `${url.pathname.slice(0, 38)}…` : url.pathname}`;
};
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
