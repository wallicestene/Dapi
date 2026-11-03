import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Footer, TopBar } from "@/components/shell";
import { Account } from "@/components/account";
import { READ_ONLY, REPO } from "@/lib/server/dapi";
import { PUBLIC, currentUser } from "@/lib/server/session";
import { LIMITS, mayStart } from "@/lib/server/quota";
import { NewJobForm } from "./form";

// The public demo's quick starts: specs on reviewed sources, ready to edit and run.
const EXAMPLES = [
  { key: "fda", label: "FDA warning letters", file: "fda-warning-letters.md" },
  { key: "norway", label: "Norway's health services register", file: "norway-health-services.md" },
  { key: "books", label: "Books to Scrape (travel)", file: "books-to-scrape.md" },
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
          {/* The public demo: signed in, a turn left, a reviewed source. */}
          {PUBLIC && (
            <section className="flex flex-col gap-3 rounded-xl border bg-sheet px-5 py-4 text-[14px]">
              {!user ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="min-w-0 flex-1">
                    <span className="font-semibold">Sign in to run a job.</span> <span className="text-ink-2">Everyone gets {LIMITS.perUser} jobs on this demo, on any public site.</span>
                  </p>
                  <Account next={`/jobs/new${example ? `?example=${example}` : ""}`} />
                </div>
              ) : !may?.ok ? (
                <p className="font-medium text-red-ink">{may?.reason}</p>
              ) : (
                <p>
                  <span className="font-semibold">You have {may.left} job{may.left === 1 ? "" : "s"} left on the demo.</span>{" "}
                  <span className="text-ink-2">Any public site: Dapi reads what any visitor can see, never logins, paywalls or CAPTCHAs.</span>
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-ink-2">Start from an example:</span>
                {EXAMPLES.map((e) => (
                  <Link key={e.key} href={`/jobs/new?example=${e.key}`} className="inline-flex h-8 items-center rounded-full border border-border bg-white px-3 text-[13px] font-medium hover:border-ink-3">
                    {e.label}
                  </Link>
                ))}
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
