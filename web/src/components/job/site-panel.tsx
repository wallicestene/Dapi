import { Fragment, type ReactNode } from "react";
import { Ban, ChevronRight, CircleDot, CornerLeftUp, Database, Download, Eye, FileSearch, FileText, FlaskConical, Gauge, Globe, Landmark, Layers, ListOrdered, MousePointerClick, Repeat, RotateCcw, Server, ShieldCheck, Sparkles, Table2, type LucideIcon } from "lucide-react";
import { TickMark } from "@/components/tick";
import { cn } from "@/lib/utils";
import type { Job, JobEvent } from "@/lib/types";
import { n } from "@/lib/steps";
import { Panel, Waiting, clock } from "./panel";

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, s.lastIndexOf(" ", max) > 20 ? s.lastIndexOf(" ", max) : max)}…`);

interface Req {
  method: string;
  url: string;
  payload: string | null;
}

// The investigation as it happened: what the page loaded, the feed Dapi chose instead
// of the visible page, the screenshot Muse Spark read to pick a control, and how the
// site answers from Apify's servers.
// The icon for each action, and which Meta model took it (the agent's tool calls are
// Muse Wonder's; choosing what to click and going up to the list are Muse Spark's).
const TOOL: Record<string, LucideIcon> = {
  web_search: Globe,
  look_at_page: Eye,
  click_and_watch: MousePointerClick,
  test_endpoint: FlaskConical,
  fetch_url: Download,
  search_page_source: FileSearch,
  map_page_fields: Table2,
  list_values: ListOrdered,
  open_record_page: FileText,
  call_register: Landmark,
  resume: RotateCcw,
};
const KIND: Record<string, LucideIcon> = {
  page: Globe,
  up: CornerLeftUp,
  source: Database,
  paging: Layers,
  pick: MousePointerClick,
  detail: FileText,
  robots: ShieldCheck,
  replay: Repeat,
  reach: Server,
  pace: Gauge,
  strategizing: Sparkles,
  strategy: Sparkles,
  declined: Ban,
};
function actor(e: JobEvent): { Icon: LucideIcon; model: "Muse Wonder" | "Muse Spark" | null } {
  if (e.kind === "agent") return { Icon: TOOL[e.tool as string] ?? Sparkles, model: "Muse Wonder" };
  if (e.kind === "strategizing" || e.kind === "strategy") return { Icon: Sparkles, model: "Muse Wonder" };
  if (e.kind === "pick" || e.kind === "up") return { Icon: KIND[e.kind], model: "Muse Spark" };
  return { Icon: KIND[e.kind] ?? CircleDot, model: null };
}

export function SitePanel({ job, events }: { job: Job; events: JobEvent[] }) {
  const site = events.filter((e) => e.step === "site" && e.kind !== "start");
  if (!site.length) return <Waiting>Dapi opens the page and watches its network traffic before reading any of it.</Waiting>;
  const source = site.find((e) => e.kind === "source");
  const detail = site.find((e) => e.kind === "detail");
  const pick = site.find((e) => e.kind === "pick" && e.chosen !== null);
  const page = site.find((e) => e.kind === "page");
  const declined = site.find((e) => e.kind === "declined");
  const reach = site.find((e) => e.kind === "reach");
  const strategy = [...site].reverse().find((e) => e.kind === "strategy");
  const live = job.status === "running" && job.step === "site";

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="flex flex-col gap-4">
        {strategy && <Strategy event={strategy} />}
        {declined && (
          <section className="rounded-xl border border-pencil-red/40 bg-red-wash px-5 py-4 text-red-ink">
            <h2 className="flex items-center gap-2 text-[16px] font-semibold">
              <TickMark tick="missing" /> {declined.text}
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px]">
              {(declined.reasons as string[]).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="mt-3 text-[14px]">Ways that do work: ask the source for an export or an official API, or use a register that publishes the same records openly.</p>
          </section>
        )}
        {source && (
          <Finding
            title={source.route === "embedded" || source.route === "html" ? "The records are in the page itself" : "Don't scrape the page: use its data feed"}
            req={source.route === "embedded" ? undefined : (source.request as Req)}
            lines={[
              source.route === "html"
                ? `${n(source.recordCount as number)} records in the page's own HTML. Dapi reads them from the page, checked against your sample.`
                : source.route === "embedded"
                ? `${n((source.recordCount as number) + (source.siblings as { recordCount: number }[]).reduce((t, s) => t + s.recordCount, 0))} rows are in data the page carries with it${(source.siblings as unknown[]).length ? `, across ${(source.siblings as unknown[]).length + 1} tables` : ""}. Dapi reads that data directly.`
                : `The same records the page shows, ${n(source.recordCount as number)} per request, straight from the site. Dapi reads this feed instead of the page.`,
              `Columns in it: ${(source.columns as string[]).join(", ")}.`,
            ]}
          />
        )}
        {detail && (
          <Finding
            title={detail.route === "page" ? "One page per record" : "The detail behind the click"}
            req={detail.request as Req | undefined}
            url={detail.url as string | undefined}
            lines={[
              detail.route === "page"
                ? `Each record has its own page. Dapi reads ${(detail.columns as string[]).join(", ")} from it, without a browser.`
                : `Clicking “${pick ? (pick.controls as string[])[pick.chosen as number] : "the control"}” loads this. Dapi loads it once per record instead of clicking, for ${(detail.columns as string[]).join(", ")}.`,
            ]}
          />
        )}

        <Panel title="What Dapi did" action={<span className="text-[12px] text-ink-2">{site.length} steps</span>}>
          {/* A timeline: an icon per action, and the Meta model that took it. Muse Wonder's
              own checks fold into one row each run of them: the outcome reads first, every
              step is a click away. */}
          <ol className="relative px-5 py-3 before:absolute before:top-5 before:bottom-5 before:left-[35px] before:w-px before:bg-rule">
            {timeline(site).map((item) =>
              Array.isArray(item) ? (
                <li key={item[0].n} className="relative">
                  <details className="group">
                    <summary className="grid cursor-pointer list-none grid-cols-[32px_minmax(0,1fr)_56px] items-start gap-3 py-1.5 text-[14px] [&::-webkit-details-marker]:hidden">
                      <Dot model="Muse Wonder" Icon={Sparkles} />
                      <span className="flex items-center gap-1 pt-1.5 leading-snug">
                        <ModelChip model="Muse Wonder" />
                        checked {item.length} {item.length === 1 ? "thing" : "things"} on the site to settle the plan
                        <ChevronRight aria-hidden className="size-3.5 text-ink-3 transition-transform group-open:rotate-90" />
                      </span>
                      <span className="pt-2 text-right text-[11.5px] text-ink-3 tabular-nums">{clock(item[0].at)}</span>
                    </summary>
                    <ol>
                      {item.map((e) => (
                        <Step key={e.n} e={e} host={job.sourceUrl} />
                      ))}
                    </ol>
                  </details>
                </li>
              ) : (
                <Step key={item.n} e={item} host={job.sourceUrl} />
              )
            )}
            {live && (
              <li className="relative grid grid-cols-[32px_minmax(0,1fr)] items-center gap-3 py-1.5 text-[14px] text-ink-2">
                <span className="relative grid size-8 place-items-center rounded-full border border-source/40 bg-[#f1eeff]">
                  <span aria-hidden className="size-2 animate-ping rounded-full bg-source" />
                </span>
                Still looking…
              </li>
            )}
          </ol>
        </Panel>

        {reach && (reach.results as unknown[]).length > 0 && (
          <Panel title="How the site answers Apify">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-2">
                  <th className="px-5 py-2 font-normal">Way</th>
                  <th className="px-3 py-2 font-normal">Asked for</th>
                  <th className="px-3 py-2 font-normal">Answer</th>
                  <th className="px-5 py-2 text-right font-normal">Time</th>
                </tr>
              </thead>
              <tbody>
                {(reach.results as { mode: string; label: string; status?: number; ms?: number; bytes?: number; works?: boolean; error?: string }[]).map((r, i) => (
                  <tr key={i} className="border-b border-rule last:border-0" title={r.error ?? (r.status ? `HTTP ${r.status}${r.bytes ? `, ${(r.bytes / 1024).toFixed(0)} KB` : ""}` : undefined)}>
                    <td className="px-5 py-2 first-letter:uppercase">{r.mode}</td>
                    <td className="px-3 py-2">{r.label}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <TickMark tick={r.works ? "traced" : "missing"} />
                        {r.works ? "works" : r.error ? "error" : "blocked"}
                      </span>
                    </td>
                    <td className="px-5 py-2 text-right">{r.ms === undefined ? "—" : `${r.ms.toLocaleString("en-US")} ms`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {pick?.image && (
          <Shot
            job={job}
            image={pick.image}
            caption={(pick.controls as string[])[pick.chosen as number].length <= 24 ? `Muse Spark read this screenshot and chose “${(pick.controls as string[])[pick.chosen as number]}” to open each record's details.` : "Muse Spark read this screenshot to find what opens each record's details."}
          />
        )}
        {/* The first look at the page, unless Muse Spark's screenshot of it is already here. */}
        {page?.image && !pick?.image && <Shot job={job} image={page.image} caption="The page as Dapi first opened it." />}
        {site
          .filter((e) => e.kind === "blocked" && e.image)
          .map((e) => (
            <Shot
              key={e.n}
              job={job}
              image={e.image!}
              caption={`What the site showed ${e.way === "direct" ? "on a direct visit" : `through Apify's ${e.way} proxy`}: ${(e.check as { what: string }).what}.`}
            />
          ))}
      </div>
    </div>
  );
}

// The timeline's rows: each finding on its own, each run of Muse Wonder's checks as one group.
function timeline(site: JobEvent[]): (JobEvent | JobEvent[])[] {
  const out: (JobEvent | JobEvent[])[] = [];
  for (const e of site) {
    const prev = out.at(-1);
    if (e.kind === "agent" && Array.isArray(prev)) prev.push(e);
    else out.push(e.kind === "agent" ? [e] : e);
  }
  return out;
}

function ModelChip({ model }: { model: "Muse Wonder" | "Muse Spark" }) {
  return <span className={cn("mr-0.5 inline-block rounded-full px-1.5 py-px align-[1px] text-[11px] font-semibold", model === "Muse Wonder" ? "bg-source/12 text-source" : "bg-deliver/15 text-[#0b6f65]")}>{model}</span>;
}

function Dot({ model, Icon, bad }: { model: "Muse Wonder" | "Muse Spark" | null; Icon: LucideIcon; bad?: boolean }) {
  return (
    <span className={cn("relative grid size-8 place-items-center rounded-full border bg-sheet", model === "Muse Wonder" && "border-source/40 bg-[#f1eeff] text-source", model === "Muse Spark" && "border-deliver/40 bg-[#e6f7f5] text-[#0b6f65]", bad && "border-pencil-red/40 bg-red-wash text-pencil-red")}>
      <Icon aria-hidden className="size-3.5" />
    </span>
  );
}

function Step({ e, host }: { e: JobEvent; host?: string }) {
  const { Icon, model } = actor(e);
  const text = String(e.text).replace(/^Muse Wonder (\(muse-wonder-[\d.]+\) )?/, "").replace(/ \(HTTP \d{3}\)/, "");
  return (
    <li className="relative grid grid-cols-[32px_minmax(0,1fr)_56px] items-start gap-3 py-1.5 text-[14px]">
      <Dot model={model} Icon={Icon} bad={e.kind === "declined"} />
      <span className={cn("pt-1.5 leading-snug", e.kind === "declined" && "text-pencil-red")}>
        {model && <ModelChip model={model} />} {readable(text, host)}
      </span>
      <span className="pt-2 text-right text-[11.5px] text-ink-3 tabular-nums">{clock(e.at)}</span>
    </li>
  );
}

// Web addresses in a step's text, shortened to what tells them apart: the path on the
// source's own site, host and path elsewhere. The whole address shows on hover.
function readable(text: string, source?: string): ReactNode {
  const home = source ? new URL(source).host : null;
  return text.split(/(https?:\/\/[^\s"“”,]+?)(?=[\s"“”,]|[.:;)]?(?:\s|$)|'s )/).map((part, i) => {
    if (!/^https?:\/\//.test(part)) return <Fragment key={i}>{part}</Fragment>;
    let short = part;
    try {
      const u = new URL(part);
      short = (u.host === home ? "" : u.host.replace(/^www\./, "")) + (u.pathname === "/" && u.host === home ? "the home page" : u.pathname);
    } catch {}
    return (
      <span key={i} title={part} className="font-mono text-[12.5px] text-ink-2">
        {clip(short, 56)}
      </span>
    );
  });
}

function Finding({ title, req, url, lines }: { title: string; req?: Req; url?: string; lines: string[] }) {
  return (
    <section className="rounded-xl border bg-sheet px-5 py-4">
      <h2 className="flex items-center gap-2 text-[16px] font-semibold">
        <TickMark tick="traced" /> {title}
      </h2>
      {(req || url) && (
        <p className="mt-2 rounded-md border bg-white px-3 py-2 font-mono text-[12px] break-all">
          {req ? (
            <>
              <span className="font-medium text-ink">{req.method}</span> {req.url}
              {req.payload && <span className="block text-ink-2">{req.payload.slice(0, 160)}</span>}
            </>
          ) : (
            url
          )}
        </p>
      )}
      {lines.map((l) => (
        <p key={l} className="mt-2 text-[14px] text-ink-2">
          {l}
        </p>
      ))}
    </section>
  );
}

function Shot({ job, image, caption }: { job: Job; image: string; caption: string }) {
  return (
    <figure className="overflow-hidden rounded-xl border bg-sheet">
      {/* eslint-disable-next-line @next/next/no-img-element -- a screenshot from the job's folder, served as is */}
      <img src={`/api/jobs/${job.id}/files/${image}`} alt={caption} className="block w-full border-b" />
      <figcaption className="px-4 py-2.5 text-[13px] text-ink-2">{caption}</figcaption>
    </figure>
  );
}

const ROUTE: Record<string, string> = {
  feed: "the site's data feed",
  embedded: "data embedded in the page",
  page: "the record's page",
  register: "the public register behind it",
  "shared-page": "one page per shared value",
  constant: "set by your spec",
  derived: "worked out from other fields",
  none: "no verified route",
};

interface StrategyColumn {
  column: string;
  renderedAt: string;
  route: string;
  how: string;
  evidence: string;
}

const PROXY = (proxy: string) => (/^direct/i.test(proxy) ? "straight to the site" : /residential/i.test(proxy) ? "through Apify's residential proxy" : "through Apify's datacenter proxy");

// The plan Muse Wonder made from every finding, in the client's words: what Dapi will
// read, the run's shape, where each column comes from, and anything left unsettled.
// Muse Wonder's own working (its reasoning, each column's exact route) folds away
// under Technical details, for whoever wants it.
function Strategy({ event }: { event: JobEvent }) {
  const columns = event.columns as StrategyColumn[];
  const requests = event.requests as { list: number; register: number; pages: number; total: number };
  const pace = event.pace as { concurrency: number; perMinute: number; proxy: string; why: string };
  const gaps = (event.gaps as string[]) ?? [];
  const raw = event.raw as { summary: string; gaps: string[]; risks: string[] } | undefined;
  return (
    <Panel title="The plan" action={<span className="text-[12px] text-ink-2">by {/spark/i.test(String(event.model)) ? "Muse Spark" : "Muse Wonder"}</span>}>
      <p className="px-5 pt-3 text-[15px] leading-relaxed">{event.text}</p>
      <p className="px-5 pt-2 text-[13px] text-ink-2">
        {[`${n(requests.total)} request${requests.total === 1 ? "" : "s"}`, `${pace.concurrency} at a time`, `about ${n(pace.perMinute)} a minute`, PROXY(pace.proxy)].join(" · ")}
      </p>
      <div className="mt-3 overflow-x-auto border-t">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b text-left text-[12px] text-ink-2">
              <th className="px-5 py-2 font-normal">Column</th>
              <th className="px-3 py-2 font-normal">Comes from</th>
              <th className="w-8 px-3 py-2 font-normal">
                <span className="sr-only">Checked</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {columns.map((c) => (
              <tr key={c.column} className="border-b border-rule align-top last:border-0">
                <td className="px-5 py-2 font-medium">{c.column}</td>
                <td className="px-3 py-2">{ROUTE[c.route] ?? c.route}</td>
                <td className="px-3 py-2">
                  <TickMark tick={c.route === "none" ? "missing" : /not verified/i.test(c.evidence) ? "near" : "traced"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {gaps.length > 0 && (
        <div className="border-t px-5 py-3">
          <p className="text-[13px] font-semibold">Not settled yet</p>
          <ul className="mt-1.5 flex flex-col gap-1 text-[13px] text-ink-2">
            {gaps.map((g) => (
              <li key={g} className="flex gap-2">
                <TickMark tick="near" className="mt-0.5" /> {g}
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="group border-t">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-5 py-2.5 text-[13px] font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className="size-3.5 transition-transform group-open:rotate-90" /> Technical details
        </summary>
        <div className="flex flex-col gap-3 px-5 pb-4 text-[13px] leading-relaxed text-ink-2">
          {raw?.summary && raw.summary !== event.text && <p>{raw.summary}</p>}
          <p>{pace.why}</p>
          <ul className="flex flex-col gap-1.5">
            {columns.map((c) => (
              <li key={c.column}>
                <span className="font-medium text-ink">{c.column}</span>: <span className="font-mono text-[12px] [overflow-wrap:anywhere]">{c.how}</span>
              </li>
            ))}
          </ul>
          {[...(raw?.risks ?? []), ...(raw?.gaps ?? [])].map((r) => (
            <p key={r}>{r}</p>
          ))}
        </div>
      </details>
    </Panel>
  );
}
