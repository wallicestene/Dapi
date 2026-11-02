import { Ban, CircleDot, CornerLeftUp, Database, Download, Eye, FileSearch, FileText, FlaskConical, Gauge, Globe, Landmark, Layers, ListOrdered, MousePointerClick, Repeat, RotateCcw, Server, ShieldCheck, Sparkles, Table2, type LucideIcon } from "lucide-react";
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
            title={source.route === "embedded" ? "The records are in the page itself" : "Don't parse the page: call this"}
            req={source.route === "embedded" ? undefined : (source.request as Req)}
            lines={[
              source.route === "embedded"
                ? `${n((source.recordCount as number) + (source.siblings as { recordCount: number }[]).reduce((t, s) => t + s.recordCount, 0))} rows sit in data embedded in the HTML${(source.siblings as unknown[]).length ? `, split across ${(source.siblings as unknown[]).length + 1} tables` : ""}. Dapi reads them directly instead of parsing the visible page.`
                : `Returns ${n(source.recordCount as number)} records as JSON: the list the page shows, at the source. Dapi calls it directly instead of parsing the page.`,
              `Holds ${(source.columns as string[]).join(", ")}.`,
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
                ? `Each record links to its own page; Dapi fetches it without a browser and reads ${(detail.columns as string[]).join(", ")} from it.`
                : `Clicking “${pick ? (pick.controls as string[])[pick.chosen as number] : "the control"}” makes the page call this${(detail.join as { param: string } | null) ? `, keyed by ${(detail.join as { param: string }).param}` : ""}. Dapi calls it once per record instead of clicking, for ${(detail.columns as string[]).join(", ")}.`,
            ]}
          />
        )}

        <Panel title="What Dapi did" action={<span className="text-[12px] text-ink-2">{site.filter((e) => e.kind === "agent").length} agent steps</span>}>
          {/* A timeline: an icon per action, and the Meta model that took it. */}
          <ol className="relative px-5 py-3 before:absolute before:top-5 before:bottom-5 before:left-[35px] before:w-px before:bg-rule">
            {site.map((e) => {
              const { Icon, model } = actor(e);
              return (
                <li key={e.n} className="relative grid grid-cols-[32px_minmax(0,1fr)_56px] items-start gap-3 py-1.5 text-[14px]">
                  <span className={cn("relative grid size-8 place-items-center rounded-full border bg-sheet", model === "Muse Wonder" && "border-source/40 bg-[#f1eeff] text-source", model === "Muse Spark" && "border-deliver/40 bg-[#e6f7f5] text-[#0b6f65]", e.kind === "declined" && "border-pencil-red/40 bg-red-wash text-pencil-red")}>
                    <Icon aria-hidden className="size-3.5" />
                  </span>
                  <span className={cn("pt-1.5 leading-snug", e.kind === "declined" && "text-pencil-red")}>
                    {model && <span className={cn("mr-1.5 inline-block rounded-full px-1.5 py-px align-[1px] text-[11px] font-semibold", model === "Muse Wonder" ? "bg-source/12 text-source" : "bg-deliver/15 text-[#0b6f65]")}>{model}</span>}
                    {model === "Muse Wonder" ? String(e.text).replace(/^Muse Wonder (\(muse-wonder-[\d.]+\) )?/, "") : e.text}
                  </span>
                  <span className="pt-2 text-right text-[11.5px] text-ink-3 tabular-nums">{clock(e.at)}</span>
                </li>
              );
            })}
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
          <Panel title="From Apify's servers">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-2">
                  <th className="px-5 py-2 font-normal">Way</th>
                  <th className="px-3 py-2 font-normal">Request</th>
                  <th className="px-3 py-2 text-right font-normal">Status</th>
                  <th className="px-3 py-2 text-right font-normal">Time</th>
                  <th className="px-5 py-2 text-right font-normal">Size</th>
                </tr>
              </thead>
              <tbody>
                {(reach.results as { mode: string; label: string; status?: number; ms?: number; bytes?: number; works?: boolean; error?: string }[]).map((r, i) => (
                  <tr key={i} className="border-b border-rule last:border-0">
                    <td className="px-5 py-2">{r.mode}</td>
                    <td className="px-3 py-2">{r.label}</td>
                    <td className="px-3 py-2 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        {r.error ? "error" : r.status}
                        <TickMark tick={r.works ? "traced" : "missing"} />
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{r.ms === undefined ? "—" : `${r.ms.toLocaleString("en-US")} ms`}</td>
                    <td className="px-5 py-2 text-right">{r.bytes === undefined ? "—" : `${(r.bytes / 1024).toFixed(0)} KB`}</td>
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
            caption={`What Muse Spark saw when it chose “${(pick.controls as string[])[pick.chosen as number]}” for ${clip(String(pick.record), 44)}. Its reason: ${pick.reason}`}
          />
        )}
        {page?.image && <Shot job={job} image={page.image} caption={`The page as Dapi first opened it, HTTP ${page.status}.`} />}
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

// The plan Muse Wonder made from every finding: each column's route, and the run's shape.
function Strategy({ event }: { event: JobEvent }) {
  const columns = event.columns as StrategyColumn[];
  const requests = event.requests as { list: number; register: number; pages: number; total: number };
  const pace = event.pace as { concurrency: number; perMinute: number; proxy: string; why: string };
  const gaps = (event.gaps as string[]) ?? [];
  return (
    <Panel title="The strategy" action={<span className="text-[12px] text-ink-2">planned by {/spark/i.test(String(event.model)) ? "Muse Spark" : "Muse Wonder"}</span>}>
      <p className="px-5 pt-3 text-[14px] leading-relaxed">{event.text}</p>
      <p className="px-5 pt-2 text-[13px] text-ink-2">
        {requests.total.toLocaleString("en-US")} requests ({[requests.list && `${requests.list} list`, requests.register && `${requests.register} register`, requests.pages && `${requests.pages} pages`].filter(Boolean).join(", ")}), {pace.concurrency} at a time, about {pace.perMinute} a minute, {pace.proxy}. {pace.why}
      </p>
      <div className="mt-3 overflow-x-auto border-t">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b text-left text-[12px] text-ink-2">
              <th className="px-5 py-2 font-normal">Column</th>
              <th className="px-3 py-2 font-normal">Where the site shows it</th>
              <th className="px-3 py-2 font-normal">How Dapi gets it</th>
              <th className="w-8 px-3 py-2 font-normal">
                <span className="sr-only">Evidence</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {columns.map((c) => (
              <tr key={c.column} className="border-b border-rule align-top last:border-0">
                <td className="px-5 py-2 font-medium">{c.column}</td>
                <td className="px-3 py-2 text-ink-2">{c.renderedAt}</td>
                <td className="px-3 py-2" title={c.how}>
                  {ROUTE[c.route] ?? c.route}
                </td>
                <td className="px-3 py-2" title={c.evidence}>
                  <TickMark tick={c.route === "none" ? "missing" : /not verified/i.test(c.evidence) ? "near" : "traced"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {gaps.length > 0 && <p className="border-t px-5 py-2.5 text-[13px] text-pencil-red">Gaps: {gaps.join("; ")}</p>}
    </Panel>
  );
}
