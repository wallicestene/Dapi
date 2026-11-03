import { cookies } from "next/headers";
import { SESSION } from "@/lib/server/session";

export async function POST(request: Request) {
  (await cookies()).delete(SESSION);
  return Response.redirect(new URL("/", process.env.DAPI_PUBLIC_URL ?? request.url).toString(), 303);
}
