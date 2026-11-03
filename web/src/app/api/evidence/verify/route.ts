// A seal re-checked on the server: the stored body hashed again and compared with the
// hash recorded at capture. Only the answer leaves the server, never the body.

import { createHash } from "node:crypto";
import { pipeline } from "@/lib/server/dapi";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  try {
    const { loadEvidence } = await pipeline<{ loadEvidence: (k: string) => Promise<{ body: string; bodySha256: string }> }>("src/receipts/evidence.js");
    const { body, bodySha256 } = await loadEvidence(key);
    const sha256 = createHash("sha256").update(body, "utf8").digest("hex");
    return Response.json({ sha256, matches: sha256 === bodySha256 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 404 });
  }
}
