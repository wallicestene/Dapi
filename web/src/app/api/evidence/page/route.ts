// A captured HTML page as it was, scripts removed, with the element a value came from
// outlined. Shown in a sandboxed frame.

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
    const { markedPage } = await pipeline<{ markedPage: (e: unknown, path: string) => string }>("src/receipts/locate.js");
    const html = markedPage(await loadEvidence(p.get("key") ?? ""), p.get("path") ?? "");
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "script-src 'none'", "cache-control": "private, max-age=86400" },
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 404 });
  }
}
