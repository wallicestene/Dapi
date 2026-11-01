---
name: Dapi
description: Web data you can stand behind, presented as an auditor's working paper.
colors:
  working-paper: "#eef1ea"
  schedule-sheet: "#f8f9f5"
  raised-sheet: "#f2f4ee"
  selected-row: "#e1e6da"
  sheet-edge: "#d3d9cc"
  row-rule: "#e3e7dd"
  control-edge: "#b5beae"
  graphite: "#22252a"
  graphite-soft: "#545a61"
  graphite-faint: "#60666c"
  pencil-green: "#2b7449"
  pencil-red: "#b3302a"
  green-wash: "#dce9dc"
  green-wash-ink: "#1c4a2f"
  red-wash: "#f5dedb"
  red-wash-ink: "#7a1f19"
typography:
  display:
    fontFamily: "Archivo, sans-serif"
    fontSize: "38px"
    fontWeight: 600
    lineHeight: 1
    fontVariation: "'wdth' 72"
  headline:
    fontFamily: "Archivo, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 72"
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
  pill: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.schedule-sheet}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-outline:
    backgroundColor: "{colors.schedule-sheet}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.lg}"
    height: "32px"
  input-filter:
    backgroundColor: "#ffffff"
    textColor: "{colors.graphite}"
    rounded: "{rounded.lg}"
    height: "32px"
  chip-scope:
    textColor: "{colors.graphite-soft}"
    rounded: "{rounded.pill}"
    height: "32px"
  chip-scope-on:
    backgroundColor: "{colors.schedule-sheet}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.pill}"
  panel:
    backgroundColor: "{colors.schedule-sheet}"
    rounded: "{rounded.lg}"
    padding: "16px 20px"
---

# Design System: Dapi

## Overview

**Creative North Star: "The Working Paper"**

Dapi's screens are an auditor's working papers for web data. A schedule sheet lies on a pale green-grey desk; graphite ink sets everything; and two pencil colours mark what was checked. Green means a check held. Red means an exception. Every delivered value carries the tick that says what it was checked against, and every dataset is footed against the source's own total on a double rule. The product's whole claim is that its data can be stood behind, so the screen looks like the paper a compliance officer, procurement analyst or journalist would sign off.

Density is that of a working tool, not a landing page: tables with rules and alignment, small sentence-case labels, figures in tabular digits that line up on their right edge. Expression lives in three places only: the condensed cut of the type for titles and the footing figure, the tick marks, and the double-ruled footing line. Everything else is plain, standard web controls the visitor already knows.

The category default this refuses is the AI agent console: a chat timeline beside a table, with "verified" badges. Dapi shows the agent's work as steps of an audit, and its evidence as the server's own words.

**Key Characteristics:**
- Pale green-grey ground, sheets one step lighter, no shadows at rest.
- Graphite ink; colour appears only as pencil marks on data and states.
- One grotesk (Archivo) whose condensed width sets titles and the footing figure; IBM Plex Mono only for requests, responses and seals.
- Tick marks on values, a legend docked under the table, totals on a double rule.
- Light only: it is read at a desk, like the paper it comes from.

## Colors

A paper desk and graphite, with two pencils that only ever touch data.

