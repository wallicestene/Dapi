---
name: dapi
description: Verified findings, working playbook and agreed decisions for building Dapi, the hackathon tool that investigates how a public website serves its data, picks the cheapest extraction route, and delivers a dataset with a receipt for every value. Use this whenever working in the dapi repo — the network probe, extraction routes, Muse Spark or SAM 3.1 calls, Crawlee or Apify, the receipt, the completeness count, the demo — and whenever a test result, finding or decision should be written down, even if the user doesn't mention this file.
---

# Dapi: what we've verified, how we work, what we've decided

AGENTS.md says what Dapi is and the rules it must follow. This file is the notebook we
write while building it: things we have tested, the techniques that worked, and the
decisions the owner has agreed to. Read it before changing the probe, the extraction
or any Meta model call, so we don't relearn something we already paid for.

## Keeping this file current

The owner wants this updated as we go, one step at a time.

- Add a finding once it has been tested, and a decision once the owner has agreed to
  it. Date both. A guess goes under Open questions, not Findings.
- When something here turns out wrong, fix or delete it in the same change. A stale
  note misleads the next session the same way a wrong comment misleads a developer.
- Raw run output lives in `spike/results/` (gitignored, it holds live cookies). Only the
  conclusion and the numbers that support it belong here.
- Keep it under ~400 lines. If a section grows past that, move the detail into
  `references/` next to this file and leave a pointer.

## Decisions (agreed)

- **2026-10-27** The owner is the sole author. No AI co-author trailers or attribution
  in commits, PRs or code.
- **2026-10-27** Field matching runs on `muse-spark-1.3` at `reasoning_effort: "low"`.
  Same answers as normal effort on all 6 test sites, 40–60% fewer output tokens.
- **2026-10-27** Leave Crawlee's `retryOnBlocked` off. A site that blocks a browser
  gets reported as blocked, not worked around (scope rules in AGENTS.md).

## Findings

### Network spike, 20 public sources (2026-10-27)

Probe: `spike/network-probe.js` loads the page, logs every request, keeps JSON
responses, asks Muse Spark which one holds the user's fields, and replays it without a
browser. `spike/batch.js` runs it over `spike/targets.txt`.

| Verdict | Count | Sites |
| --- | --- | --- |
| API route | 3 | World Bank projects, USAspending agencies, EU Funding & Tenders |
| HTML route | 11 | Companies House, Brreg, ABN Lookup, Contracts Finder, Find a Tender, sam.gov, CBK forex, opendata.go.ke, data.worldbank.org, catalog.data.gov, tenders.go.ke |
| Blocked | 3 | FCA register, UNGM, AfDB MapAfrica |
| Not loaded | 2 | GLEIF, FDIC BankFind |
| Server error | 1 | Canada federal corporations (500 in headless, 200 in curl) |

What it means:

- A directly callable endpoint holding the user's data turned up on **3 of 20**. Treat
  that as a lower bound: the probe only watches the first page load and never submits
  a search or clicks to the next page, which is when many apps fetch their data.
- **No hybrid cases.** Every real endpoint answered a plain request with no cookies or
  tokens. Don't build the hybrid route before the demo path works.
- Most registry and procurement sites in this sample are server-rendered. The HTML
  route is the common case, so the receipt has to work there, not only on the API route.
- Best demo candidates for "call this instead": EU Funding & Tenders
  (`POST api.tech.ec.europa.eu/search-api/prod/rest/search`, 11,704 total) and World
  Bank projects (`search.worldbank.org/api/v3/projects`, 28,212 total). Both may be at
  least partly documented, so check before calling either "undocumented" on stage.

### Watching a page's traffic

- Register `page.on(...)` listeners before `goto`, or the document request and early
  XHRs are missed.
- Listen on `requestfinished` (body complete) and `requestfailed`. Playwright doesn't
  await async handlers, so collect their promises and `Promise.allSettled` them before
  closing the browser, or bodies are lost to "Target closed".
- Block service workers (`serviceWorkers: 'block'`); they can answer from cache and
  hide the real network call.
- Navigate with `waitUntil: 'domcontentloaded'`, then wait for `networkidle` with a
  timeout. `'load'` never fired within 30 s on GLEIF, Brreg and FDIC. Treat a
  navigation timeout as non-fatal; the traffic seen so far is still useful.
