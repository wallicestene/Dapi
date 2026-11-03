import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Mark, Wordmark } from "@/components/shell";
import { ReceiptDemo } from "@/components/home/receipt-demo";
import { JobArt } from "@/components/job-art";
import { GLASS } from "@/lib/glass";
import { cn } from "@/lib/utils";
import { NumberTicker } from "@/components/ui/number-ticker";
import { READ_ONLY, getJob } from "@/lib/server/dapi";
import { cost, took } from "@/lib/stage";

export const dynamic = "force-dynamic";

// The front door: what Dapi does, shown on a real delivered job, then how, then proof.
// Every number here comes from a finished job's own record.

const STEPS = [
  { n: 1, name: "Source", title: "Finds the data behind the page", body: "Dapi's agent opens the site, watches its traffic and finds the feed the page itself uses." },
  { n: 2, name: "Extract", title: "Writes the extraction and tests it", body: "Muse Spark writes the code and checks it against your sample rows before anything runs." },
  { n: 3, name: "Deliver", title: "Runs on Apify at the site's pace", body: "You approve the plan. Rows stream into your dataset as they're found." },
  { n: 4, name: "Verified", title: "Proves every value", body: "Each value links to the server response it came from, hashed the moment it was captured." },
];

const PROOF = [
  { id: "0024", label: "FSSC certified organisations", note: "A 43,037-record register, read from its own data feed" },
  { id: "0002", label: "Great Place to Work India", note: "Four tables embedded in one page, plus a profile per company" },
  { id: "0006", label: "Better Work factory compliance", note: "One row per issue, from a request behind a View button" },
  { id: "0017", label: "Occupational health services, Norway", note: "Spoken spec, delivered in English from a Norwegian site" },
];

const WHY = [
  { title: "Calls the API, not the page", body: "Most sites load their data from a feed. Dapi reads that feed: faster, steadier, and in the server's own words." },
  { title: "Receipts, not logs", body: "Open any value to see the exact response, when it was captured, and its SHA-256." },
  { title: "Counted, never quietly short", body: "Rows are footed against the source's own total. Anything missing is named, with the reason." },
  { title: "Your samples guide, the site decides", body: "When a sample disagrees with the site, you see both, and Dapi delivers what the site shows." },
];

// The first visit opens on the mark drawing itself in the middle of the screen, then
// the page. Once per visit (sessionStorage), never for reduced motion, and pure CSS, so
// it clears itself even before the page's scripts run. The inline script, ahead of the
// overlay, marks a repeat visit before anything paints.
function Intro() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: "try{if(sessionStorage.getItem('dapi-intro'))document.documentElement.dataset.seen='1';sessionStorage.setItem('dapi-intro','1')}catch(e){}" }} />
      <div aria-hidden className="dapi-intro">
        <Mark draw className="size-28" />
      </div>
    </>
  );
}

