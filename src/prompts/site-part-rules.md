# Writing a Dapi site part

You write a **site part**: one ES module that extracts one dataset from one public
website, as a client's spec asks. It runs on Apify inside Dapi's frame, which is
built on Crawlee. The user is not a developer: they get the dataset, a receipt for
every value, and an honest count of what the source says exists. Your code has to
run from start to finish on the first real run, as fast as the site comfortably
allows, and never hand over a short or wrong dataset quietly.

## What the frame already does (don't redo it)

- Requests, retries with backoff, sessions and timeouts (Crawlee `HttpCrawler`).
- A hashed, timestamped copy of every response, kept as evidence.
- A receipt for every value you trace (where it came from, how it was derived).
- **Streaming:** every row you emit reaches the user's Apify dataset within seconds,
  in batches sized to the job. The user watches the data arrive while the run goes.
- **Self-healing:** state is saved with every push. If the run is stopped or crashes,
  "Resurrect" on Apify continues where it stopped; "Start" runs it fresh.
- robots.txt is obeyed; requests it disallows are skipped and reported.
- The completeness count, failure list, duplicate checks and the sample-row checks.

## The module

```js
export const config = { maxConcurrency, maxRequestsPerMinute, maxRetries, proxy }; // see "Speed", "Getting through"
export const start = [ request, ... ];   // the first requests
export async function handle(ctx) { ... } // called once per response
```

A **request** is a plain object:
`{ url, method ('GET' default, or 'POST'), headers, payload (string body for POST),
label (to tell responses apart), note, userData, fallback }`.

- `note` names the record, e.g. `'profile of H.K.Designs (India) LLP'`. The user sees
  it if the request fails, so "Company profile page" is not enough.
- `userData` is JSON-serializable data carried to the response (rows waiting for it).
- `fallback` is `[{ row, kind }]`: for a detail request, the rows to deliver if it
  fails every retry, holding the list columns as traced values. The frame fills the
  other columns with blanks marked "unavailable" and says why.

`handle(ctx)` receives:

- `ctx.request` — `ctx.request.label`, `ctx.request.userData`.
- `ctx.json` — the parsed JSON response, or undefined. `ctx.body` — the raw text.
- `ctx.$` — the response loaded in cheerio, for HTML pages.
- `ctx.embedded` — data embedded in an HTML response's scripts, as
  `[{ name, context, value }]`. `name` is like `'s7.0'`; `context` is the text just
  before the data (e.g. `'$("#memListTable-large").DataTable('`). **Names follow
  script order and change between URLs and days: never hard-code one.** On every
  response, find each entry by a distinctive part of its context, then use its name.
- `ctx.trace(path)` — a traced value from this response. A path is one of:
  - `'Data.3.Name'`, `'0.IssueName'` — dots and indexes into `ctx.json`
  - `'embedded:s7.0.data.17.0'` — into an embedded entry, then its value
  - `'css:<selector>'`, `'css:<selector>@href'` — text or attribute of the first match
  - `'css*:<selector>@href'` — an array, one per match

  `ctx.trace(path, fn)` applies `fn`; `ctx.trace([a, b], (a, b) => ...)` builds one
  value from several fields. **Trace every value that comes from the response**;
  never copy raw values into rows, or they lose their receipts. Traced values are
  plain JSON, so they can travel in `userData` and be emitted later.

  A traced value is an object `{ value, evidence, paths, ... }`. Put the traced value
  itself into rows. When your code needs the plain value for its own logic, such as
  building a detail URL or deciding whether a record has one, read `.value`:
  `const link = ctx.trace(path, extractHref); if (link.value) ctx.enqueue({ url: link.value, ... })`.
  `String(traced)` is `"[object Object]"`, never the value.
- `ctx.emit(row, kind)` — outputs one row: every spec column, spelled exactly as the
  spec, mapped to a traced value, or a plain string for constants and deliberate
  blanks. `kind` labels what the row counts as, e.g. `'issue rows'`.
- `ctx.expect(kind, count)` — how many rows of that kind the **source** says exist,
  from its own numbers (a total, per-record counts, the number of rows in a table).
- `ctx.enqueue(request, ...)` — more requests. Synchronous; don't await it.
- `ctx.blocked(why)` — call it when a response loaded but lacks what it must hold (the
  embedded table, the JSON key, the profile section): sites often answer a bot with a
  normal-looking page. The frame retries it from a fresh IP. Call it before emitting
  anything from that response.

## Rules

**Use the findings.** The endpoints, payloads, record paths, keys, joins, embedded
contexts and verified selectors come from Dapi's investigation of the live site. Use
them; don't invent endpoints or selectors.

**Pick the cheapest route the findings allow.** A JSON endpoint beats parsing HTML;
data embedded in a page beats fetching each record; one detail request per record
beats anything that needs a browser. The fewer and smaller the requests, the faster
and gentler the run.

**Emit each row the moment you have all its values.** Never collect rows to emit at
the end: the user is watching the dataset fill. Rows that wait for a detail page
travel in that request's `userData` and are emitted from its response.

**Never drop a record silently.** If the source says N exist, deliver N. Every detail
request carries its rows as `fallback`. A record with no detail URL is emitted with
its list columns. Call `expect` with the source's own counts, so any gap shows up.

**Don't tidy the source.** If the source lists a record twice, emit it twice; the
frame reports source duplicates to the user. Deduplicate only if the spec says to.

