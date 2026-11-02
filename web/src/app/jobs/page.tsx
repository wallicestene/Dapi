import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/shell";
import { TickMark } from "@/components/tick";
import { READ_ONLY, listJobs } from "@/lib/server/dapi";
import type { Job } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Jobs · Dapi" };

const STATUS: Record<Job["status"], string> = {
  running: "Running",
  waiting: "Waiting for your Go",
  done: "Delivered",
  failed: "Stopped: failed a check",
  declined: "Refused: can't be extracted",
  cancelled: "Stopped by you",
  stopped: "Run stopped: resurrect to continue",
};

export default function Jobs() {
  const jobs = listJobs();
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar
        actions={
          !READ_ONLY && (
            <Button asChild className="h-8">
              <Link href="/jobs/new">New job</Link>
            </Button>
          )
        }
      />
      <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-6 pt-7 pb-10">
        <div>
          <h1 className="text-[28px] leading-tight font-bold tracking-[-0.03em]">Jobs</h1>
          <p className="mt-1 text-[14px] text-ink-2">Each job turns a spec into a dataset with a receipt for every value, footed against the source&apos;s own count.</p>
        </div>
        <section className="overflow-hidden rounded-lg border bg-sheet">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b text-left text-[12px] text-ink-2">
                <th className="w-16 px-5 py-2.5 font-normal">Job</th>
                <th className="px-3 py-2.5 font-normal">Dataset</th>
                <th className="px-3 py-2.5 text-right font-normal">Rows</th>
                <th className="px-3 py-2.5 font-normal">Status</th>
                <th className="px-5 py-2.5 text-right font-normal">Started</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const short = job.status === "done" && job.expected != null && (job.rows ?? 0) < job.expected;
                return (
                  <tr key={job.id} className="relative border-b border-rule last:border-0 hover:bg-raised">
                    <td className="px-5 py-3 text-ink-3">{job.id}</td>
                    <td className="px-3 py-3">
                      <Link href={`/jobs/${job.id}`} className="font-medium after:absolute after:inset-0">
                        {job.title ?? "Reading the spec…"}
                      </Link>
                      {job.sourceUrl && <span className="block text-[13px] text-ink-2">{new URL(job.sourceUrl).host}</span>}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {job.runId ? (
                        <span className="inline-flex items-center gap-1.5">
                          {(job.rows ?? 0).toLocaleString("en-US")}
                          {job.expected != null && <span className="text-ink-3">/ {job.expected.toLocaleString("en-US")}</span>}
                          {job.status === "done" && <TickMark tick={short ? "missing" : "footed"} />}
                        </span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className={job.status === "declined" || job.status === "failed" ? "px-3 py-3 text-pencil-red" : "px-3 py-3 text-ink-2"}>{STATUS[job.status]}</td>
                    <td className="px-5 py-3 text-right text-ink-2">{new Date(job.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td>
                  </tr>
                );
              })}
              {!jobs.length && (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-ink-2">
                    No jobs yet. {READ_ONLY ? "" : <Link href="/jobs/new" className="font-medium text-ink underline">Start one from a spec.</Link>}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}
