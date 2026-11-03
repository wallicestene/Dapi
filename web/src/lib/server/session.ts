import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// Who's signed in, on the public demo: a GitHub account, kept in a signed cookie. Dapi
// keeps the account's id, login and picture; never a GitHub token.
export const PUBLIC = process.env.DAPI_PUBLIC === "1";
export const SESSION = "dapi-session";
const DAYS = 30;

export interface User {
  id: number;
  login: string;
  avatar: string;
}

const sign = (body: string) => createHmac("sha256", process.env.SESSION_SECRET ?? "").update(body).digest("base64url");

export function sealUser(user: User) {
  const body = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + DAYS * 86_400_000 })).toString("base64url");
  return { value: `${body}.${sign(body)}`, maxAge: DAYS * 86_400 };
}

export function openUser(token?: string): User | null {
  if (!token || !process.env.SESSION_SECRET) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const { id, login, avatar, exp } = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return exp > Date.now() ? { id, login, avatar } : null;
  } catch {
    return null;
  }
}

export async function currentUser(): Promise<User | null> {
  return openUser((await cookies()).get(SESSION)?.value);
}
