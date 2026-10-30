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
- **2026-10-27** Priorities. *Must have*, on two pre-tested sources: ask (typed or
  spoken question → source and fields), investigate (route, endpoint, field map),
  extract with evidence hashed at capture (API route + one HTML route on
  Crawlee/Apify), receipt view, completeness count, submission (video, X post, public
  repo, entry). *Must have for the Meta score:* a vision job the DOM can't do; the SAM
  spike decides which. *Nice to have:* field matching on Muse Glimmer, pre-flight
  estimate, embedded-state route. *Cut until the demo works:* hybrid route,
  bring-your-own Apify account, generated code.
- **2026-10-27** ~~Open decision 1: config, not generated code.~~ Replaced the same
  day, see below.
- **2026-10-27** Open decision 1 settled: **generated code on a fixed frame, with a
  test loop.** We write the frame once (Crawlee setup, evidence capture and hashing,
  completeness count, retries). Muse Spark writes only the site-specific part. Dapi
  test-runs it on Apify against the spec's sample rows, fixes it (up to ~3 tries),
  then runs it in full. Why: real client specs (Better Work, GPTW India) need detail
  calls, one row per child item and combined fields, which a config can't express,
  and the test loop removes most of the "fails live" risk.
- **2026-10-27** Dapi's input is a **spec document** (PDF or text): columns, sample
  rows and plain-English rules, the way clients actually write extraction jobs. Muse
  Spark reads it; the sample rows become the test cases.
- **2026-10-27** Demo targets: Better Work compliance (API route) and Great Place to
  Work India (embedded data + HTML pages), using specs we write ourselves, never the
  clients' documents. CnVerify is the "honest no" moment (bot wall, personal data).
- **2026-10-28** Clean-room rule: **the code writer never sees a hand-written site
  part**, neither the owner's earlier actors nor `sites/betterwork.js`. It gets the
  spec, the investigator's findings and the frame's contract. The real test is Dapi
  producing a site part on its own that passes the same checks.
- **2026-10-28** The owner's earlier actors for the same targets are separate prior
  work, not part of Dapi. Keep the demo targets and say so plainly in the video.
- **2026-10-30** Runs alert the user the moment they start (Apify run and dataset
  links), and rows stream into the dataset as they are found; nobody waits for the
  end. A stopped or crashed run continues on Resurrect; Start runs fresh.