export default function Home() {
  const proof = PROOF.map((p) => ({ ...p, job: getJob(p.id) })).filter((p) => p.job?.status === "done");
  const start = READ_ONLY ? { href: "/jobs", label: "Explore finished jobs" } : { href: "/jobs/new", label: "Start a job" };
  return (
    <div className="flex min-h-screen flex-col">
      <Intro />
      <header className="flex h-16 shrink-0 items-center gap-6 px-5 sm:px-8">
        <Wordmark />
        <nav aria-label="Main" className="hidden items-center gap-6 text-[14px] font-medium text-ink-2 sm:flex">
          <a href="#how" className="hover:text-ink">
            How it works
          </a>
          <a href="#proof" className="hover:text-ink">
            Delivered
          </a>
          <Link href="/jobs" className="hover:text-ink">
            Jobs
          </Link>
        </nav>
        <Button asChild className="ml-auto h-9 px-4">
          <Link href={start.href}>{start.label}</Link>
        </Button>
      </header>

      <main className="flex flex-col">
        <section className="mx-auto grid w-full max-w-[1240px] items-center gap-10 px-5 pt-10 pb-20 sm:px-8 lg:grid-cols-[minmax(0,6fr)_minmax(0,7fr)] lg:gap-12 lg:pt-16">
          <div className="flex flex-col gap-6">
            {/* The headline carries the mark: our D is the d of "data". */}
            <h1 aria-label="Web data you can prove." className="text-[clamp(44px,5.4vw,78px)] leading-[0.95] font-bold tracking-[-0.045em]">
              <span aria-hidden>
                Web <Mark className="inline-block h-[0.92em] w-[0.92em] -ml-[0.03em] -mr-[0.03em] align-[-0.075em]" />
                ata you can prove.
              </span>
            </h1>
            <p className="max-w-[460px] text-[19px] leading-[1.45] text-ink-2">Send a spec. Get the dataset, with every value traced to the response it came from.</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild className="h-11 px-5 text-[15px]">
                <Link href={start.href}>{start.label}</Link>
              </Button>
              <Button asChild variant="outline" className="h-11 bg-sheet px-5 text-[15px]">
                <Link href="/jobs/0024">
                  See a delivered job <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
            <p className="text-[13px] text-ink-2">Runs on Apify. Built with Meta&apos;s Muse Spark, Muse Wonder and Muse Voice Transcribe.</p>
          </div>
          <ReceiptDemo />
        </section>

        <section id="how" className="bg-night text-[#e6e9da]">
          <div className="mx-auto w-full max-w-[1240px] px-5 py-20 sm:px-8">
            <h2 className="max-w-[640px] text-[clamp(30px,3.6vw,44px)] leading-[1.05] font-bold tracking-[-0.03em] text-white">From a spec to a proven dataset</h2>
            <p className="mt-3 max-w-[560px] text-[17px] text-[#b8c0b9]">Write the spec the way you&apos;d brief a freelancer: the site, the columns, a few sample rows. PDF, text, or say it out loud.</p>
            <ol className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s) => (
                <li key={s.n} className="flex flex-col gap-3">
                  <Mark className="size-12" lit={s.n} dim="#2b3a48" />
                  <span className="text-[13px] font-semibold tracking-[0.02em] text-[#b8c0b9]">
                    {s.n} · {s.name}
                  </span>
                  <h3 className="text-[19px] leading-snug font-semibold text-white">{s.title}</h3>
                  <p className="text-[15px] leading-relaxed text-[#b8c0b9]">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {proof.length > 0 && (
          <section id="proof" className="mx-auto w-full max-w-[1240px] px-5 py-20 sm:px-8">
            <h2 className="max-w-[640px] text-[clamp(30px,3.6vw,44px)] leading-[1.05] font-bold tracking-[-0.03em]">Delivered, and counted against the source</h2>
            <p className="mt-3 max-w-[560px] text-[17px] text-ink-2">Real jobs, real public sources. Open any of them to check the receipts yourself.</p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {proof.map(({ id, label, note, job }) => (
                <Link key={id} href={`/jobs/${id}`} className="group relative block h-[320px] overflow-hidden rounded-2xl bg-night shadow-[0_10px_30px_-16px_rgb(15_26_36/0.5)] transition-transform duration-300 hover:-translate-y-1">
                  <JobArt seed={job!.sourceUrl ? new URL(job!.sourceUrl).host.replace(/^www\./, "") : id} className="absolute inset-0" />
                  <span className="absolute top-5 left-5 text-[34px] leading-none font-bold tracking-[-0.03em] text-white tabular-nums drop-shadow-[0_1px_8px_rgb(15_26_36/0.35)]">
                    <NumberTicker value={job!.rows ?? 0} />
                    <span className="block pt-1.5 text-[14px] font-medium tracking-normal text-white/85">of {(job!.expected ?? job!.records ?? job!.rows ?? 0).toLocaleString("en-US")} the source lists</span>
                  </span>
                  <div className={cn(GLASS, "absolute inset-x-3 bottom-3 flex flex-col gap-1.5 px-4 pt-3.5 pb-4")}>
                    <span className="text-[15.5px] leading-snug font-semibold">{label}</span>
                    <span className="text-[13.5px] leading-snug text-white/75">{note}</span>
                    <span className="mt-2 flex items-center gap-2 text-[12.5px] text-white/75">
                      {[took(job!.apify?.seconds), job!.apify?.usd ? `${cost(job!.apify.usd)} on Apify` : null].filter(Boolean).join(" · ")}
                      <ArrowRight className="ml-auto size-4 text-white/70 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="mx-auto w-full max-w-[1240px] px-5 pb-20 sm:px-8">
          <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
            {WHY.map((w) => (
              <div key={w.title} className="flex flex-col gap-2 bg-sheet p-7">
                <h3 className="text-[20px] font-semibold tracking-[-0.01em]">{w.title}</h3>
                <p className="max-w-[440px] text-[15px] leading-relaxed text-ink-2">{w.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-5 text-[14px] text-ink-2">Public data only. No logins, no paywalls, and no CAPTCHA solving.</p>
        </section>

        <section className="mx-auto w-full max-w-[1240px] px-5 pb-24 sm:px-8">
          <div className="flex flex-col items-start gap-5 rounded-2xl bg-sheet px-7 py-10 sm:flex-row sm:items-center sm:px-10">
            <div className="flex flex-col gap-1">
              <h2 className="text-[28px] leading-tight font-bold tracking-[-0.03em]">Have a spec? See it run.</h2>
              <p className="text-[15px] text-ink-2">Dapi shows you the plan, the cost and the time before anything runs.</p>
            </div>
            <Button asChild className="h-11 px-5 text-[15px] sm:ml-auto">
              <Link href={start.href}>{start.label}</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-6 text-[13px] text-ink-2 sm:px-8">
          <Wordmark />
          <span>Built for the Meta Global AI Developer Hackathon, 2026</span>
          <span className="sm:ml-auto">Muse Spark · Muse Wonder · Muse Voice Transcribe · Apify</span>
        </div>
      </footer>
    </div>
  );
}
