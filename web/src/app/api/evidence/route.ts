// A value's receipt: the evidence it was read from (request, response, capture time,
// hash) and, for each path the value came from, that place in the evidence.

import { pipeline } from "@/lib/server/dapi";
import type { Located, Receipt } from "@/lib/types";

interface Evidence {
  capturedAt: string;
  via?: string;
  request: Receipt["request"];
  response: Receipt["response"];
  bodySha256: string;
  body: string;
}

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const key = p.get("key") ?? "";
  try {
    const { loadEvidence } = await pipeline<{ loadEvidence: (k: string) => Promise<Evidence> }>("src/receipts/evidence.js");
    const { locate } = await pipeline<{ locate: (e: Evidence, path: string) => Omit<Located, "path"> }>("src/receipts/locate.js");
    const e = await loadEvidence(key);
    const receipt: Receipt = {
      key,
      capturedAt: e.capturedAt,
      via: e.via,
      request: e.request,
      response: e.response,
      bodySha256: e.bodySha256,
      bodyBytes: Buffer.byteLength(e.body),
      located: p.getAll("path").map((path) => ({ path, ...locate(e, path) })),
    };
    return Response.json(receipt, { headers: { "cache-control": "private, max-age=86400, immutable" } });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 404 });
  }
}
