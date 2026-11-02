import { redirect } from "next/navigation";
import { TopBar } from "@/components/shell";
import { READ_ONLY } from "@/lib/server/dapi";
import { NewJobForm } from "./form";

export const metadata = { title: "New job · Dapi" };

export default function NewJob() {
  if (READ_ONLY) redirect("/");
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar crumb="New job" />
      <main className="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-6 pt-7 pb-10">
        <div>
          <h1 className="text-[28px] leading-tight font-bold tracking-[-0.03em]">New job</h1>
          <p className="mt-1 text-[14px] text-ink-2">
            Give Dapi your spec the way you&apos;d give it to a freelancer: the public source, the columns, a few sample rows and any rules. It reads it, finds how the site serves its data, writes and tests the extraction, and shows you the plan before anything runs.
          </p>
        </div>
        <NewJobForm />
      </main>
    </div>
  );
}
