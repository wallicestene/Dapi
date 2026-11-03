// Starts a job from an uploaded spec (PDF, Markdown or text) or pasted text. The job
// runs as its own process, so it carries on if this server restarts.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { READ_ONLY, pipeline } from "@/lib/server/dapi";
import { startRunner } from "@/lib/server/runner";
import { PUBLIC, currentUser } from "@/lib/server/session";
import { mayStart } from "@/lib/server/quota";

const ALLOWED = new Set([".pdf", ".md", ".txt"]);
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: Request) {
  if (READ_ONLY) return Response.json({ error: "This copy of Dapi is for exploring finished jobs; new jobs run locally." }, { status: 403 });
  // The public demo: signed in, with a turn left (see lib/server/quota.ts).
  const user = PUBLIC ? await currentUser() : null;
  if (PUBLIC) {
    const may = mayStart(user);
    if (!may.ok) return Response.json({ error: may.reason }, { status: user ? 429 : 401 });
  }
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
  const { id } = createJob(upload);
  fs.rmSync(tmp, { recursive: true, force: true });
  startRunner(id, [], user ? { owner: { id: user.id, login: user.login } } : {});
  return Response.json({ id });
}
