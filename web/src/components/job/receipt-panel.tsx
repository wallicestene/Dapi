"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TICK_TEXT, TickMark } from "@/components/tick";
import type { Job, JobEvent, Located, Receipt } from "@/lib/types";
import type { Selection } from "./data-sheet";

export function ReceiptPanel({ job, events, selected, translatedFrom, readOnly = false }: { job: Job; events: JobEvent[]; selected: Selection | null; translatedFrom?: string | null; readOnly?: boolean }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const cell = selected?.cell;

  useEffect(() => {
    setReceipt(null);
    if (!cell?.evidence) return setState("idle");
    setState("loading");
    // The job tells the server which fields this receipt may show.
    const params = new URLSearchParams({ key: cell.evidence, job: job.id });
    for (const p of cell.paths ?? []) params.append("path", p);
    let alive = true;
    fetch(`/api/evidence?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((r: Receipt) => alive && (setReceipt(r), setState("idle")))
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, [cell, job.id]);

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
      <aside aria-label="Receipt" className="rounded-xl border bg-sheet lg:sticky lg:top-4">
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
      <section className="rounded-xl border bg-sheet px-5 py-4">
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
                  {receipt.via && receipt.via !== "direct" ? ` through Apify's ${receipt.via.replace(/^Apify Proxy /i, "").toLowerCase()} proxy` : ""}.
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
        <section className="rounded-xl border bg-sheet px-5 py-4">
          <h2 className="text-[13px] font-semibold text-ink-2">The server&apos;s own words</h2>
          {state === "loading" && (
            <div className="mt-3 flex h-40 items-center justify-center rounded-md bg-raised px-4 text-center text-[13px] text-ink-2">
              Fetching the response Dapi kept when it read this value…
            </div>
          )}
          {state === "error" && <p className="mt-2 text-[13px] text-pencil-red">Couldn&apos;t load this receipt. The evidence store may be unreachable; try again.</p>}
          {receipt && (
            <>
              <p className="mt-2.5 font-mono text-[11.5px] leading-relaxed break-all text-ink-2">
                <span className="mr-1.5 rounded bg-deliver/15 px-1.5 py-0.5 font-semibold text-[#0b6f65]">{receipt.request.method}</span>
                {receipt.request.url}
                {receipt.request.payload ? <><br />{receipt.request.payload.slice(0, 200)}</> : null}
              </p>
              {receipt.located.map((l) => (
                <Evidence key={l.path} located={l} evidenceKey={receipt.key} jobId={job.id} />
              ))}
              <Seal receipt={receipt} readOnly={readOnly} />
            </>
          )}
        </section>
      )}
    </aside>
  );
}

// Where a delivered value parts from the spec's sample: the same short stretch of each,
// so a one-space difference in a 300-character legal reference is visible at once.
function Difference({ label, expected, actual, why, belongsTo }: { label: string; expected: string; actual: string; why: "spacing" | "typo" | "column" | "site" | "dispute" | null; belongsTo?: string }) {
  if (why === "site" || why === "dispute") {
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
function Evidence({ located, evidenceKey, jobId }: { located: Located; evidenceKey: string; jobId: string }) {
  if (located.kind === "html") {
    const src = `/api/evidence/page?key=${evidenceKey}&job=${jobId}&path=${encodeURIComponent(located.path)}`;
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
      {/* The record as the server sent it, cut to the fields this job delivers, the
          value's line lit in lime. */}
      <pre className="max-h-72 overflow-auto rounded-lg bg-night px-3.5 py-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-[#c3cbc6]">
        {lines.map((line, i) => {
          const [, indent, key, rest] = line.match(/^(\s*)("[^"]*":)?(.*)$/) ?? [null, "", "", line];
          return isMarked(line, i) ? (
            <span key={i} className="relative -mx-3.5 block bg-verified px-3.5 font-medium text-night">
              <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-night/30" />
              {line}
            </span>
          ) : (
            <span key={i} className="block">
              {indent}
              {key && <span className="text-[#8fa4b8]">{key}</span>}
              <span className="text-[#e6e9da]">{rest}</span>
            </span>
          );
        })}
      </pre>
      {(located.hidden ?? 0) > 0 && (
        <figcaption className="mt-1.5 text-[12px] text-ink-2">
          {located.hidden} other field{located.hidden === 1 ? "" : "s"} the site sent {located.hidden === 1 ? "isn't" : "aren't"} shown: a receipt shows only what the job delivers.
        </figcaption>
      )}
    </figure>
  );
}

// The SHA-256 recorded at capture, re-computed from the body as the server sent it: by
// your browser where you run Dapi, by the server on the public copy, which never hands
// out a whole response (it holds fields the job doesn't deliver).
function Seal({ receipt, readOnly }: { receipt: Receipt; readOnly: boolean }) {
  const [check, setCheck] = useState<"idle" | "checking" | "match" | "mismatch" | "error">("idle");
  const recheck = async () => {
    setCheck("checking");
    try {
      if (readOnly) {
        const { matches } = await (await fetch(`/api/evidence/verify?key=${receipt.key}`)).json();
        return setCheck(matches ? "match" : "mismatch");
      }
      const res = await fetch(`/api/evidence/body?key=${receipt.key}`);
      // A copy that doesn't hand out whole responses checks the seal itself.
      if (res.status === 403) {
        const { matches } = await (await fetch(`/api/evidence/verify?key=${receipt.key}`)).json();
        return setCheck(matches ? "match" : "mismatch");
      }
      const body = await res.text();
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
          <p className="flex items-start gap-2 rounded-lg bg-verified/25 px-3 py-2 text-green-ink">
            <ShieldCheck aria-hidden className="mt-px size-4 shrink-0" />
            <span>
              <b className="font-semibold">Seal verified.</b> {readOnly ? "The stored response, hashed again" : "Your browser re-hashed the response"}: byte for byte what was captured.
            </span>
          </p>
        ) : check === "mismatch" ? (
          <p className="text-pencil-red">The body no longer matches its seal.</p>
        ) : (
          <Button type="button" variant="outline" onClick={recheck} disabled={check === "checking"} className="h-8 gap-1.5 px-3 text-[12.5px]">
            <ShieldCheck aria-hidden className={check === "checking" ? "animate-pulse" : undefined} />
            {check === "checking" ? "Re-checking…" : check === "error" ? "Couldn't fetch the body; try again" : "Re-check the seal"}
          </Button>
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
