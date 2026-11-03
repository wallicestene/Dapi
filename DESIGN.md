---
name: Dapi
description: Web data you can prove, from a mark in four parts that is also the job's progress.
colors:
  paper: "#f2f3ea"
  sheet: "#fbfbf7"
  raised: "#f5f6ef"
  active: "#e6e8da"
  border: "#d9dccb"
  rule: "#e7e9dc"
  control: "#b9bdaa"
  ink: "#1d2c3a"
  ink-2: "#4e5b67"
  ink-3: "#5f6b76"
  night: "#0f1a24"
  source: "#6a4cff"
  extract: "#f12727"
  deliver: "#12b5a5"
  verified: "#9ad82b"
  pencil-green: "#3d7a12"
  pencil-red: "#c42b1c"
  green-wash: "#e9f5d3"
  green-wash-ink: "#2c5a0d"
  red-wash: "#fbe3df"
  red-wash-ink: "#8a1c12"
typography:
  hero:
    fontFamily: "Archivo, sans-serif"
    fontSize: "clamp(44px, 5.4vw, 78px)"
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: "-0.045em"
  display:
    fontFamily: "Archivo, sans-serif"
    fontSize: "38px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Archivo, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Archivo, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Archivo, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
    fontFeature: "'tnum'"
  label:
    fontFamily: "Archivo, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  evidence:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "4px"
  md: "5px"
  lg: "6px"
  xl: "8px"
  card: "12px"
  pill: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-outline:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "32px"
  input-filter:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "32px"
  chip-scope:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    height: "32px"
  chip-scope-on:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
  panel:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.lg}"
    padding: "16px 20px"
---

# Design System: Dapi

## Overview

**Creative North Star: "Every value traced"**

Dapi turns a spec into a dataset and proves every value. The identity says that in one
mark: a D in four parts, one per stage of a job. The stem is the **source** (violet),
the top arc the **extraction** (red), the bottom arc the **delivery** (teal), and the
tick, **verified** (lime), sits exactly where extraction ends and delivery begins. The
mark draws itself in that order, and on a job's page it is the progress: lit up to the
stage the job has reached, the stage under way breathing.

Around the mark the system is calm and exact: navy ink on sage paper, white sheets,
tabular figures, the real product on screen. Colour belongs to the mark and to state;
lime marks traced evidence and nothing else. (Chosen 2026-11-02 from a board of options:
the owner's four-part sketch, made flat and redrawn, with navy, sage and red taken from
a palette they picked.)

