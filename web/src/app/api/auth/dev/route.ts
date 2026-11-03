// A test sign-in for trying the public demo locally (never in production): signs in as
// the user named in ?as= without GitHub.

import { cookies } from "next/headers";
import { SESSION, sealUser } from "@/lib/server/session";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production" || process.env.DAPI_DEV_LOGIN !== "1") return new Response("not found", { status: 404 });
  const as = new URL(request.url).searchParams.get("as") ?? "tester";
  const { value, maxAge } = sealUser({ id: [...as].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % 1e9, login: as, avatar: "" });
  (await cookies()).set(SESSION, value, { httpOnly: true, sameSite: "lax", maxAge, path: "/" });
  return Response.redirect(new URL("/jobs/new", request.url).toString(), 302);
}
