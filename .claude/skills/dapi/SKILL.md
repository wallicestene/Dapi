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
- GPTW: the page has a fourth, unlabelled `mega` table the spec doesn't mention.
  Questions like that only surface during investigation, so the investigator needs a
  way to ask the user too, not just the spec reader.