- **2026-10-30** Getting through (owner's call): Dapi uses what Apify provides,
  Apify Proxy (datacenter or residential, with a country) and Crawlee's built-in
  headers, fingerprints and session rotation, when the investigation shows a site
  needs them to finish a run. Chosen from evidence, recorded in every receipt
  (`via`), cost kept in mind. Still out: CAPTCHA or challenge-solving services,
  logins, paywalls. `retryOnBlocked` stays off. Target sites are public registries
  and similar: data any visitor can see.
- **2026-10-30** robots.txt (owner's call): obeyed by default. The investigator
  first looks for an allowed route with the same data (GPTW: the bare URL). Only if
  there is none does the plan ask the user whether to fetch anyway; on a yes the
  run uses `robotsOverride`, and the report counts and the evidence marks every
  request fetched despite robots.txt. Never silently. For the hackathon demo, use
  sources that need no override (rule 4).
- **2026-10-30** The rules Muse Spark writes code under live in
  `src/prompts/site-part-rules.md`, which the owner can read and edit.
- **2026-10-31** Front door (owner's calls): Next.js, shadcn/ui on Radix + Tailwind
  as the component base, 21st.dev components restyled to Dapi's own design, each
  declared as a dependency. Main user: a non-developer with a spec. Hosted, with
  finished jobs anyone can explore; live new jobs are shown in the video (credits
  are limited). Design must avoid the generic AI-SaaS look: the visual direction is
  chosen on impeccable's decision page, product context is in `PRODUCT.md`.

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

### SAM 3.1 on web page screenshots (2026-10-27)

Probe: `spike/sam-probe.js <url> "<noun phrase>" ...` screenshots up to 3,000 px of
the page and asks SAM for each phrase. About $0.0025 a call; the whole spike cost ~$0.05.

- **Finds object-like UI, accurately:** "logo" (the GOV.UK crown, c 0.82), "button"
  (filled buttons only, c 0.52–0.71), "icon" (round icons, c 0.55–0.82). Every box
  checked against the screenshot was on target.
- **Finds nothing for text-based UI:** "search result", "row", "table row", "table",
  "pagination", "card", "text", "link" all returned no matches. Fair tests: Companies
  House (results are plain text blocks) and World Bank (striped table rows, pagination
  as text links `« ‹ 1 2 3 … 10 › »`). "table" probably means furniture to SAM.
- A neat row of equal "buttons" is not proof of pagination: on World Bank it was the
  footer's social media icons. Check boxes against the screenshot before believing them.
- Not fair tests yet: CBK forex (table below the shot) and EU Funding & Tenders (still
  a loading spinner when captured).
- **Answer to open decision 3, for HTML pages: no.** SAM can't find record blocks or
  pagination on these pages, so masks as receipt evidence for HTML records would be
  decorative, as AGENTS.md warned.

### Muse Spark reading page screenshots (2026-10-27)

Probe: `spike/vision-probe.js <screenshot.png> "<what the page lists>"` asks
`muse-spark-1.3` for a box and the first line of text per record, plus the next-page
control, then draws the boxes on the screenshot so they can be checked by eye.

- **It understands the page.** World Bank: 20 of 20 records, titles read correctly,
  `›` named as the next-page control. Companies House: 3 of 3 company blocks, the
  borderless text records SAM couldn't see, and correctly no pagination.
- **Positions are tight on shorter shots and loose on tall ones.** Companies House
  (1280×1520): each box hugged its record. World Bank (1280×3000, dense table): boxes
  drifted up to half a row near the top, and the next-page box missed `›` by ~40 px.
  Coordinates come on a 0–1000 grid, so a 3,000 px image has 3 px steps.
- Cost at default effort: Companies House 2,676 in / 1,050 out (8 s); World Bank
  4,114 in / 3,316 out (12 s). About $0.008–0.02 a page.
- Takeaway: let Muse Spark decide *what* (which list, how many records, the text each
  starts with, which control is "next") and let the DOM give the exact *where* (the
  element holding that text). Not built or tested yet.

### A real client spec: Better Work compliance (2026-10-27)

The owner gets data-extraction specs like this as paid work. The spec asks for one
row per compliance issue from portal.betterwork.org/transparency/compliance, with three
columns that only appear after clicking "View" on each factory.

- **List:** `POST /Transparency/GetSuppliersComplianceData`, form body with empty
  filters (`countryId=&clusterId=&issueId=&factoryName=&...`). 184 factories, `Total`
  184. Plain request works. Keys: `Name`, `FactoryType`, `Country`, `AssessmentDate`
  (`/Date(ms)/`), `Modality`, `CycleNumber`, `NumberOfNonCompliances`,
  `NumberOfResponse`, `LastAssessmentId`.
- **Detail ("View"):** `POST /Issues/FactoryDetail4TransparencyCompliance` with
  `assessmentId=<LastAssessmentId>&issueId=&clusterId=`. Returns an array, one item per
  issue: `IssueName`, `ClusterName`, `CompliancePointName`, `LegalReference`,
  `AssessmentDateStr` ("25 Aug 2025"). Plain request works.
- **Spec mapping:** Publicly Reported Issue = `IssueName`; Issue Theme =
  `ClusterName + ": " + CompliancePointName`; one output row per issue.
- The spec's samples 2a–2c match the detail response word for word. **Sample 1 (GP
  Solutions Vietnam) is not in the source today**, not even through the portal's name
  search: the portal is a current snapshot (Vietnam 65, Haiti 44, Indonesia 75;
  assessments 2017-01-23 → 2026-09-15).
- Completeness target: 133 factories claim 376 issues in total; 51 have none.
- The probe found the list endpoint by itself, and field matching mapped 8 of 11
  columns and correctly said the 3 issue-level columns weren't in the list.
- **Lesson:** real specs need a detail call per record, one output row per child item,
  combined fields, format conversions and sample rows to check against. "URL + field
  names" can't express that; the spec document itself is the real input.
- Don't show the client's spec document in the public demo or repo (hard rule 5).
  Write our own spec in the same style for the same public portal.

### A second client spec: Great Place to Work India (2026-10-27)

Spec: certified companies from greatplacetowork.in/certified-companies/ with name,
industry, employees, issue and expiry date, website, Facebook, Instagram, LinkedIn,
HQ, description and organization size.

- No JSON call holds the data. Field matching correctly rejected the only candidate,
  a Zoho chat widget config, so the probe said "HTML route".
- **But the listing is structured data embedded in the HTML.** TablePress (a WordPress
  plugin) puts each table's rows in a `<script>` as JSON arrays; the visible `<tbody>`
  is empty until JavaScript fills it. One 2.3 MB GET holds **5,155 rows in four tables,
  `memListTable-large`, `-mid`, `-small` and `-mega`**. Only the first three have tab
  labels (Large 1000+, Mid-size 100–999, Small 10–99 employees). Each table's rows sit
  in the script right after its empty `<tbody>`. Row shape: `[name, industry,
  employees, "Jul 2026 - Jul 2027", "<a href=…/great/company/<slug>>View Profile</a>"]`.
- Spec mapping: Issue Date and Expiration Date = split the certification period on
  " - "; Organization Size = which table the row sits in (H.K.Designs is in `large`,
  matching the client's sample; a guess from the nearest heading text said "Small",
  so map by table id, not by nearby text); Country = the constant "India".
- Website, social links, HQ and description are on each company's profile page,
  `/great/company/<slug>/`: server-rendered HTML, plain GET works. Without the trailing
  slash the link 301-redirects.
- So the whole job is one GET for the listing plus 5,155 profile GETs, no browser.
  That many detail pages is where Crawlee's queue, concurrency limits and failed-page
  list earn their place.
- **Probe gap:** it only inspects JSON responses, so structured data inside HTML reads
  as "HTML route". Embedded-state detection now matters: 2 of 22 real targets so far
  (data.worldbank.org, GPTW India).
- Both client specs share a shape: a listing plus a detail per record, joined, with
  format fixes. Better Work does it over two hidden APIs; GPTW over embedded JSON plus
  HTML pages.

### A third client spec: CnVerify (2026-10-27)

Spec: Chinese company records from cnverify.com search, with English and Chinese
names, status, legal representative, type, founding date, phone, email, a four-level
industry class, address, province and city.

- **Blocked on every path.** A Cloudflare managed challenge (Turnstile) answers the
  search page, `robots.txt` and the terms pages alike; the headless browser gets 403.
  The operator has chosen to block automated access. Per the scope rules and the
  `retryOnBlocked` decision, Dapi stops here.
- **Personal data too:** the legal representative is a named person, and the spec
  asks for phone and email. Even unblocked, that conflicts with AGENTS.md scope.
- What Dapi should do with a spec like this: say it's blocked and why, name the
  personal-data columns, and point to legitimate routes (ask the provider about an API
  or data licence, or go to the official registry).
- Across three client specs: two buildable without a browser after ~10 minutes of
  investigation each, one correctly refused.

### Spec reader (2026-10-27)

`src/read-spec.js <spec.pdf|.md|.txt>` sends the spec to Muse Spark and gets back,
as schema-checked JSON: title, source URL, what one row represents, columns (with
instructions and fixed values), rules, sample rows and questions for the spec's author.
Writes `<spec>.spec.json`. Our own demo specs live in `specs/` as HTML and are rendered
to PDF with `scripts/spec-to-pdf.js`.

- Better Work spec (4 samples, transposed layout): 11 columns, 3 rules, 4 samples, no
  questions. **10 of 11 checked values exact.** The miss was one space: `5(1) (dd)`
  for `5(1)(dd)`, where the PDF wrapped the line between them. 30 s, 5,784 in /
  7,118 out tokens, about $0.04.
- **The PDF text layer drops wrap hyphens** ("ND-" + "CP" → "NDCP"). Muse Spark reads
  the page images too and got `ND-CP` and `TT-BCA` right.
- GPTW spec (one sample, column-per-row layout): 13 columns, "Always India" read as
  `constant: "India"`, split instructions kept, and the 600-character description
  copied exactly with its typos ("craeting", "impaccable"). 21 s, about $0.025.
- **Lesson for the test loop:** values copied out of documents carry line-wrap noise,
  and samples can differ from the source in trivia (the client wrote
  `https://www.hkdesigns.co/`, the source says `https://www.hkdesigns.co`). Compare
  with whitespace and trailing slashes normalized, and show those differences as
  warnings, not failures.

### The frame and the tester (2026-10-27)

`node src/frame/run.js <site-part.js> <spec.json>` runs a site part with Crawlee
(`HttpCrawler`) under the Apify SDK, locally into `storage/` for now.

- **The site part contract** (what Muse Spark will write): export `start` (the first
  requests) and `handle({ request, json, body, trace, enqueue, emit, expect })`.
  `trace('Data.3.Name')` or `trace([a, b], fn)` returns a value plus where it came from;
  `emit(row, kind)` outputs a row; `expect(kind, n)` records what the source claims
  exists; `enqueue({ url, method, payload, label, note, userData })` asks for more.
  Everything else is the frame's: retries, evidence, receipts, completeness, samples.
- **Evidence:** every response is stored in the named key-value store
  `dapi-evidence` as `{ capturedAt, request, response, bodySha256, body }`, keyed
  `ev-<sha256 of the record>`. Each dataset row carries a hidden `#receipt` mapping
  every column to its evidence key and path(s), marked `derived` when we transformed
  it, or `constant`. Apify's `clean=true` export skips `#` fields (docs:
  dataset-items API, "skipHidden").
- **Better Work, hand-written site part (`sites/betterwork.js`):** 427 rows (376
  issue rows + 51 for factories without issues), completeness 376/376 and 51/51, 134
  responses kept, 0 failed, 16 s locally. Samples: A, B2, B3 pass; B1 warns on the
  PDF's line-wrap space, where the extractor's value is the true one.
- Receipts checked: e.g. Teijin's "Issue Theme" traces to `1.ClusterName +
  1.CompliancePointName` in the detail response for `assessmentId=64424`; every
  evidence body hash verified.
- Crawlee gotchas: same-URL POSTs need `useExtendedUniqueKey: true` or they collapse
  into one request. Collect `enqueue` calls and add them after `handle` returns, so
  site code stays synchronous and no request is lost. `respectRobotsTxtFile: true`
  is on; a missing robots.txt (Better Work's is 404) allows everything.
- `src/compare.js` is the tester: unit-tested (`npm test`), whitespace-only and
  trailing-slash differences warn, anything else fails, blanks must stay blank.

### On Apify (2026-10-28)

- `node src/apify/deploy-runner.js` creates or updates the `dapi-runner` Actor in the
  owner's account from inline source files (`runner/` + the frame), through the API,
  and builds it. **The build took 9 s**, so per-attempt builds are cheap; the runner
  takes the site part's code as input anyway, and a finished site part can be saved
  as its own Actor.
- `node src/apify/run-on-apify.js <site-part.js> <spec.json>` runs it. Better Work on
  the platform: 427 rows, 376/376 and 51/51, 134 responses kept, same sample results,
  **35 s** at 1 GB.
- `dataset.get().itemCount` read **0** right after the run and 427 a few seconds
  later. Use `listItems({ limit: 1 }).total` for an immediate count.
- Verified on the platform: items carry `#receipt`; `listItems({ clean: true })`
  leaves it out. The named store `dapi-evidence` held all 134 evidence records.
- **The owner's Apify account already holds their earlier freelance actors**, including
  `better-work-compliance`, `great-place-to-work-scraper` and `cnverify-scraper`. Hard
  rule 1: never read, copy or reuse them. Dapi's actors are named `dapi-*`. Whether
  the demo should use sources the owner has built scrapers for before is the owner's
  call (rule 4, ambiguity).

### Investigator (2026-10-28)

`node src/investigate.js <spec.json>` → `<spec>.findings.json` for the code writer.

1. Loads the page and captures every JSON response (`src/investigate/browser.js`).
2. Muse Spark matches the spec's columns to one endpoint's keys, with a `how` note for
   derived values (`src/investigate/spark.js`, low effort).
3. For columns still missing: finds the row of a **sample record that has values for
   them** on the page, lists that row's clickable controls, and shows Muse Spark the
   screenshot plus the numbered list and the spec's instructions. Picking from numbered
   DOM controls avoids the coordinate drift seen in the vision spike.
4. Clicks the pick, captures the new JSON, matches the missing columns against it.
5. **Join by value:** finds which parameter of the detail request (query, body or path
   segment, 3+ characters) equals a field of the clicked list record.
6. Replays both endpoints without a browser (`src/investigate/replay.js`).

- **Better Work, on its own:** list endpoint (184, `Total` 184, plain replay), 8
  columns mapped, Assessment Date flagged as reformatted; picked "View" on Teijin
  citing the spec's instruction; detail endpoint (3 records, plain replay), Issue
  Theme as `ClusterName + ': ' + CompliancePointName`; join `assessmentId` (body) =
  `LastAssessmentId`. Nothing unmapped. 26 s, 4,479 in / 1,850 out tokens (~$0.015).
- After a click, `waitForLoadState('networkidle')` doesn't wait again (it fires once
  per navigation), so the session counts in-flight requests and waits for 700 ms of
  quiet instead.
