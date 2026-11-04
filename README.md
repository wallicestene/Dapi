# Dapi

**Web data you can prove.** Send a spec (the site, the columns you need, a sample row or
two) and Dapi delivers the dataset, with a receipt for every value and every row counted
against the source's own total.

Dapi is for people who need web data they can stand behind and don't write scrapers:
a compliance officer pulling registry records, a procurement analyst, a journalist
checking a public database. Nobody sees code unless they want to.

## How it works

1. **Read the spec.** A PDF, pasted text, or a spoken brief.
2. **Investigate the site.** Dapi opens the page and watches its network traffic before
   reading any HTML. Most sites load their data from a feed of their own; Dapi finds it
   and reads that instead of scraping the page: faster, steadier, in the site's own
   words. Muse Wonder then works through whatever is still open as an agent, and plans
   the extraction column by column.
3. **Write and test the extraction.** Muse Spark writes the code and Dapi tests it
   against the spec's sample rows. Small differences (spacing, a typo in the spec) are
   handled; where the site shows something else, Dapi delivers what the site shows and
   says so.
4. **Show the plan.** The records the source lists, the requests, the time, anything
   worth a look. Nothing runs until you press Go.
5. **Run on Apify.** Rows stream into your dataset. A run that breaks is stopped, its log
   goes to Muse Spark for a fix, and a fresh run starts.
6. **Prove it.** Every captured response is sealed with SHA-256 the moment it arrives.
   Click any value to see the response it came from, with its line marked, and re-check
   the seal. The rows are counted against the source's own total, and anything missing
   is named.

## Meta's models in Dapi

| Model | What it does here |
| --- | --- |
| **Muse Wonder** (`muse-wonder-1.0`) | Runs the investigation as an agent on the Responses API, with tools to search the web, look at pages, click and watch the network, test endpoints and search a page's source; then plans the extraction for every column (`src/agent.js`, `src/strategy.js`). |
| **Muse Spark** (`muse-spark-1.3`) | Reads the spec into columns, samples and rules; looks at a screenshot to choose what opens a record's details; writes the extraction and repairs it from a failed run's log; translates values into the language asked for; writes everything the client reads in plain words (`src/read-spec.js`, `src/write-site.js`, `src/translate.js`). |
| **Muse Voice Transcribe** | Turns a spoken brief into text, which Muse Spark writes up as a spec (`src/voice.js`). |

## Rules Dapi keeps

- Public data only: what any visitor can see. No logins, no paywalls.
- A check that wants a person (a CAPTCHA, "verify you are human") is set aside, never
  solved. No challenge-solving services.
- robots.txt is obeyed, including the pause it asks for between requests.
- Never an address on the server's own network (`src/net-guard.js`).
- Receipts show only the fields a job delivers, never everything else a site sent.

## Run it yourself

You need Node.js 22 or later, an [Apify](https://apify.com) account and a Meta Model API
key.

```sh
cp .env.example .env              # then add MODEL_API_KEY and APIFY_TOKEN
npm install
(cd web && npm install)
node src/apify/deploy-runner.js   # builds the dapi-runner Actor on your Apify account
cd web && npm run dev             # http://localhost:3000
```

Jobs can also run from the terminal:

```sh
node src/jobs/run-job.js --new specs/books-to-scrape.md
```

`specs/` holds example specs. `npm test` runs the tests, and
`node src/investigate/suite.js` runs the investigation against sites built in different
ways.

## Deploy

[DEPLOY.md](DEPLOY.md) puts Dapi on one Fly.io machine as a public demo: anyone can open
the example jobs, and anyone signed in with GitHub can run a few jobs of their own,
inside limits that keep the owner's Meta and Apify accounts in budget. A read-only copy,
where nothing runs, is one setting away.

In production, each user would sign in and connect their own Apify account, so their
jobs, data and costs stay in their account.

## Layout

| Folder | What's there |
| --- | --- |
| `src/` | The pipeline: spec reading, investigation, the Muse agent and strategy, code writing and testing, the job runner. |
| `src/frame/` | The frame each extraction runs inside on Apify: it keeps the evidence and does the counting. |
| `runner/` | The `dapi-runner` Actor's definition. |
| `web/` | The Next.js app: home page, jobs, receipts. |
| `specs/` | Example specs. |
| `deploy/`, `Dockerfile`, `fly.toml` | The public demo's container and host. |

## Built for the Meta Global AI Developer Hackathon

Everything in this repository was written during the hackathon (26 October to 4 November
2026). Libraries are dependencies, listed in `package.json` and `web/package.json`:
Crawlee and the Apify SDK and client, Playwright, Next.js, shadcn/ui on Radix, Magic UI
components, fflate and Lucide icons.

Apify and the Apify logo are trademarks of Apify Technologies; they're used to credit the
platform Dapi runs on. Example data: FDA warning letters, public domain; Books to Scrape,
a site made for practising extraction; Wikipedia's list of US national parks, CC BY-SA
4.0; Arbeidstilsynet's register of approved
occupational health services, published under the Norwegian licence for Open Government
data (NLOD).
