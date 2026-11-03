// Sign in with GitHub: off to GitHub with a one-time state, back to /api/auth/callback.

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const id = process.env.GITHUB_CLIENT_ID;
  if (!id) return new Response("Sign-in isn't set up on this copy.", { status: 503 });
  const state = randomBytes(16).toString("hex");
  const back = new URL(request.url).searchParams.get("next") ?? "/jobs/new";
  (await cookies()).set("dapi-oauth", JSON.stringify({ state, back: back.startsWith("/") ? back : "/jobs/new" }), { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  const to = new URL("https://github.com/login/oauth/authorize");
  to.searchParams.set("client_id", id);
  to.searchParams.set("redirect_uri", `${process.env.DAPI_PUBLIC_URL ?? new URL(request.url).origin}/api/auth/callback`);
  to.searchParams.set("state", state);
  // No scope: only the public profile (id, login, picture).
  return Response.redirect(to.toString(), 302);
}
