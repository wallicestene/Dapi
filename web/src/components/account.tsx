import { PUBLIC, currentUser } from "@/lib/server/session";

// Who's signed in, on the public demo: a GitHub account. Run by its owner, Dapi has no
// accounts and this shows nothing.
export async function Account({ next = "/jobs/new" }: { next?: string }) {
  if (!PUBLIC) return null;
  const user = await currentUser();
  // Previewing the public demo locally (npm run dev:public): a test sign-in, no GitHub.
  if (!user && process.env.DAPI_DEV_LOGIN === "1" && process.env.NODE_ENV !== "production")
    return (
      <a href="/api/auth/dev?as=you" className="inline-flex h-8 items-center rounded-md border border-control bg-sheet px-3 text-[13px] font-medium hover:bg-raised">
        Sign in (local test)
      </a>
    );
  if (!user)
    return (
      <a href={`/api/auth/github?next=${encodeURIComponent(next)}`} className="inline-flex h-8 items-center rounded-md border border-control bg-sheet px-3 text-[13px] font-medium hover:bg-raised">
        Sign in with GitHub
      </a>
    );
  return (
    <form action="/api/auth/logout" method="post" className="flex items-center gap-2 text-[13px]">
      {/* eslint-disable-next-line @next/next/no-img-element -- the GitHub picture, as GitHub serves it */}
      {user.avatar && <img src={user.avatar} alt="" className="size-6 rounded-full" />}
      <span className="hidden font-medium sm:inline">{user.login}</span>
      <button type="submit" className="text-ink-2 underline-offset-2 hover:text-ink hover:underline">
        Sign out
      </button>
    </form>
  );
}
