# Deploying the public demo

Anyone can open Dapi's finished example jobs and their receipts. Signed in with GitHub,
anyone can run jobs of their own, on your Meta and Apify accounts, inside limits:

- 3 jobs per person, one at a time; 2 running at once on the server; 30 a day.
- New jobs stop once Meta's charges this month (recorded per call in
  `jobs/usage.jsonl`) reach $60. Meta's own spend limit is the hard stop behind it.
- Any public site, on Dapi's own rules (no logins, paywalls or CAPTCHAs; robots.txt
  obeyed). Addresses on the server's own network (localhost, private and cloud-internal
  ranges) are never fetched (`src/net-guard.js`); a spec pointing at one is declined and
  doesn't use a turn. A runaway guard stops a job over 25,000 requests
  (`DAPI_MAX_REQUESTS`, `0` turns it off).
- Each person sees the example jobs and their own; only they can act on theirs.
  Receipts show only the fields a job delivers.

It's the `Dockerfile` here (Playwright's image, so the investigation has Chromium) on
one Fly.io machine, with the jobs on a volume.

## Once

1. **Cap Meta spend.** On the Meta Model API's Billing page, set the spend limit
   (around $70).

2. **Pick the app's name**, for example `dapi-demo`. The address will be
   `https://dapi-demo.fly.dev`. Put the name in `fly.toml` (`app = "..."`).

3. **A GitHub sign-in app.** github.com > Settings > Developer settings > OAuth Apps >
   New OAuth App:
   - Homepage URL: `https://dapi-demo.fly.dev`
   - Authorization callback URL: `https://dapi-demo.fly.dev/api/auth/callback`

   Register it, copy the **Client ID**, and generate a **Client secret**.

4. **Fly.** Install it, sign in (a browser window opens), and **add a card at
   https://fly.io/trial**: a trial machine is stopped every 5 minutes, which kills any
   job running at the time. Then create the app and its volume:

   ```sh
   brew install flyctl
   fly auth login
   fly launch --no-deploy --copy-config --name dapi-demo
   fly volumes create dapi_jobs --size 1 --region ams
   ```

5. **Secrets** (never in a file):

   ```sh
   fly secrets set \
     MODEL_API_KEY=<your Meta key> \
     APIFY_TOKEN=<your Apify token> \
     GITHUB_CLIENT_ID=<client id> \
     GITHUB_CLIENT_SECRET=<client secret> \
     SESSION_SECRET=$(openssl rand -hex 32) \
     DAPI_PUBLIC_URL=https://dapi-demo.fly.dev
   ```

## Each time

```sh
fly deploy
```

Then open `https://dapi-demo.fly.dev`, sign in, and run an example ("Books to Scrape"
is the quickest; FDA asks for 30 s between requests). The machine stays on (a job runs for minutes with no web traffic),
about $10-15 a month.

## Changing things

- Limits: `fly secrets set DAPI_JOBS_PER_USER=5 DAPI_BUDGET_USD=50 DAPI_MAX_REQUESTS=0`.
- See the public demo on your own machine first: `cd web && npm run dev:public`, then
  "Sign in (local test)".
- Which jobs everyone sees: `DAPI_FEATURED` (default `0001,0002,0003`). A new example
  job: add its folder to `jobs/` here and deploy; the volume gets folders it doesn't
  have yet.
- A copy where nothing runs at all: in `fly.toml`, replace `DAPI_PUBLIC = "1"` with
  `DAPI_READ_ONLY = "1"`.