- The record finder now accepts an array of one object (a factory with one issue),
  but an object of objects still needs three before it reads as records, not config.

### Code writer and test loop (2026-10-30)

`node src/write-site.js <spec.json> <findings.json> <out.js>`: Muse Spark writes a
site part from the frame's contract (described in prose in the prompt, no example
site part: clean-room rule), the spec and the findings. The frame runs it locally,
`verdict()` checks completeness, failed requests, columns and samples (warnings
allowed), and failures go back to Muse Spark with the previous code, up to 3 tries.

- **Better Work, clean room: passed on attempt 1.** 159 lines, 2,777 in / 8,096 out
  tokens (~$0.04), 35 s to write. 430 rows, 430/430, samples A/B2/B3 pass, B1 the
  known whitespace warning. Same result on Apify through `dapi-runner` (27 s, 135
  evidence records, 430 dataset items).
- **The source changed between runs:** 427 rows / 376 issues on Oct 27, 430 / 379 on
  Oct 30. The hand-written part gives 430 today too. Counts must come from the source
  on every run, never be hard-coded.
- What the writer chose on its own: one row kind with per-factory `expect`, traced
  factory values carried through `userData` so issue rows keep their receipts, a
  blank row when a detail returns no issues (never drop a record), `/Date(...)/` as
  UTC with the year-1 placeholder treated as empty.

