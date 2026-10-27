# AGENTS.md — Meta Global AI Developer Hackathon

Project context for any coding agent working in this repo. Drop this at the repo root.
Muse Code, Claude Code, Cursor and Codex all read it automatically.

Keep this file current. A context file that drifts out of date misleads an agent the
same way a wrong comment misleads a developer.

---

## What this is

**Project name: Dapi.**

A solo entry in the **Indie Developer track** of the Meta Global AI Developer
Hackathon, run by Meta and Cerebral Valley. Built Oct 26 – Nov 4, 2026.

Goal: top 5 in the indie track, plus bonus prizes.

**Current status (Oct 27):** architecture not finalised. Running throwaway spikes
under `spike/` to test two assumptions before committing — see Open decisions at
the end of this file. Nothing under `spike/` is production code.

---

## The idea

**Problem statement chosen:** Build for Your World.

**What it does.** You give it a public web source and the fields you want. It
investigates how that data is actually served, picks the cheapest reliable
extraction method, runs the extraction on Apify, and delivers the dataset with a
receipt: every value traceable to the exact evidence it came from, captured and
hashed at the moment of extraction, plus an honest completeness count.

**Who it is for.** Someone who needs web data they can stand behind and cannot
write a scraper — a compliance officer pulling registry records, a procurement
analyst, a journalist checking a public database, a team assembling training data
that needs provenance. Not developers. The user never sees code.

**Why the Meta model is load-bearing.** Muse Spark reads the rendered screenshot
and the DOM *together* to bind each extracted value to its location on the page —
every competing tool flattens pages to text. SAM 3.1 segments the page image to
find the repeating record block and the pagination control visually, and those
masks become the visual evidence in the receipt. Remove the Meta models and the
provenance layer has nothing to point at.

### The investigation (this is the differentiating step)

Do NOT go straight to the DOM. Inspect the network first, the way an experienced
scraper opens devtools before touching HTML:

- Watch fetch/XHR traffic while the page loads
- Look for endpoints returning JSON, and inspect their request params, headers,
  auth tokens and pagination scheme
- Only then consider the rendered HTML

Then choose a method:

| Finding | Method |
| --- | --- |
| JSON endpoint reachable directly | Call the API. Cheapest, most stable, structured at source |
| Server-rendered HTML, no JS needed | Axios + Cheerio |
| JS-rendered, no reachable API | Playwright |
| API exists but needs cookies/tokens/signed params | **Hybrid** — Playwright once to acquire credentials, then call the API directly |

The hybrid path is where the real craft is. Parsing the DOM when a clean JSON
endpoint is available is the amateur move, and it is exactly what every AI
scraping tool currently does.

Cost note: network interception needs a Playwright pass per target during
investigation. That is a one-time scouting cost per source, not per record.

### The receipt

Every delivered value traces to evidence, hashed and timestamped at capture:

- **API route** — the request URL, params, and the raw JSON response. Better
  evidence than a screenshot, because it is the server's own words.
- **DOM route** — the screenshot region (SAM mask) plus the HTML snippet.

Plus a **completeness count**: records retrieved versus records the source's own
pagination claims exist. If 13 are missing, say so and say which pages. The tool
must never quietly hand over a short dataset.

### Scope rules

Public sources only — data any visitor can see without authentication. No logins,
no paywalls, no terms-of-service violations, no personal data. This is both the
hackathon rule on rights and the honest position for the product.

### Demo beats, in order

1. A non-developer user with a real question, not a URL bar
2. The investigation finding an undocumented JSON endpoint — "don't parse this,
   call this instead"
3. Click a delivered cell, watch the original page light up around that value
4. The completeness count catching what it missed

---

## Hard rules — do not violate these

These cause disqualification, not point loss.

1. **New work only.** Every commit must fall between Oct 26 and Nov 4, 2026. Do not
   vendor in, copy, or resurrect prior code and present it as built here. If a prior
   library is used, it is a dependency, declared as such.
2. **Public repo.** The GitHub repository must be public and must open in a
   logged-out browser. Verify this before submitting, not after.
3. **Meta models required.** The project must call Meta's models. Eligible:
   Muse Spark series, Muse Wonder, Muse Image, Muse Voice Transcribe, SAM 3.1 via
   the Meta Model API; or the open-weights models Muse Glimmer and Muse Spark Open.
4. **Demo only what was built here.** Judges must be able to tell what was created
   during the event. Ambiguity is treated as a violation.
5. **No rights violations.** No code, data, assets or scraped content without rights
   to use it.

### Banned project categories

Meta published these as generic or policy-violating. Do not drift toward any of them:

- Any project giving medical advice
- Basic RAG applications
- Simple image analyzers
- "AI for education" chatbots
- AI job application screeners
- AI nutrition coaches
- Personality analyzers
- Sports analyzers or coaches
- Anything political or involving war

---

## What the judges score

Optimize for this rubric, in this order. Technical depth is the **smallest** weight.