**Key Characteristics:**
- The four-colour mark: flat colours, no gradients, legible at 16 px and on dark.
- Navy ink (#1d2c3a) on sage paper (#f2f3ea); sheets one step lighter; navy-black
  (#0f1a24) for dark sections.
- One grotesk, Archivo, bold and tight for headings; IBM Plex Mono only for evidence.
- Show the product, not illustrations: real rows, a real receipt.
- Copy is short and plain (see Voice).

## The Mark

Four strokes on a 64-unit grid (viewBox 4 4 56 56), weight 11 (12 at 32 px and under):
stem `M14 50V14`; extract `M23 14H32A18 18 0 0 1 46.36 21.15`; deliver
`M46.36 21.15A18 18 0 0 1 32 50H23`; tick `M26.5 34.5L31.5 40L52 14` at weight 7
(8.5 small) over a halo of 13 in the background colour, which splits the arcs. Master
files: `web/public/brand/dapi-mark.svg` (the halo is a mask, so it sits on any
background) and `dapi-mark-animated.svg` (draws, holds, fades, loops). In the app:
`Mark` in `web/src/components/shell.tsx` (`draw`, `lit`, `now`, `bg`, `dim`).

- **Draw order:** stem rises, top arc sweeps, bottom arc sweeps round, tick lands
  (about 1.5 s). Still for people who prefer reduced motion.
- **Progress:** stages not yet reached take `dim` (the active tone on paper, #2b3a48 on
  night); the stage under way breathes.
- The wordmark is "Dapi" in Archivo 700 at -0.04em, in ink, beside the mark.

## Colors

### The mark's four
- **Source** (#6a4cff), **Extract** (#f12727), **Deliver** (#12b5a5), **Verified**
  (#9ad82b). They name the stages of a job wherever stages appear (the home page's
  steps, the progress mark). Verified lime is also the highlight on a traced value and
  on the line of a response it came from.

### State
- **Pencil Green** (#3d7a12): the tick beside a traced value, the "S" of a value that
  agrees with a sample, the "F" of a footed total. A deeper cut of the lime, because a
  12 px icon in brand lime fails contrast.
- **Pencil Red** (#c42b1c): an exception: a mismatch, a value that never arrived, a
  refused source, a failed request, a sample the site disagrees with. Washes: red wash
  (#fbe3df) with #8a1c12; green wash (#e9f5d3) with #2c5a0d.

### Neutral
- **Paper** (#f2f3ea) ground; **Sheet** (#fbfbf7) panels, the top bar, the data sheet;
  **Raised** (#f5f6ef) hover; **Active** (#e6e8da) selected rows and unlit mark parts.
- **Border** (#d9dccb), **Rule** (#e7e9dc), **Control** (#b9bdaa).
- **Ink** (#1d2c3a) text and the primary button; **Ink 2** (#4e5b67) secondary text;
  **Ink 3** (#5f6b76) placeholders and meta (5.3:1 on the sheet).
- **Night** (#0f1a24): dark sections (the home page's how-it-works, video frames).

### Named Rules
**The Lime Is Evidence Rule.** Lime fills only a traced value and the line of the
response it came from. Never a button, a badge or decoration.

**The Four Stages Rule.** The mark's colours mean the four stages. Use them for stages,
not for unrelated categories.

## Typography

**Display:** Archivo 700, tight tracking. **Body:** Archivo 400-600. **Evidence:** IBM
Plex Mono. Tabular figures everywhere, so counts and dates line up.

### Hierarchy
- **Hero** (700, clamp 44-78 px, 0.95, -0.045em): the home page's one line.
- **Display** (700, 38px, -0.03em): the footing figure, "43,037 / 43,037".
- **Headline** (700, 28px, -0.03em): the one h1 per app screen.
- **Section** (700, 30-44px, -0.03em): home page section heads.
- **Title** (600, 14-19px), **Body** (400, 13-17px), **Label** (400, 12px).
- **Evidence** (400, 11.5-12px, Plex Mono): requests, response bodies, SHA-256 seals.

### Named Rules
**The Mono Is Evidence Rule.** Monospace only where Dapi shows what a server said or
sent. Never as a "technical" costume.

## Voice

Everything the client reads, from the home page to the plan Muse writes, follows
`src/prompts/client-voice.md`: the answer first; lines under 20 words; plain SaaS words
(dataset, rows, the site's data feed, API, run, proxy); numbers over adjectives; no
code, field names or paths. Muse prompts that write for the client include that file.
Headlines are 2 to 6 words; a subhead is one sentence.

## Layout

App screens: fluid canvas, 28px side padding (24 on tablets, 16 on phones). A job reads
top to bottom: title row (progress mark, h1 and source left, footing figure right), the
six-step strip, then the step's content; on Run, the data sheet with a 360px receipt rail
to its right (below 1024px, under it). The jobs list sits in a centred 1120px column.

Home page: a centred 1240px column. Hero (copy left, the live receipt right; stacked on
phones), how it works on night in four steps (one per mark colour, each with the mark
lit to that stage), real finished jobs as proof, why it holds up (four short claims),
and one closing call to action.

## Elevation & Depth

Flat at rest: a 1px border or one tone step. One soft shadow lifts the home page's live
receipt; otherwise shadows only on what floats (the code sheet, over a 20% ink scrim).

## Shapes

6px on panels, buttons and inputs; 12px on home page cards; a full pill only for the
table's scope chips. Rules do the structuring: row rules, the footing's double rule.

## Components

### Buttons
- **Primary:** ink fill, sheet label, 32px in the app (44px on the home page). One per
  screen: Start a job, Run on Apify.
- **Outline:** sheet fill with a control border: See a delivered job, Open run on Apify.
- **Focus:** a 2px ink outline, 2px offset.

### The Live Receipt (home page, signature)
FSSC's first delivered rows (job 0024) as a table; every cell is a button. The picked
cell turns lime with an ink ring, and the receipt below shows the request, when it was
captured and through which proxy, the SHA-256, and the response's own lines with the
value's line in lime. Data: `web/src/lib/showcase.json`, built from the real capture.

### Job Cards (signature)
The jobs list and the home page's proof: each card is its job's art across the whole card
(the source host's Bauhaus composition from boring-avatars, in the mark's colours,
blurred into a field of colour), with the text on dark glass at the bottom (night at 45%,
a 1px white edge at 15%, backdrop blur, white text). Same site, same art. A job that
didn't deliver goes grey. The status sits top left in a white pill with the progress
mark. The class lives in `web/src/lib/glass.ts`.

### The Step Strip (signature)
Six steps as cards: Spec, Site, Extraction, Samples, Run on Apify, Footed. Each carries
the mark lit to its stage (Spec and Site: source; Extraction and Samples: extract; Run:
deliver; Footed: verified), its tick, and a one-line result. The selected step sits on
white with an ink edge; a stopped step's name turns pencil red; the Run card carries
Apify's logomark, and Apify's colours blended while it runs.

**One moving border on the page:** the step under way has a thin, slow beam in its
stage's colour (Apify's blue to green on the Run card). Nothing else gets a beam; the
plan's quiet teal ring, the code card's shimmer and the run strip's live dot do the rest.

**Each step's control lives in its card's corner**, a 28px round icon button with a
tooltip that says what it does: ⏸ "Pause after this step" on Spec or Site while they
run (pending: a violet ring, click to keep going), ▶ "Resume" on the step a job paused
before, and ⏸ / ▶ for the run itself on the Run card.

### The Agent Timeline (signature)
The Site tab's "What Dapi did": a vertical rule, an icon per action (web search, looked
at a page, tested an endpoint, searched the source…), and a chip naming the Meta model
that acted: Muse Wonder in violet, Muse Spark in teal.

### The Ticked Data Sheet (signature)
Delivered rows in a ruled table, every value followed by its tick; each cell opens its
receipt, and the picked cell turns lime with an ink outline.

### The Receipt Rail (signature)
For the picked value: its ticks as sentences; then the request with its method as a
badge, and the response in a night panel (keys and values in two tones, the value's
line in lime); then the SHA-256 seal and "Re-check the seal", which hashes the body in
the browser and confirms in lime ("Seal verified").

### The Footing (signature)
The Footed tab opens on night: the mark, "43,037 delivered of 43,037 the source lists",
and a bar that fills lime when every count is met (pencil red, with the gap named, when
it isn't).

## Do's and Don'ts

### Do:
- **Do** show the real product and real numbers from finished jobs.
- **Do** foot every dataset against the source's own count and name every gap.
- **Do** keep the mark's colours for the four stages, and lime for evidence.
- **Do** write short: the answer first, one idea per line.

### Don't:
- **Don't** put gradients, glows or glass on anything but a job card's art (below); never on the mark.
- **Don't** use lime on buttons, badges or decoration.
- **Don't** use monospace for anything but requests, responses and seals.
- **Don't** add copy that the person doesn't need to decide or act.
