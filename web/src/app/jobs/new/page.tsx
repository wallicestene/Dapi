import { redirect } from "next/navigation";
import { Footer, TopBar } from "@/components/shell";
import { READ_ONLY } from "@/lib/server/dapi";
import { NewJobForm } from "./form";

export const metadata = { title: "New job · Dapi" };

// What a spec needs, the way a client would brief a freelancer.
const GOOD_SPEC = [
  { color: "bg-source", title: "The source", body: "The public site or page the data is on." },
  { color: "bg-extract", title: "One row is…", body: "What each row stands for: a company, a certificate, an issue." },
  { color: "bg-deliver", title: "The columns", body: "Each column you need, with a note where it isn't obvious." },
  { color: "bg-verified", title: "A sample row or two", body: "Filled in as you'd expect. They guide; the site decides." },
];

export default function NewJob() {
  if (READ_ONLY) redirect("/");
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar crumb="New job" />
      <main className="mx-auto grid w-full max-w-[1080px] items-start gap-8 px-5 pt-8 pb-14 sm:px-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-5">
          <div>
            <h1 className="text-[32px] leading-tight font-bold tracking-[-0.03em]">New job</h1>
            <p className="mt-1 text-[15px] text-ink-2">Send your spec. Dapi shows you the plan, the time and the cost before anything runs.</p>
          </div>
          <NewJobForm />
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