### Primary
- **Pencil Green** (#2b7449): a check that held. The tick beside a traced value (at 45% strength in the table, where nearly every value is traced, so exceptions stand out), the "S" of a value that agrees with the spec's sample, the "F" of a footed total, a seal re-checked in the browser.

### Secondary
- **Pencil Red** (#b3302a): an exception. A near-match or a mismatch with a sample, a value that never arrived, a refused source, a failed request. Washes: **Red Wash** (#f5dedb) with **Red Wash Ink** (#7a1f19) for refusal and robots.txt notices; **Green Wash** (#dce9dc) with **Green Wash Ink** (#1c4a2f) to mark the line in a response a value came from, and for text selection.

### Neutral
- **Working Paper** (#eef1ea): the page ground.
- **Schedule Sheet** (#f8f9f5): panels, the top bar, the data sheet, the receipt rail.
- **Raised Sheet** (#f2f4ee): hover, and the selected step in the step strip.
- **Selected Row** (#e1e6da): the row whose cell is open in the receipt rail.
- **Sheet Edge** (#d3d9cc): 1px panel borders. **Row Rule** (#e3e7dd): rules between rows and list items. **Control Edge** (#b5beae): input, outline-button and dropzone borders.
- **Graphite** (#22252a): all primary text, the primary button, focus rings, the selected cell's outline, the footing rules. **Graphite Soft** (#545a61): secondary text and column headers. **Graphite Faint** (#60666c): placeholders, row numbers, timestamps (5.4:1 on the sheet).

### Named Rules
**The Two Pencils Rule.** Colour is only ever a pencil mark on data or state: green for a check that held, red for an exception. No colour on chrome, navigation or buttons.

**The Quiet Tick Rule.** Where most values pass, the routine tick recedes (green at 45%) and only exceptions are drawn at full strength.

## Typography

**Display Font:** Archivo, condensed (width 72) (with sans-serif)
**Body Font:** Archivo, normal width (with sans-serif)
**Label/Mono Font:** IBM Plex Mono (with monospace), for evidence only

**Character:** One sturdy grotesk in two widths: the condensed cut reads like the headings typed on an accountant's schedule; the normal width carries the work. Tabular figures everywhere, so counts and dates line up.

### Hierarchy
- **Display** (600, 38px, line-height 1, condensed): the footing figure, "430 / 430", top right of a job.
- **Headline** (600, 28px, 1.25, condensed, -0.01em): the one h1 per screen: the job's or the page's name.
- **Title** (600, 14-16px): panel headings, step names in the step strip.
- **Body** (400, 13-14px, 1.6): table cells (13px), sentences and lists (14px).
- **Label** (400, 12px): column headers in sentence case, step results, captions, legends.
- **Evidence** (400, 11.5-12px, Plex Mono): requests, response bodies, SHA-256 seals.

### Named Rules
**The Typed Schedule Rule.** The condensed cut is for the h1 and the footing figure only; nothing else is condensed.

**The Mono Is Evidence Rule.** Monospace appears only where Dapi shows what a server said or sent: requests, responses, seals. Never as a "technical" costume.

## Layout

Fluid canvas with 28px side padding (24px on tablets, 16px on phones), one 16-20px gap between blocks. A job screen reads top to bottom: title row (h1 and source left, footing figure right), the six-step strip as one bordered container split by rules (6 columns on desktop, 3 on tablets, 2 on phones), then the step's content. On the Run tab, the data sheet takes the width and a 360px receipt rail sits to its right (`minmax(0,1fr) 360px`, 20px gap), sticky as the sheet scrolls; below 1024px the rail drops under the sheet. The data sheet scrolls inside its own frame both ways; the row number and the identity column stay pinned on the left. Lists of jobs sit in a centred 1120px column.

## Elevation & Depth

Flat. Surfaces are separated by a 1px edge or one tone step, never a shadow at rest. The only shadows are on what floats: the code sheet that slides in from the right, over a flat graphite scrim at 20%.

### Named Rules
**The Paper Lies Flat Rule.** A border or a tone step, never both a border and a shadow; nothing at rest casts a shadow.

## Shapes

Tight corners: 6px on panels, buttons and inputs, 4-5px on small controls, a full pill only for the scope chips over the table. Rules do the structuring: 1px row rules, a 2px graphite rule over the footing line and a 3px double rule under it, a 3px graphite bar under the selected step.

## Components

### Buttons
- **Shape:** gently squared (6px).
- **Primary:** graphite fill, sheet-coloured label, 32px tall (36px for the plan's Run): New job, Start the job, Run on Apify. One per screen.
- **Outline:** sheet fill with a control-edge border: Open run on Apify, the robots.txt override.
- **Ghost:** text only, graphite soft: Stop here, paging arrows.
- **Focus:** a 2px graphite outline, 2px offset.

### Chips
- **Style:** the table's scope filter (All, Exceptions, Missing), each with its count: a pill with a row-rule border and graphite-soft label.
- **State:** selected takes a graphite border and graphite label.

### Cards / Containers
- **Corner Style:** 6px.
- **Background:** schedule sheet on the working-paper ground.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px sheet edge; a 1px rule under the heading row.
- **Internal Padding:** 16px vertical, 20px horizontal.

### Inputs / Fields
- **Style:** white field, 1px control-edge border, 6px corners, 32px tall in tool rows; placeholders in graphite faint.
- **Focus:** the graphite focus ring.
- **Dropzone:** a dashed control-edge box on the sheet; while a file is dragged over it, the border turns graphite.

### Navigation
- **Style:** a 56px top bar on the sheet with a bottom edge: the Dapi mark and wordmark, then Jobs and the current job's name in 14px. The current page is graphite, others graphite soft. Actions sit at the right end. On phones the job's name and the secondary action fold away.

### The Step Strip (signature)
Six steps of the audit, as tabs in one container: Spec, Site, Extraction, Samples, Run on Apify, Footed. Each carries its tick and one line of result ("3 exact, 1 spacing", "430 of 430"). A step under way shows a graphite dot; the selected step takes the raised sheet and a 3px graphite bar.

### The Ticked Data Sheet (signature)
The delivered rows in a ruled table: 12px sentence-case headers, 40px rows, numbers and dates right-aligned, every value followed by its tick. Each cell is a button that opens its receipt. Under the table, the footing line: "Footed against the source's own count", the count with its F, between a 2px rule and a double rule; then the tick legend.

### The Receipt Rail (signature)
For the picked value: its ticks as sentences, then "The server's own words": the request, the response record with the value's line marked in green wash (or the captured page in a sandboxed frame with the element outlined), and the SHA-256 seal with a "Re-check the seal" control that hashes the body in the browser.

## Do's and Don'ts

### Do:
- **Do** put every value's tick directly after it, and dock the legend under the table.
- **Do** foot every dataset against the source's own count, on the double rule, and name every gap with its reason.
- **Do** keep colour on data and state only: pencil green (#2b7449) and pencil red (#b3302a).
- **Do** right-align numbers and dates in tabular figures.
- **Do** show missing values as a grey dash and real zeros as "0".

### Don't:
- **Don't** add shadows, gradients, glass or glows to resting surfaces.
- **Don't** set anything but the h1 and the footing figure in the condensed cut.
- **Don't** use monospace for anything but requests, responses and seals.
- **Don't** put a coloured fill on a button, a tab or the navigation.
- **Don't** add a dark theme; Dapi is paper.
