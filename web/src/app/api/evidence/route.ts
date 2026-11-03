// A value's receipt: the evidence it was read from (request, response, capture time,
// hash) and, for each path the value came from, that place in the evidence.

import { pipeline } from "@/lib/server/dapi";
import { deliveredKeys, onlyDelivered } from "@/lib/server/delivered";
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
      // Only the fields the job delivers leave the server; the rest are counted.
      located: p.getAll("path").map((path) => {
        const l = { path, ...locate(e, path) };
        const keep = deliveredKeys(p.get("job"));
        if (l.kind === "json") {
          const { shown, hidden } = onlyDelivered(l.record, keep, l.key);
          return { ...l, record: shown, hidden };
        }
        if (l.kind === "embedded") {
          const { shown, hidden } = onlyDelivered(l.row, keep, l.cell);
          return { ...l, row: shown, hidden };
        }
        return l;
      }),
    };
    return Response.json(receipt, { headers: { "cache-control": "private, max-age=86400, immutable" } });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 404 });
  }
}
