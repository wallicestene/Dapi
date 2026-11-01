// Starts a job from an uploaded spec (PDF, Markdown or text) or pasted text. The job
// runs as its own process, so it carries on if this server restarts.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { JOBS_DIR, READ_ONLY, REPO, pipeline } from "@/lib/server/dapi";

const ALLOWED = new Set([".pdf", ".md", ".txt"]);
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: Request) {
  if (READ_ONLY) return Response.json({ error: "This copy of Dapi is for exploring finished jobs; new jobs run locally." }, { status: 403 });
  const form = await request.formData();
  const file = form.get("spec");
  const text = String(form.get("text") ?? "").trim();

  let name: string;
  let bytes: Buffer;
  if (file instanceof File && file.size > 0) {
    name = file.name;
    if (!ALLOWED.has(path.extname(name).toLowerCase())) return Response.json({ error: "Send the spec as a PDF, Markdown or text file." }, { status: 400 });
    if (file.size > MAX_BYTES) return Response.json({ error: "That file is over 15 MB." }, { status: 400 });
    bytes = Buffer.from(await file.arrayBuffer());
  } else if (text) {
    name = "spec.txt";
    bytes = Buffer.from(text, "utf8");
  } else {
    return Response.json({ error: "Add a spec file or paste its text." }, { status: 400 });
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dapi-spec-"));
  const upload = path.join(tmp, `spec${path.extname(name).toLowerCase() || ".txt"}`);
  fs.writeFileSync(upload, bytes);
  const { createJob } = await pipeline<{ createJob: (p: string) => { id: string; dir: string } }>("src/jobs/store.js");
  const { id, dir } = createJob(upload);
  fs.rmSync(tmp, { recursive: true, force: true });

  const log = fs.openSync(path.join(dir, "runner.log"), "a");
  const child = spawn(process.execPath, [path.join(REPO, "src/jobs/run-job.js"), id], {
    cwd: REPO,
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, DAPI_JOBS_DIR: JOBS_DIR },
  });
  child.unref();
  return Response.json({ id });
}
