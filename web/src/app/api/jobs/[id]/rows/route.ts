import { getJob, validId } from "@/lib/server/dapi";
import { rowsPage } from "@/lib/server/rows";

export async function GET(request: Request, ctx: RouteContext<"/api/jobs/[id]/rows">) {
  const { id } = await ctx.params;
  if (!validId(id) || !getJob(id)) return Response.json({ error: "no such job" }, { status: 404 });
  const p = new URL(request.url).searchParams;
  const page = await rowsPage(id, {
    offset: Math.max(0, Number(p.get("offset") ?? 0)),
    limit: Math.min(200, Math.max(1, Number(p.get("limit") ?? 50))),
    scope: p.get("scope") ?? "all",
    q: p.get("q") ?? "",
  });
  return Response.json(page);
}
