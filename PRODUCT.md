# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js for the front door (the owner's choice, 2026-10-31). The extraction pipeline is
existing Node code in `src/` (spec reader, investigator, code writer, test loop, frame)
and runs on Apify through the `dapi-runner` Actor. UI components: shadcn/ui on Radix
primitives with Tailwind as the base; Magic UI's NumberTicker and DotPattern (added
from Magic UI's open registry; also listed on 21st.dev, whose registry needs an account
key). Each job card's art is drawn by Dapi from the job's own rows. All restyled to Dapi's own design;
each is declared as a third-party dependency, never presented as built here.

## Users

A non-developer who needs public web data they can stand behind: a compliance officer
pulling registry records, a procurement analyst, a journalist checking a public database,
a team assembling training data that needs provenance. They arrive with a spec (a PDF or
text naming the source, the columns, a few sample rows and rules such as "one row per
issue"), the way data-extraction jobs are actually written. They never see code.

## Product Purpose

Dapi turns an extraction spec into a dataset with a receipt for every value. It reads the
spec, investigates how the public source really serves its data, writes extraction code
against a fixed, tested frame, tests it against the spec's own sample rows, runs it on
Apify, and streams rows into the user's dataset as they are found. Every value carries its
evidence: the exact request, the server's response, when it was captured, and a SHA-256
the user's browser re-checks. Completeness is counted against the source's own numbers,
and a source that can't be extracted gets a plain no with reasons.

Success: the user gets the whole dataset in one run, can open the evidence behind any
cell, and is told exactly what is missing and why.

## Positioning

Dapi finds the back door instead of parsing the front one: the source's own data feed or
the data embedded in its pages, before any HTML scraping. And it gives proof you can look
at, not a log claiming provenance. AI scraping tools flatten the rendered page to text;
Dapi investigates the way a professional does, and shows its work.

## Operating Context

- **Input:** specs in the format clients send (a table of columns, sample values and
  comments). Demo cases, on sources we may use (AGENTS.md, Sources we may use): Better
  Work factory compliance (one row per issue, detail behind a "View" button) and
  Arbeidstilsynet's approved occupational health services (a Norwegian register,
  delivered in English). Demo specs in `specs/` are written by us; clients' documents are
  never shown.
- **The agent's steps the user can watch:** reading the spec; loading the page and its
  network traffic; Muse Spark looking at a screenshot and choosing what to click; finding
  the endpoint or embedded data; checking robots.txt and how the site answers Apify's
  servers; writing the code; testing it against the samples; the plan (records the source
  lists, route, estimated time, any robots.txt question); the run.
- **Runs:** on Apify, in the owner's account for the hackathon (bring-your-own Apify account
  is the production path). The run and dataset links appear the moment a run starts; rows
  stream in batches; a stopped run continues on Resurrect.
- **Timing:** investigation a few minutes (Muse Wonder's agent); code writing 35-90 s;
  runs from seconds (291 rows in one request, 433 rows with a detail request per
  factory) to tens of minutes for tens of thousands of rows.
- **Hosting:** a public URL where judges and gallery voters explore finished jobs and their
  receipts. Live new jobs are shown in the demo video, because Meta credits ($150) and
  Apify usage are limited.

## Capabilities and Constraints

- Routes built: a JSON endpoint (API), data embedded in HTML, HTML detail pages. Browser
  (Playwright) and hybrid routes are not built.
- Whatever the spec asks for and the site shows any visitor, people's names and contacts
  included. Blocks are worked through with Apify's fresh IPs and datacenter and residential
  proxies; a check that wants a person to act (a CAPTCHA, "verify you are human") is set
  aside. No logins or paywalls. Proxies only when the investigation shows a site needs
  them, recorded in every receipt. robots.txt is obeyed by default; fetching despite it
  needs the user's approval per job and is recorded.
- Meta models in use: Muse Voice Transcribe turns a spoken spec into text; Muse Spark reads
  spec PDFs, looks at page screenshots to choose what to click, writes and repairs the
  code, and writes everything the client reads in plain words; Muse Wonder runs the
  investigation as an agent and plans the extraction column by column. SAM 3.1 was tested and does not find records on
  HTML pages, so it is not in the pipeline.
- Hackathon rules (AGENTS.md): new work only, demo only what was built here, no rights
  violations. The owner's earlier freelance scrapers are separate prior work.

## Brand Commitments

The name is Dapi. No logo or visual identity exists yet. Voice: plain, honest and specific
("5,148 of 5,158 delivered: 10 missing, here's which"), never hype.

## Evidence on Hand

- Real runs with real numbers, on reviewed sources only (re-run on Nov 3 after every
  earlier job was removed): Better Work 433 of 433 rows from 186 factories (one row per
  issue), 22 s and $0.025 on Apify; Arbeidstilsynet 291 of 291 approved services in one
  request, 4 s and $0.001; FDA warning letters 503 of 503 for 2026, from the table's own
  data feed, at the 30 s between requests its robots.txt asks for.
- Real artefacts: our demo specs (`specs/*.pdf`), findings files, generated site parts, the
  receipt view (JSON record with the source line marked, embedded row with the cell marked,
  the captured page with the element outlined).
- No customers, testimonials, press, usage figures or pricing exist. None may be invented.

## Product Principles

1. **Show the work.** Every step the agent takes is visible, and every value carries its
   evidence.
2. **Never quietly short.** Counts come from the source; every gap is named with a reason.
3. **The cheapest honest route.** Use the source's own data before parsing its pages.
4. **Say no plainly.** A source Dapi can't or shouldn't extract gets a clear refusal and the
   legitimate alternatives.
5. **The user never sees code, but can see everything the code did.**

## Accessibility & Inclusion

Written for non-developers: plain language, no jargon in the interface. WCAG AA contrast,
keyboard use and screen-reader labels throughout.
