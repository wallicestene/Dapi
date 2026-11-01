import { notFound } from "next/navigation";
import { READ_ONLY, getEvents, getJob, jobPath, readJson } from "@/lib/server/dapi";
import { JobView } from "@/components/job/job-view";
import type { Report } from "@/lib/steps";

export default async function JobPage({ params }: PageProps<"/jobs/[id]">) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) notFound();
  return (
    <JobView
      initialJob={job}
      initialEvents={getEvents(id)}
      initialReport={readJson<Report>(jobPath(id, "report.json"))}
      readOnly={READ_ONLY}
    />
  );
}

export async function generateMetadata({ params }: PageProps<"/jobs/[id]">) {
  const { id } = await params;
  const job = getJob(id);
  return { title: job?.title ? `${job.title} · Dapi` : `Job ${id} · Dapi` };
}
