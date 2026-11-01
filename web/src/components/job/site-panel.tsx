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
export function SitePanel({ job, events }: { job: Job; events: JobEvent[] }) {
  const site = events.filter((e) => e.step === "site" && e.kind !== "start");
  if (!site.length) return <Waiting>Dapi opens the page and watches its network traffic before reading any of it.</Waiting>;
  const source = site.find((e) => e.kind === "source");
  const detail = site.find((e) => e.kind === "detail");
  const pick = site.find((e) => e.kind === "pick" && e.chosen !== null);
  const page = site.find((e) => e.kind === "page");
  const declined = site.find((e) => e.kind === "declined");
  const reach = site.find((e) => e.kind === "reach");
  const live = job.status === "running" && job.step === "site";

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="flex flex-col gap-4">
        {declined && (
          <section className="rounded-lg border border-pencil-red/40 bg-red-wash px-5 py-4 text-red-ink">
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

        <Panel title="What Dapi did">
          <ol className="divide-y divide-rule">
            {site.map((e) => (
              <li key={e.n} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 px-5 py-2.5 text-[14px]">
                <span className="text-[12px] text-ink-3 tabular-nums">{clock(e.at)}</span>
                <span className={cn(e.kind === "declined" && "text-pencil-red")}>{e.text}</span>
              </li>
            ))}
            {live && (
              <li className="flex items-center gap-3 px-5 py-2.5 text-[14px] text-ink-2">
                <span aria-hidden className="size-2 rounded-full bg-ink" /> Still looking…
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
    <section className="rounded-lg border bg-sheet px-5 py-4">
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
    <figure className="overflow-hidden rounded-lg border bg-sheet">
      {/* eslint-disable-next-line @next/next/no-img-element -- a screenshot from the job's folder, served as is */}
      <img src={`/api/jobs/${job.id}/files/${image}`} alt={caption} className="block w-full border-b" />
      <figcaption className="px-4 py-2.5 text-[13px] text-ink-2">{caption}</figcaption>
    </figure>
  );
}