| Criterion | Weight | What it rewards |
| --- | --- | --- |
| Impact | 30% | Real-world potential; could people actually use this |
| Use of Meta AI tooling | 25% | Creative use beyond basic integration; capabilities that surprise Meta |
| Demo | 25% | Working, impressive, holds up live; video is good to watch |
| Technical depth & execution | 20% | Sound engineering, visible craft |

**Implications for how you build:**

- A feature that does not appear in the 3-minute demo video is worth close to nothing.
  Prefer one demo-able feature finished over three half-features.
- If the product works identically with a non-Meta model swapped in, 25% of the score
  is forfeited. Reach for modalities other entrants will skip — voice transcription,
  segmentation, image generation — not just text completion.
- Polish the demo path specifically. The happy path must never fail live.

---

## Deadlines

| When | What |
| --- | --- |
| Nov 4, 9:00 PM ET | Submission closes — **5:00 AM Nov 5 in Nairobi** |
| Nov 8, 11:59 PM ET | X engagement cutoff for the Most Viral bonus |
| Nov 9 | Top 5 per track announced, live final judging |
| Nov 16 | Community vote winner |

Four things submitted: the Cerebral Valley entry, a 3-minute demo video, the public
repo, all before the deadline.

---

## Bonus prizes in play

These stack. One project can win several. Build toward them deliberately.

- **Most Viral — $20K.** Judged purely on X engagement, entirely outside the rubric.
  Requires posting the demo on X and submitting the link. Most entrants will forget.
- **Best Build on Meta Open Weights — $10K.** Requires running Muse Glimmer or
  Muse Spark Open on own hardware or partner inference (Baseten / Modal), verified by
  the infra partner. This affects architecture: route inference accordingly from the start.
- **Community Vote — $10K.** Public gallery votes.
- **Best Agentic Use-Case — $5K.** Scored on autonomy, effectiveness, practical usefulness.
- **Best Creative Build — $5K.** Requires Muse Image or Muse Wonder.

---

## Meta Model API — the full surface

Base URL `https://api.meta.ai/v1`. Auth is a bearer token in `MODEL_API_KEY`.
Drop-in compatible with the OpenAI SDK, the Anthropic SDK, and OpenAI-compatible
agent CLIs — set the base URL, add the key, keep the rest of the code.

Three request formats, same models, same auth, same cost:
`/v1/responses` (agentic, multi-step, server-managed state), `/v1/chat/completions`
(OpenAI-shaped), `/v1/messages` (Anthropic-shaped).

### Models

| Model ID | In | Out | Price | Use it for |
| --- | --- | --- | --- | --- |
| `muse-wonder-1.0` | text, image, video, audio, PDF | text | $4 / $20 per 1M | Hardest reasoning, long-horizon agents, multi-file work. 1M context |
| `muse-spark-1.3` (also 1.2, 1.1) | text, image, video, audio, PDF | text | $1.25 / $4.25 per 1M | The workhorse. Agentic loops, tool calling, multimodal understanding. 1M context |
| `muse-spark-1.3-contributor` (also 1.2) | same | text | $0.10 / $0.20 per 1M | Same model, 12–21x cheaper, in exchange for Meta training on your content |
| `muse-image-1.0` | text prompt, image | image | $0.01 per image | Generating and editing images, refined across turns |
| `muse-voice-transcribe-1.0` | audio | text + timing | $0.18 per hour | Streaming or file transcription, speaker attribution, turn detection, 25 languages with code-switching |
| `sam-3.1` | text prompt + image/video | boxes + masks | $2.50 / 1k images; $0.20 / 1k frames | Naming an object in words and getting pixel-accurate masks, tracked across video frames |

Open-weight, self-hosted or via partner inference, not on Model API:
**Muse Spark Open** (816B MoE, 42B active — read text, image, audio, video) and
**Muse Glimmer** (distilled, Apache 2.0, built for local and edge).

### Capabilities worth reaching for

Tool calling (parallel, streamed) · tool search (load deferred tools on demand) ·
search grounding (real-time answers with inline citations, no retrieval stack —
$2.50 per 1k queries) · image understanding · image generation · speech to text ·
video understanding · media segmentation · file handling (upload once, reference by
ID) · reasoning effort per request · structured output against a schema ·
prompt caching · token counting.

### Practical notes

- Set reasoning effort per request. Pay for thinking only where it matters. On
  `/v1/chat/completions` the parameter is `reasoning_effort: "low"`; sending
  `reasoning: { effort }` there returns 400 (tested Oct 27). `low` roughly halves
  reasoning tokens on a trivial prompt.
- Prompt caching: cached input is $0.20 per 1M on Wonder, $0.15 on Spark. Keep the
  stable part of the prompt at the front. Check `cached_tokens` in the response.
- No long-context premium — a full 1M context costs the same rate as an empty one.
- SAM video requests are billed at a 50-frame minimum, so short clips cost the same
  as 50 frames.
- Rate limits are per team, not per key: 3,000 RPM and 4M TPM on Wonder and Spark
  standard; 150 RPM on contributor variants and on Muse Image.
