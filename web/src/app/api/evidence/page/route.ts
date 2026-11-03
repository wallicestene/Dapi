// A captured HTML page as it was, scripts removed, with the element a value came from
// outlined. Shown in a sandboxed frame.

import { randomBytes } from "node:crypto";
import { pipeline } from "@/lib/server/dapi";
import { jobFor } from "@/lib/server/access";
import { PUBLIC } from "@/lib/server/session";

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  if (PUBLIC) {
    const access = await jobFor(p.get("job") ?? "", "see");
    if (access instanceof Response) return access;
  }
  try {
    const { loadEvidence } = await pipeline<{ loadEvidence: (k: string) => Promise<unknown> }>("src/receipts/evidence.js");
    const { markedPage } = await pipeline<{ markedPage: (e: unknown, path: string, nonce: string) => string }>("src/receipts/locate.js");
    // One script runs, Dapi's own, to scroll the value into view: the page's are removed
    // and the policy admits only this request's nonce.
    const nonce = randomBytes(16).toString("base64");
    const html = markedPage(await loadEvidence(p.get("key") ?? ""), p.get("path") ?? "", nonce);
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": `script-src 'nonce-${nonce}'`, "cache-control": "private, no-store" },
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 404 });
  }
}
