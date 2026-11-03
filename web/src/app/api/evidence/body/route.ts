// The response body exactly as captured, so the browser can hash it itself and compare
// with the hash recorded at capture. Only where Dapi runs for the one who ran the job:
// a body holds everything the site sent, including fields the job doesn't deliver, so
// the public read-only copy re-checks seals on the server instead (../verify).

import { READ_ONLY, pipeline } from "@/lib/server/dapi";

export async function GET(request: Request) {
  if (READ_ONLY) return new Response("This copy checks seals on the server.", { status: 403 });
  const key = new URL(request.url).searchParams.get("key") ?? "";
  try {
    const { loadEvidence } = await pipeline<{ loadEvidence: (k: string) => Promise<{ body: string }> }>("src/receipts/evidence.js");
    const { body } = await loadEvidence(key);
    return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, max-age=86400, immutable" } });
  } catch (err) {
    return new Response((err as Error).message, { status: 404 });
  }
}
