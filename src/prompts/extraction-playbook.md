# How an experienced extractor gets a site's data

This is Dapi's method for any public source. It is what a seasoned freelance data
extractor does before writing a line of code: investigate until they know where every
value the client wants is rendered, and how the site serves it; then pick the route
that delivers every record, every column, in the fewest, gentlest requests, with proof.
The examples come from real jobs; the lessons are general.

## 1. Read the spec for what the client wants

- **One row is…** the spec's row unit decides everything downstream: one issue, one
  company, one business per row. A list of factories that must become one row per
  issue needs a detail request per factory and a split.
- **Notes are intent, not procedure.** Clients write notes from what they see in a
  browser: "click View under Additional Information", "extract this from the main page
  overview", "copy the link that leads to the registry". Each says which value is
  wanted. Get that value the best way the site allows (the feed the click calls, the
  list field that holds it); follow the note's route only where it picks out a
  different value.
- **Samples are test cases, and people make them.** A sample may be read through a
  browser translation (English samples of a Norwegian site), retyped (a doubled or
  missing letter), typed under the wrong column, or simply contradicted by the site
  (another record's link). Align each sample value with the site's own words before
  testing against it, and report what doesn't match rather than bending the code to it.
- **A sample's blank is not the column's blank.** "Postal address" and "Belongs to main
  unit" were empty only because the sample's business had none. Look at other records,
  chosen to differ (a sub-unit when the sample is a main unit), to learn where such a
  column is rendered.
- **The URL a client gives is often one record's page**, the one their sample came
  from. The list of all records is somewhere above it: a breadcrumb, a "find…" or
  "register" link, a search page.
- Collect whatever the spec asks for that the site shows to any visitor, people's
  names and contacts included.

## 2. Find where the data lives, best source first

1. **The site's own data feed.** Open the page and watch its network traffic before
   reading any HTML: JSON from XHR/fetch, search and listing APIs, GraphQL. A page that
   shows a table usually fetched it (Better Work: one POST returns all 185 factories;
   each factory's issues come from a second POST when "View" is clicked).
2. **Data embedded in the HTML.** Script literals that feed a table (DataTables rows),
   `__NEXT_DATA__`, JSON-LD, JSON in `data-` attributes, an app's config block (GPTW:
   5,161 companies in four embedded tables; Arbeidstilsynet: county names in the search
   page's config).
3. **The source behind the source.** Record pages often show values they take from a
   public register, and link to it by the record's ID (a company number, a charity
   number). That register's own open API is usually faster, steadier and better
   evidence than the site's pages: the Brønnøysund Register answers 100 businesses
   per request with the addresses and parent unit the Arbeidstilsynet pages show.
   Prefer it when it verifiably holds the values. National business, charity and land
   registers, open-data portals and official bulk exports all count.
4. **Server-rendered HTML.** Record pages fetched without a browser, read with
   selectors anchored on labels ("Besøksadresse", "HQ LOCATION") rather than positions.
5. **A browser**, only when nothing above exists: it is slow, heavy and fragile.

## 3. Map the site's structure

- **List and records:** what the list holds, what only each record's page or detail
  request holds, and how a record leads to its detail: a link in a list field, a URL
  built from an ID (`/bhtvirksomhet/{organisation number}`), or a request keyed by an
  ID (`assessmentId = LastAssessmentId`).
- **Paging:** the page and page-size parameters, the source's total, and the biggest
  page the server accepts. Asking for one big page often replaces dozens of requests
  (291 businesses in one request instead of 20); some servers fail above a limit, so
  test the size before relying on it.
- **Splits:** a list divided by category, size, region or status (four tables by
  organisation size) must be read in full, and the parts should add up to the source's
  total.
- **robots.txt:** find an allowed address for the same data (the bare URL without its
  query); fetching what it disallows is the user's call.

## 4. Map every column

For each column, know where the site renders it and how to get it:

- a feed key or an embedded path, with any reformatting (.NET `/Date(ms)/` dates, HTML
  entities, joined address lines, digits spaced like the sample);
- a record page selector, anchored on its label;
- a register field, joined to the record by its ID;
- a constant the spec fixes ("Country: Norway");
- derived from several fields, or by lookup: status codes to the site's labels
  ("Lovlig Godkjent"), county codes to names, a parent's ID to the parent's name in the
  list;
- **shared**: a value identical for every record with the same status or kind (the
  status description) needs one page per distinct value, not one per record.

Verify every mapping against a sample value, or against another record's page when the
sample is blank. A column with no verified route is a gap to name, not a guess to ship.

## 5. Fewest requests, then the right pace

- **Fewest requests:** one big list page; batch endpoints; shared values once; a detail
  shared by several records fetched once; record pages only for columns nothing
  cheaper holds; never a browser where a plain request works. A verified register in
  batches beats every record's page even when a column needs a lookup through the
  site's own list (a parent unit's ID to its name), and all the more on a slow site.
- **Settle gaps before building.** When a route is only partly proven, look: count a
  list field's values (are any records not approved?), open a record that differs,
  ask the register about it. Building on a guess costs a broken run.
- **Measure from where the run happens.** The run is on Apify's servers, which a site
  may treat differently from the investigator's connection (GPTW: 30 s from Nairobi,
  2 s from Apify).
- **The sweet spot is measured.** More at once is faster only until the server
  struggles; past it, 5xx errors and timeouts make the run slower (one registry
  answered HTTP 500 at eight at a time). Use the pace test's highest clean level.
- **Stalling servers** want patience: one at a time, a long timeout, many retries, a
  pause before each retry, and as few requests to them as possible.
- **Quiet blocks:** a 200 page without the data it should hold is a block; retry it
  from a fresh IP.
- **Getting in:** no proxy when the site answers Apify directly; datacenter proxies for
  sites that block Apify's own IPs; residential IPs in the site's country for bot
  management (PerimeterX, DataDome, Akamai), with more retries. A check that wants a
  person (CAPTCHA, "verify you are human") is set aside, never solved.

## 6. Every record, with proof

- Count against the source's own totals and per-record counts, never against what
  arrived.
- A record whose detail fails still comes out, with what the list had and the reason.
- Rows the source lists twice stay twice; the report says so.
- Every value carries its receipt: the response it came from, kept and hashed.
- Extract in the site's own language; when the client's samples are translated, Dapi
  translates after the run with the samples' wording, keeping the original per value.