### GPTW end to end: embedded data, HTML details, robots.txt (2026-10-30)

- **Embedded data:** `src/embedded.js` finds literals in scripts by bracket matching
  (JSON.parse, else an isolated `vm` with a 1 s limit). GPTW's tables now sit in
  `$("#memListTable-…").DataTable({ data: [[…]] })`, not `var myVariable` as in the
  owner's older actor: never rely on a variable name. 4 tables, 5,158 companies.
- **Embedded names follow script order and differ between URLs:** large is `s7.0` on
  `?type=mid` and `s9.0` on the bare URL. Recognise entries by the text before them
  (last 60 chars), everywhere: investigator, replay, generated code (contract rule).
  A generated part that hard-coded names expected 8,102 companies and could mislabel
  sizes; only the sample's own table proved correct.
- **robots.txt:** GPTW has `Disallow: /*?*`, so the spec's own `?type=mid` URL is
  off-limits; the bare `/certified-companies/` serves the same four tables and is
  allowed, as are profiles. The investigator checks with Crawlee's `RobotsTxtFile`
  (the frame's own parser) and switches only if a plain GET returns the same data.
  The same robots.txt blocks GPTBot, ClaudeBot and Bytespider site-wide: Dapi isn't
  those bots and follows the `*` rules, but the owner should judge it before a demo.
- **HTML detail pages:** when Muse Spark picks a link ("View Profile"), the
  investigator finds the list field holding it, fetches the *sample's* own page (its
  row isn't on screen: DataTables paginates), asks Muse Spark for selectors, verifies
  each against the sample and retries failures once with what they matched. Website
  failed first (`.socialicon` has `<a>` with no href) and was fixed on retry
  (`a[href^='http']`).
- **Duplicates:** rows identical in values AND receipts = read twice (a bug, fails the
  verdict); identical values from different places = the source lists the record
  twice (GPTW: Tata Hitachi), reported, never silently removed.
- **Cost bug caught:** the replay's parsed page leaked into the findings, sending
  2.6 MB (519K tokens, ~$0.65) per writer attempt. Findings are now ~8 KB.
- Writer result: GPTW site part passed test mode (samples + 10 profiles), expecting
  all 5,158. Test mode picks "the samples' requests" by the spec's first column only;
  shared values ("Vietnam") made every request look like a sample's.
- The GPTW listing took ~30 s and profiles ~1–2 s each from Nairobi on Oct 30; the
  investigator now allows 120 s for page loads and 300 s for plain re-fetches.

### Streaming, resurrect and alerts (2026-10-30)

- **Streaming:** rows go to the dataset in batches of ~1/200 of the source's total
  (50–500), pushed at request boundaries, within 2 s of the first buffered row, and
  on migrating/aborting/persistState. Apify: 400 pushes/s per dataset, items < 9 MB,
  no limit on items per push, so size, not rate, is the constraint. On the GPTW run,
  rows were visible in the dataset from second ~47 (132 rows) onward.
- **Saved state** (`DAPI_FRAME_STATE` in the default key-value store): counts,
  failures, partial rows and delivered requests, written with every push, so the
  saved counts always match the dataset. End-of-run checks read the dataset back.
- **Resurrect test (GPTW, full run):** graceful abort at 386 rows → state said
  pushed 386, emitted 386, expected 5,158, 383 requests delivered. Resurrected: it
  carried on, "resumed 1x", no rows read twice, source duplicates still reported.
  Finished SHORT 5,148 of 5,158: one 403 profile (old part, no fallback rows) and
  ~9 rows in flight at the abort. Fixed: once `aborting`/`migrating` arrives, each
  finishing request awaits its own rows' push before Crawlee marks it done.
- Apify dataset counts lag on big runs too: `listItems().total` read 3,174 of 5,157
  a minute after the run; `run-on-apify.js` waits for it to match the report.
- **Alerts:** `run-on-apify.js` starts the run and prints the console and dataset
  links at once, then rows so far every 15 s. The frame's status line shows "N rows
  delivered of M the source lists · F failed" in the Apify console.

### Reachability from Apify and measured speed (2026-10-30)

- The runner has a probe mode: fetch the list and the sample's detail from Apify,
  direct → datacenter → residential, stop at the first that returns the sample's
  value without block signs. Apify Proxy has no `DATACENTER` group: datacenter is the
  default when no group is named; `RESIDENTIAL` is a group.
- Better Work from Apify: direct, list 4.1 s / 54 KB, detail 148 ms. GPTW from Apify:
  direct, listing 1.9 s / 2.4 MB (vs ~30 s from Nairobi), profile 250 ms / 210 KB.
- With vague speed rules Muse Spark chose 4 concurrent / 180 per minute for both
  (GPTW ≥ 26 min). With "use Apify-side timings, pace by the detail requests, aim
  for minutes": Better Work 10/500/3, GPTW 10/480/3 (~10 min).
- **`String(traced)` is `"[object Object]"`.** A GPTW part built profile URLs that
  way, so every company took the "no profile" branch: 5,158 rows, complete counts,
  every profile column blank. Only the sample check caught it, and three repair
  attempts didn't, because "empty columns" didn't say why. Now the rules explain
  `.value`, and the verdict says outright when no detail request was ever made.

### Full runs of the generated parts on Apify (2026-10-30)

Both parts written by Muse Spark in the clean room, under the sharpened speed rules,
run in full on Apify with no human edits:

- **Better Work** (10/500/3): 430 of 430 issue rows in 15 s, 135 responses kept,
  0 failed. Samples: 3 pass, 1 warn (B1's Legal Reference: the spec writes
  "5(1) (dd)", the source "5(1)(dd)"; delivered as the source has it).
- **GPTW India** (10/480/3): 5,158 of 5,158 companies in 956 s (~16 min), 4,773
  responses kept, sample passes. One profile (Cerner Healthcare Solutions India) got
  a 403 on every retry; its row was still delivered with the list columns and a
  receipt saying why. The two companies the source lists twice were reported, not
  removed.
- The GPTW run **resumed once by itself** (an Apify migration, no one pressed
  anything) and finished with no rows read twice: the streaming and saved-state work
  held under a real interruption, not only the staged abort.

### Receipt view (2026-10-30)

`node src/receipts/server.js` → http://localhost:4173, reading `storage/`. Every cell
opens: request + body, capture time, SHA-256 re-checked in the browser with
`crypto.subtle`, and the evidence focused on the value (JSON record with every source
line marked, embedded row with the cell marked, or the captured page in a sandboxed
iframe with the element outlined; cheerio-only selectors are marked server-side). The
captured page's styles come from the live site: GPTW took ~21 s to render.

### What the owner's earlier scrapers teach (read 2026-10-28)

The owner's freelance actors `better-work-compliance` (Nov 2025),
`great-place-to-work-scraper` (Jul 2026) and `cnverify-scraper` (Jun 2026) predate
the hackathon. They were read once, with the owner's permission, for practice only.
**No code from them goes into Dapi** (hard rule 1), and they are never shown to the
code writer. Lessons, in our own words:

- **Never drop a row silently.** When a detail fetch fails, still output the record
  with what the list gave, and say so: one used a visible error marker in the row,
  another emitted base-only rows. Both reconcile rows pushed against rows expected
  and warn on a mismatch. That is Dapi's completeness count, done by hand.
- **Fetch each detail page once.** When several list rows point to the same profile,
  group them by URL, fetch once, and fan the details out.
- **Check every filter variant for coverage.** GPTW has four lists, including
  `?type=mega`, not just the three tabs a visitor sees. The investigator should try a
  page's filter values before believing it has the whole source.
- **Embedded data can be a JavaScript literal, not JSON** (GPTW: `var myVariable =
  [...]`). The owner parsed it in an isolated `node:vm` context; never `eval` page
  code in-process.
- **Prefer structured data in the HTML** (JSON-LD) over DOM selectors, and when using
  the DOM, find fields by their visible label (`th:contains("Address") + td`) rather
  than by position. Labels survive layout changes.
- **Format traps:** .NET `/Date(-62135596800000)/` is year 1, the "no date"
  placeholder, so treat it as empty; decode HTML entities inside embedded strings;
  date ranges may be split by `-`, `–`, `—` or "to"; fix protocol-relative links
  (`//…`) and encode non-ASCII hrefs; classify social links by domain.
- **Out of scope for Dapi:** the CnVerify actor gets past Cloudflare with a paid
  challenge-solving service and residential proxies. Dapi reports such sites as
  blocked instead (decision of 2026-10-27).

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
- SAM 3.1: `POST /v1/responses`, `model: "sam-3.1"`, one user message with
  `{ type: "input_image", image_url: "data:image/png;base64,..." }` and
  `{ type: "input_text", text: "<one noun phrase>" }`. `metadata.include_confidence:
  "true"` adds `c`. The answer is text: `<0f>` then comma-separated records
  `id<|box;x1=;y1=;x2=;y2=;w=;h=;c=|><|mask;x=;y=;c=;data=H,W,~<base85>|>`. Boxes are
  source pixels. No match is an empty string, not an error. The raw JSON keeps the
  text in `output[].content[].text`. Docs: dev.meta.ai/docs/sam/segmenting and
  /docs/sam/reading-segmentation.
- Images to Muse Spark on chat completions: a content part
  `{ type: "image_url", image_url: { url: "data:image/png;base64,..." } }` next to the
  `{ type: "text" }` part. Up to 50 images and 50 MB each inline. A ~1280 px image is
  about 1,300–1,500 tokens. Grounded positions come back on a 0–1000 grid; convert with
  `x = round(x_norm * width / 1000)` and clamp, since the model can say 1001.
  Docs: dev.meta.ai/docs/image-understanding.
- PDFs to Muse Spark on chat completions: a content part
  `{ type: "file", file: { filename, file_data: "data:application/pdf;base64,..." } }`.
  Inline up to 50 MB; text from the first 100 pages, page images from the first 50.
  Docs: dev.meta.ai/docs/file-handling.
- `GET /v1/models` lists what the key can use: muse-wonder-1.0, muse-spark-1.3 (and
  1.2, 1.1, contributor variants), sam-3.1, muse-voice-transcribe-1.0, muse-image-1.0.

## Crawlee and Apify

The method-to-crawler mapping, storage design and settings verified against the docs
are in AGENTS.md under "How Dapi uses Crawlee and Apify". Add findings here once we
have run them, not before.

## Open questions

- **What can vision do that the DOM can't?** Playwright already gives exact on-page
  coordinates for any element, and SAM can't find records or pagination on HTML pages
  (see Findings). Muse Spark *can* read a screenshot and say which blocks are the
  records and which control is "next" (see Findings). Still untested: binding its
  answer to exact DOM elements; PDFs and scanned public records, where there is no DOM;
  SAM on object-like marks in documents (seals, stamps, signatures, photos).
- Can Muse Glimmer do field matching? If yes, running it on Baseten or Modal qualifies
  for the open-weights bonus.
- Why do GLEIF and FDIC stall in headless Chromium? A hung request is invisible to the
  probe because it only logs finished and failed requests.
- How much does interacting with the page (search, next page) raise the 3-in-20 rate?
- Better Work: should a factory with 0 issues get one row with blank issue columns, or
  no row? The client's spec doesn't say (ours does: one row). Dapi should ask the user
  when a spec is ambiguous.
- GPTW: the page has a fourth `mega` table (`?type=mega`) that has no visible tab and
  that the spec doesn't mention. Questions like that only surface during
  investigation, so the investigator needs a way to ask the user too, not just the
  spec reader.
- Frame: should a failed detail request still emit its rows with the detail columns
  blank and the receipt marked "detail unavailable", instead of only showing up as a
  short count? The owner's practice says yes.