- Retry 429s with exponential backoff and jitter; honour `Retry-After`. Read
  `x-ratelimit-remaining-tokens` and slow down before hitting the wall.
- Baseten docs say `meta-models/muse-spark-open`; this hackathon needs
  `meta-models/muse-spark-open-1026`.
- $150 of credits. Set a spend limit on the Billing page.
- Keep API keys out of the repo — it is public. Environment variables only, and
  confirm no key was ever committed before publishing.

---

## Apify

Extraction runs on Apify. Do not rebuild actors, proxies, scheduling or storage.

What it provides: **actors** (the runnable unit), **datasets** (append-only result
storage), **key-value stores** (arbitrary blobs — this is where captured
screenshots and hashes go), and **request queues**. The `apify-client` npm package
drives all of it from an external orchestrator; the `apify` SDK is for code running
*inside* an actor.

**Verify API signatures against the current Apify docs before writing against them**
— do not rely on remembered method names. Confirm specifically: how to run an actor
and poll for completion, how to push records with attached key-value store
references, and what the storage limits are.

Account: use the project owner's own Apify account for the hackathon. Do not build
a bring-your-own-token flow — a signup wall in the demo costs more than it proves.
Note BYO-account as the production path in the README.

### How Dapi uses Crawlee and Apify

Checked against the Crawlee 3.x and Apify docs on Oct 27. Re-verify before writing
code against any of it.

Each extraction method maps to one Crawlee crawler, and all four share the same
`requestHandler` shape:

| Method | Crawlee |
| --- | --- |
| JSON endpoint | `HttpCrawler` — accepts `application/json` by default, handler gets parsed `json` |
| Server-rendered HTML | `CheerioCrawler` — replaces Axios + Cheerio; its HTTP client is `got-scraping` |
| JS-rendered | `PlaywrightCrawler` |
| Hybrid | `PlaywrightCrawler` for the first page, then `sendRequest()` from the context for the API calls |

Crawlee's experimental `AdaptivePlaywrightCrawler` switches between a browser and
plain HTTP for HTML pages. It never looks for JSON endpoints. That gap is Dapi's.

By pipeline stage:

- **Investigate** — the spike's network listeners move into `PlaywrightCrawler`'s
  `preNavigationHooks`, which run before navigation. (Signature verified for
  `HttpCrawler` only so far.)
- **Estimate** — record count from the source's own total. Time and cost from a
  sample run with `maxRequestsPerCrawl` set low; the run object reports usage and
  stats.
- **Extract** — the backend starts the Actor with `apify-client`:
  `actor(id).start()` returns at once, `.call()` polls until the run finishes.
  Pagination goes through the request queue; failed pages retry up to
  `maxRequestRetries` (default 3).
- **Proof** — evidence goes in a **named** key-value store (unnamed stores expire
  after 7 days). Key = SHA-256 of the evidence bytes: 64 chars, within the 256-char
  key limit and the `a-zA-Z0-9!-_.'()` charset. One API page backing many rows is
  stored once. Dataset rows carry `{ value, evidenceKey, capturedAt }`. Pre-signed
  URLs give time-limited links to single records, so the receipt UI never exposes
  the API token.
- **Completeness** — `failedRequestHandler` fires once per page that failed all
  retries. That list is the "which pages" in the missing-records report.

Scope settings: leave `retryOnBlocked` off — it tries to get past Cloudflare bot
protection, which breaks the scope rules. Turn `respectRobotsTxtFile` on.

Still unverified: the dataset item-count API and the per-record size limit of a
key-value store.

## Open decisions

These are not settled. Do not assume one and build it without asking.

1. **Generated code vs. parameterised config.** Either the investigation emits
   actor code that gets deployed and run, or it emits a config (method, selectors
   or endpoint, pagination scheme, field map) that drives one pre-built actor.
   Codegen is more impressive and closer to how the owner actually works; config
   cannot fail live during a demo. Decide after the spikes.
2. **Whether Apify is needed for the API route at all.** If a target serves clean
   JSON from a reachable endpoint, extraction may be plain authenticated HTTP with
   no browser and no actor. If spike results show endpoints are common, Apify may
   only be needed for the browser-based routes.
3. **How much SAM 3.1 earns its place.** If it cannot reliably mask repeating
   record blocks and pagination controls on real pages, the vision layer is
   decorative and the receipt must rest on HTML snippets and API responses instead.

### Spikes in flight

- `spike/network-probe.js` — how often do real targets serve their data from a
  JSON endpoint that could be called directly? Decides open decisions 1 and 2.
- `spike/sam-probe.js` — can SAM 3.1 find record blocks and pagination in a page
  screenshot? Decides open decision 3.

## Working style

- Explain changes as you make them rather than emitting large finished blocks. The
  repo owner prefers to understand and write code himself with step-by-step guidance.
- Short, direct explanations. No preamble.
- Commit frequently with clear messages — the commit history is evidence of what was
  built during the event, and judges can read it.
- The repo owner is the sole author. No AI co-author trailers or attribution lines
  in commits, PRs or code.

<!-- END OF AGENTS.md -->