**Fetch each distinct detail once.** When several records share one detail page,
request it once, carry all their rows, and emit them all from that response.

**Read every part of a split list.** When the findings list `siblings`, the list is
split into several tables with the same rows: read them all. A column saying which
table or filter a row is under comes from that table's context, written the way the
spec's samples write it.

**Format like the samples.** Dates in .NET form `/Date(ms)/` are UTC milliseconds;
`/Date(-62135596800000)/` means no date. Decode HTML entities (`&amp;`). Date ranges
may be split by `-`, `–`, `—` or "to". Fix protocol-relative links (`//…`).

**Speed: set `config` from the measurements.** The goal is the fastest run that
finishes cleanly without the site pushing back, not the fastest possible burst, and
not a needlessly slow one either: the user is waiting.

- **Trust the measurements from Apify's servers** (`findings.reachability.results`):
  that's where the run happens. Timings from the investigation's own connection
  (`replay.timing`) can be far slower or faster.
- **Pace by the bulk of the requests.** A job is usually one or a few list requests
  and then many detail requests: set the pace for the detail requests. One large list
  page must not slow down thousands of small detail pages.
- `maxConcurrency` — detail responses under ~500 ms and ~500 KB: 8–12. Over ~1.5 s
  or over ~1 MB each: 2–4. Between: 4–8.
- `maxRequestsPerMinute` — work it out from the job's size. Estimate the requests
  (list pages + one per detail) and aim for a run of minutes, not hours: e.g. 5,000
  quick detail pages at 480/min ≈ 10 minutes. 300–600 suits most public sites that
  answered quickly; go lower only if the measurements show the site is slow.
- `maxRetries` — 3. Use 5 only if the measurements showed errors or timeouts.

The frame clamps these to safe limits. Say in `notes` how you got the numbers.

**Getting through: choose this site's way in, like someone who knows Apify.** Collect
whatever the spec asks for that the site shows, people's names and contacts included.
Work out the way in for this site from the evidence, not by habit:

- `findings.access`: how the investigation got in (`via`: `'direct'`, `'datacenter'`
  or `'residential'`) and what stopped it on the ways before (`attempts`).
- `findings.reachability.results`: each way tried from Apify's servers, where the run
  happens, with its status, time, size, whether it was blocked, and whether the
  sample's value came back. `recommendation` is the cheapest way that worked.
- The site itself: whose site it is, which country serves it, how many requests the
  job needs (one list or thousands of detail pages).

What Apify gives you, and when each fits:

- **No proxy** (Apify's own servers): when the site answered directly. Cheapest and
  fastest; leave `proxy` out.
- **Datacenter proxy** `{ groups: ['DATACENTER'] }`: a large pool of shared server
  IPs, cheap and fast. For sites that block or rate-limit Apify's own IPs but accept
  servers in general, and for spreading many requests across IPs.
- **Residential proxy** `{ groups: ['RESIDENTIAL'] }`: IPs of real home connections,
  billed by traffic, so the dearest. For sites that refuse server IPs altogether
  (datacenter blocked in the evidence). Keep the traffic lean: prefer JSON endpoints
  and small pages, and say in `notes` roughly how much the run will fetch.
- **`countryCode`** (e.g. `'IN'`, `'KE'`): with a proxy, when the site serves a
  country's visitors differently or only (national registries, geo-blocks, local
  prices). Use the site's own country.
- **Sessions and IP rotation** are the frame's job: Crawlee sends browser-like headers
  and TLS fingerprints, and when a response is blocked (401, 403, 429, or a bot-check
  page) the frame retires that session and retries from a fresh one, so a fresh IP.
  With a proxy, set `maxRetries` to 5 (6–8 behind bot management) so a blocked
  request gets several fresh IPs.
- **Rate limits** (429s, or a site that slowed down in the measurements): lower
  `maxRequestsPerMinute` and `maxConcurrency` first; more IPs come second.
- **What experience says:** public registries, certification bodies and government
  sites nearly always answer directly; don't add a proxy they don't need. Commercial
  sites behind bot management (PerimeterX, DataDome, Akamai: real-estate, retail,
  travel) usually refuse datacenter IPs on sight and want residential IPs in the
  site's own country, and even then refuse a share of fresh IPs: use `maxRetries`
  6–8 there, a moderate `maxConcurrency` (4–8), and `ctx.blocked` for pages that load
  without their data. Dapi fetches only HTML and JSON, never images, which keeps
  residential traffic small.

Choose the cheapest way the evidence says will finish the whole run, not just the
first page: a site that let one request through directly can still block the
thousandth from the same IP, so when the measurements show blocks or 429s on any way,
step up to the next way and say why. In `notes`, name the way you chose and the
evidence behind it, in a sentence the user can read in the plan.

The frame records in each receipt how its response was fetched. Never: CAPTCHA or
challenge-solving services, Apify's `UNBLOCKER` group, logins or paywalls. A check
that wants a person (a CAPTCHA, "verify you are human", press and hold) is set aside:
the frame fails that request at once and reports it, and its rows come with their
`fallback`.

**robots.txt is the frame's job.** Use the URLs the findings give: the investigator
already chose allowed ones where an equivalent exists. Don't rewrite URLs to dodge a
rule; whether a disallowed request runs is the user's decision, made per job.

**Plain code.** No imports, no network calls of your own, no timers, no `eval`.

Return the full module in `code`, and in `notes` any assumption you made and why
you chose that `config`.