- `request.headers()` leaves out `cookie`; `await request.allHeaders()` has everything
  actually sent.
- A data endpoint can be a POST with the parameters in the query string. Capture
  `request.postData()` as well as the URL.

### Telling data from noise

- Content-type lies: check the body. JSON arrives as `text/plain` or
  `application/x-javascript`, and some APIs prefix it with `)]}'`.
- Trackers return JSON too. Known hosts (demdex, omtrdc, doubleclick, qualtrics,
  visualstudio App Insights, ...) plus paths like `/collect` and `/track` catch them.
  Adobe often runs on the site's own subdomain (`smetrics.worldbank.org`), so "same
  domain" alone is not a data signal.
- Records can be an array or an object keyed by ID (World Bank's `projects`). Rank
  candidate record lists by bytes, not count: 100 filter options beat 20 full records
  on count.
- The source's own total often sits at the top level (`total`, `totalResults`,
  `count`, `numFound`). That number is what the completeness count checks against.
- **Structure alone picks the wrong endpoint.** Before field matching, the top-ranked
  endpoint was wrong in 6 of 7 "API route" verdicts: feature flags, dropdown lists,
  status feeds and glossaries all look like records. The user's fields are what decide
  it, which is why field matching is a model call.

### Replaying an endpoint without a browser

- Try the smallest request first: plain → plain GET (for a body-less POST) → browser
  headers without session → with cookies/tokens. The first that returns the same
  record list decides the route.
- Count a replay as working only if the same records come back. A firewall's block
  page can return 200.
- World Bank's firewall rejects a POST with no `Content-Length`. `curl -X POST` omits
  it and gets 403; Node `fetch` sends `Content-Length: 0` and gets 200. Record the exact
  request sent so a receipt's replay can be checked.

### Sites that misbehave

- Blocked outright in headless: FCA, UNGM, AfDB (403), npm (Cloudflare challenge),
  TED (AWS WAF), Federal Register, SEC EDGAR. SEC asks automated clients to declare a
  User-Agent, so its block may be a policy you can comply with; check before counting it.
- tenders.go.ke gave three different results in three runs (dropdown API, not loaded,
  no JSON). Live investigation needs retries, and the demo needs pre-tested sources.
- data.worldbank.org makes no data request at all: the GDP series is serialized into
  the 1.3 MB HTML document. That's a route the method table lacks: one plain GET and
  pull the state out, no browser, no selectors.

## Meta Model API (verified 2026-10-27)

- `POST https://api.meta.ai/v1/chat/completions`, bearer `MODEL_API_KEY`, loaded from
  `dapi/.env` with `process.loadEnvFile()`. No SDK needed.
- `response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } }`
  works with `muse-spark-1.3`, including `['integer', 'null']` union types.
- Reasoning effort on chat completions is `reasoning_effort: "low"`. Sending
  `reasoning: { effort }` returns 400 `unknown parameter`.
- `usage` reports `completion_tokens_details.reasoning_tokens` and
  `prompt_tokens_details.cached_tokens`. Most output tokens are reasoning.
- Field matching at low effort: 500–1,200 tokens in, 300–530 out, about
  $0.002–0.004 a call. At normal effort one call on five large ArcGIS config
  responses took over 60 s.
- Field matching was right on all 6 sites it ran on: it picked the record endpoint,
  mapped every field to its key (`"call title" -> metadata.title`), and said "none"
  with a reason where no endpoint held the fields.

## Crawlee and Apify

The method-to-crawler mapping, storage design and settings verified against the docs
are in AGENTS.md under "How Dapi uses Crawlee and Apify". Add findings here once we
have run them, not before.

## Open questions

- **What can vision do that the DOM can't?** Playwright already gives exact on-page
  coordinates for any element, so highlighting where a value came from on an HTML page
  doesn't need a vision model. SAM 3.1 and Muse Spark's image input need a job only they
  can do, or the Meta score suffers. Candidates: PDFs and scanned records (no DOM),
  checking that the value a visitor sees matches what the API returned. The SAM spike
  (`spike/sam-probe.js`) should answer this.
- Can Muse Glimmer do field matching? If yes, running it on Baseten or Modal qualifies
  for the open-weights bonus.
- Why do GLEIF and FDIC stall in headless Chromium? A hung request is invisible to the
  probe because it only logs finished and failed requests.
- How much does interacting with the page (search, next page) raise the 3-in-20 rate?
