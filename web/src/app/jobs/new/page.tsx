import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Footer, TopBar } from "@/components/shell";
import { Account } from "@/components/account";
import { READ_ONLY, REPO } from "@/lib/server/dapi";
import { PUBLIC, currentUser } from "@/lib/server/session";
import { LIMITS, mayStart, turnsLeft } from "@/lib/server/quota";
import { NewJobForm } from "./form";

// The public demo's quick starts: specs on reviewed sources, ready to edit and run.
// Quickest first: Books in seconds, the parks in one request, FDA at the 30 s between
// requests its robots.txt asks for.
const EXAMPLES = [
  { key: "books", label: "Books to Scrape", site: "books.toscrape.com", note: "The quickest: a site made for practice", file: "books-to-scrape.md" },
  { key: "parks", label: "US national parks", site: "wikipedia.org", note: "Every park, from Wikipedia's list", file: "us-national-parks.md" },
  { key: "fda", label: "FDA warning letters", site: "fda.gov", note: "Every 2026 letter; a few minutes, as FDA asks for a pause between requests", file: "fda-warning-letters.md" },
];


export const metadata = { title: "New job · Dapi" };
// Checked on every request: a read-only copy must send visitors away from this page
// whatever its build saw.
export const dynamic = "force-dynamic";

// What a spec needs, the way a client would brief a freelancer.
const GOOD_SPEC = [
  { color: "bg-source", title: "The source", body: "The public site or page the data is on." },
  { color: "bg-extract", title: "One row is…", body: "What each row stands for: a company, a certificate, an issue." },
  { color: "bg-deliver", title: "The columns", body: "Each column you need, with a note where it isn't obvious." },
  { color: "bg-verified", title: "A sample row or two", body: "Filled in as you'd expect. They guide; the site decides." },
];

export default async function NewJob({ searchParams }: PageProps<"/jobs/new">) {
  if (READ_ONLY) redirect("/");
  const user = PUBLIC ? await currentUser() : null;
  const may = PUBLIC ? mayStart(user) : null;
  const example = String((await searchParams).example ?? "") || undefined;
  const picked = EXAMPLES.find((e) => e.key === example);
  const initialText = picked ? fs.readFileSync(path.join(REPO, "specs", picked.file), "utf8") : "";
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar crumb="New job" actions={<Account next="/jobs/new" />} />
      <main className="mx-auto grid w-full max-w-[1080px] items-start gap-8 px-5 pt-8 pb-14 sm:px-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-5">
          <div>
            <h1 className="text-[32px] leading-tight font-bold tracking-[-0.03em]">New job</h1>
            <p className="mt-1 text-[15px] text-ink-2">Send your spec. Dapi shows you the plan, the time and the cost before anything runs.</p>
          </div>
          {/* Jobs left and the examples (when Dapi is shared publicly): a meter that empties
              as jobs are used, the one line on what Dapi reads, three examples to start from. */}
          {PUBLIC && (
            <section className="overflow-hidden rounded-xl border bg-sheet">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                <span className="flex gap-1" aria-hidden>
                  {Array.from({ length: LIMITS.perUser }, (_, i) => (
                    <span key={i} className={i < (user ? (may?.ok ? may.left : turnsLeft(user)) : LIMITS.perUser) ? "h-1.5 w-5 rounded-full bg-deliver" : "h-1.5 w-5 rounded-full bg-rule"} />
                  ))}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold">
                    {!user ? `Sign in to run up to ${LIMITS.perUser} jobs` : may?.ok ? `${may.left} job${may.left === 1 ? "" : "s"} left` : may?.reason}
                  </p>
                  <p className="text-[13.5px] text-ink-2">Any public site. Dapi reads what any visitor can see, never logins, paywalls or CAPTCHAs.</p>
                </div>
                {!user && <Account next={`/jobs/new${example ? `?example=${example}` : ""}`} />}
              </div>
              <div className="border-t bg-raised px-5 pt-3 pb-4">
                <p className="mb-2.5 text-[13px] font-medium text-ink-2">Start from an example</p>
                <ul className="grid gap-2 sm:grid-cols-3">
                  {EXAMPLES.map((e) => (
                    <li key={e.key}>
                      <Link
                        href={`/jobs/new?example=${e.key}`}
                        aria-current={e.key === example ? "true" : undefined}
                        className={`flex h-full flex-col gap-0.5 rounded-lg border bg-white px-3.5 py-2.5 transition-colors hover:border-ink-3 ${e.key === example ? "border-ink shadow-[inset_0_0_0_1px_var(--ink)]" : "border-border"}`}
                      >
                        <span className="text-[14px] font-semibold">{e.label}</span>
                        <span className="text-[12.5px] text-ink-3">{e.site}</span>
                        <span className="mt-1 text-[12.5px] leading-snug text-ink-2">{e.note}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
          <NewJobForm key={example ?? "blank"} initialText={initialText} />
        </div>
        <aside className="flex flex-col gap-4 rounded-xl border bg-sheet p-5 lg:mt-[84px]">
          <p className="text-[15px] font-semibold">What a good spec has</p>
          <ul className="flex flex-col gap-3.5">
            {GOOD_SPEC.map((g) => (
              <li key={g.title} className="flex gap-3">
                <span aria-hidden className={`mt-1 h-4 w-1.5 shrink-0 rounded-full ${g.color}`} />
                <div>
                  <p className="text-[14px] font-medium">{g.title}</p>
                  <p className="text-[13px] leading-snug text-ink-2">{g.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t pt-3.5 text-[13px] text-ink-2">Public data only. No logins, no paywalls, no CAPTCHA solving.</p>
        </aside>
      </main>
      <Footer />
    </div>
  );
}
