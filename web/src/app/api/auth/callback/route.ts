// GitHub sends the visitor back here: check the state, swap the code for a token, read
// the public profile once, keep only id, login and picture in a signed cookie.

import { cookies } from "next/headers";
import { SESSION, sealUser } from "@/lib/server/session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const pending = JSON.parse(jar.get("dapi-oauth")?.value ?? "{}") as { state?: string; back?: string };
  jar.delete("dapi-oauth");
  const origin = process.env.DAPI_PUBLIC_URL ?? url.origin;
  if (!pending.state || pending.state !== url.searchParams.get("state")) return Response.redirect(`${origin}/jobs/new?signin=failed`, 302);
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code: url.searchParams.get("code") }),
  });
  const { access_token: token } = (await res.json()) as { access_token?: string };
  if (!token) return Response.redirect(`${origin}/jobs/new?signin=failed`, 302);
  const profile = (await (await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" } })).json()) as { id: number; login: string; avatar_url: string };
  const { value, maxAge } = sealUser({ id: profile.id, login: profile.login, avatar: profile.avatar_url });
  jar.set(SESSION, value, { httpOnly: true, secure: true, sameSite: "lax", maxAge, path: "/" });
  return Response.redirect(`${origin}${pending.back ?? "/jobs/new"}`, 302);
}
