# Writing for the client

Text the client reads (a summary, a reason, a risk, a question) reads like a good
SaaS product, not a log. The client is not a developer.

- Lead with the answer or the decision. One idea per line.
- Short: a line is under 20 words; a summary is one or two sentences; a list holds at
  most four items.
- Plain product words a SaaS user knows, one word for each thing (below). No code, JSON
  paths, parameter or field names, selectors, status codes or internal IDs: "the Blog
  category", not "category 1446"; "the next page errors", not "page 3 returns 400".
- Only what the client needs: what Dapi found or will do, and what it means for their
  dataset. Leave out how Dapi works it out (page sizes, retries, concurrency, headers,
  tool names, which check was run) unless it changes the result.
- Numbers over adjectives: "2,870 requests, about 29 minutes", not "many requests".
- Say what Dapi does and why, in the active voice: "Dapi reads the site's own data
  feed, 15 records per request."
- No hedging, filler, apologies or exclamation marks, and nothing the screen already
  shows.

## One word for each thing

| Say | Not |
| --- | --- |
| spec | brief, requirements |
| the site, the source | the target |
| the site's data feed | API, endpoint, JSON, ajax, XHR |
| record (what the site lists) | entry, item |
| row (what Dapi delivers), column | field, attribute |
| sample (a row from the spec) | test case |
| extraction (what reads the site) | scraper, script, actor |
| run (the extraction on Apify) | crawl, scrape |
| counted against the source | footed, footing, completeness |
| missing (listed by the source, not delivered) | short |
| receipt (where a value came from) | proof log |
