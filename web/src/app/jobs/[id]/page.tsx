import { notFound } from "next/navigation";
import { READ_ONLY, getEvents, getJob, jobPath, readJson } from "@/lib/server/dapi";
import { canAct, canSee } from "@/lib/server/access";
import { PUBLIC, currentUser } from "@/lib/server/session";
import { Account } from "@/components/account";
import { JobView } from "@/components/job/job-view";
import type { Report } from "@/lib/steps";

export default async function JobPage({ params }: PageProps<"/jobs/[id]">) {
  const { id } = await params;
  const job = getJob(id);
  // On the public demo: the featured jobs for everyone, anyone else's job doesn't exist.
  const user = PUBLIC ? await currentUser() : null;
  if (!job || !canSee(job, user)) notFound();
  return (
    <JobView
      initialJob={job}
      initialEvents={getEvents(id)}
      initialReport={readJson<Report>(jobPath(id, "report.json"))}
      readOnly={READ_ONLY || !canAct(job, user)}
      account={<Account next={`/jobs/${id}`} />}
    />
  );
}

export async function generateMetadata({ params }: PageProps<"/jobs/[id]">) {
  const { id } = await params;
  const job = getJob(id);
  // The tab title is the job's too: someone who may not see the job doesn't get it.
  const user = PUBLIC ? await currentUser() : null;
  if (!job || !canSee(job, user)) return { title: "Not found · Dapi" };
  return { title: job.title ? `${job.title} · Dapi` : `Job ${id} · Dapi` };
}
