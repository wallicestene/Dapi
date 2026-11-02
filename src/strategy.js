// The strategy: after the investigation has gathered its evidence, Muse Wonder, Meta's
// strongest reasoning model, reads it with Dapi's extraction playbook and decides,
// column by column, where the site renders each value and the cheapest verified way to
// get it, and for the whole job the requests, pace and way in. The code writer builds
// from this plan; the user sees it before anything runs.

import fs from 'node:fs';
import { chat } from './meta.js';

const PLAYBOOK = fs.readFileSync(new URL('./prompts/extraction-playbook.md', import.meta.url), 'utf8');

const PROMPT = `${PLAYBOOK}

---

You are planning one extraction. You get the client's spec, the spec as the site writes it (samples aligned with the site's own words), and everything Dapi's investigation of the live site found: the data feeds and embedded data, the list and its paging, record pages and the selectors verified on them, any public register behind them, shared values, robots.txt, how the site answers Apify's servers and the measured pace.

Decide, following the playbook:
- for every spec column: where the site renders it, the route to get it (feed, embedded, page, register, shared-page, constant, derived), exactly how (keys, selector, register field, lookup), and the evidence for it ("verified on the sample", "seen on another record", or "not verified");
- the requests the run needs (list, register, record pages) and the total;
- the pace and way in: concurrency and requests per minute from the pace test; retries (3 on a clean site, 5 when the measurements showed errors, more for a stalling server or bot management), timeoutSecs (about ten times the slowest measured answer, at least 30), retryPauseSecs (0 unless the server stalls), and the proxy (or "direct"). Always give working values, never 0 retries or a 0 timeout;
- the risks, and the gaps: columns with no verified route.
- checks: when a gap or risk could be settled by a quick look, ask for it (at most 4; none when the plan is settled). Tools: "list-values" (every distinct value of a list field, with counts: e.g. are there records that aren't approved?), "record-page" (open the page of a record whose list field equals a value, and read its values), "register" (ask the verified register about a record whose list field equals a value, or by ID), "fetch" (read a URL on the site or a register host). The checks run and you plan again with their results.
Fewest requests wins when the values are the same: a verified register read in batches beats loading every record's page, even when a column needs a lookup through the site's own list (a parent unit's ID in the register to that unit's name in the list), and all the more on a slow or stalling site. Pages are for what nothing cheaper holds.
Use only what the findings show; never invent an endpoint, selector or field. Write "summary" and "why" for the client: plain, short, specific.`;

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    columns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          column: { type: 'string' },
          renderedAt: { type: 'string' },
          route: { type: 'string', enum: ['feed', 'embedded', 'page', 'register', 'shared-page', 'constant', 'derived', 'none'] },
          how: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['column', 'renderedAt', 'route', 'how', 'evidence'],
        additionalProperties: false,
      },
    },
    requests: {
      type: 'object',
      properties: { list: { type: 'integer' }, register: { type: 'integer' }, pages: { type: 'integer' }, total: { type: 'integer' } },
      required: ['list', 'register', 'pages', 'total'],
      additionalProperties: false,
    },
    pace: {
      type: 'object',
      properties: {
        concurrency: { type: 'integer' },
        perMinute: { type: 'integer' },
        retries: { type: 'integer' },
        timeoutSecs: { type: 'integer' },
        retryPauseSecs: { type: 'integer' },
        proxy: { type: 'string' },
        why: { type: 'string' },
      },
      required: ['concurrency', 'perMinute', 'retries', 'timeoutSecs', 'retryPauseSecs', 'proxy', 'why'],
      additionalProperties: false,
    },
    risks: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tool: { type: 'string', enum: ['list-values', 'record-page', 'register', 'fetch'] },
          field: { type: 'string' },
          equals: { type: 'string' },
          id: { type: 'string' },
          url: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['tool', 'field', 'equals', 'id', 'url', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'columns', 'requests', 'pace', 'risks', 'gaps', 'checks'],
  additionalProperties: false,
};

export const STRATEGIST = 'muse-wonder-1.0';

// checkResults: the checks asked for in a first plan, with what they found. The second
// plan settles what they show and asks for no more.
export async function planStrategy({ spec, sourceSpec, findings, checkResults = null }) {
  const messages = [
    { role: 'system', content: PROMPT },
    { role: 'user', content: JSON.stringify({ spec, specAsTheSiteWritesIt: sourceSpec, findings }) },
  ];
  if (checkResults) {
    messages.push({
      role: 'user',
      content: `The checks you asked for have run. Plan again with what they found; settle every gap they answer, keep only real remaining gaps, and ask for no more checks.\n${JSON.stringify(checkResults)}`,
    });
  }
  const { content, usage } = await chat({ model: STRATEGIST, reasoningEffort: 'medium', timeoutMs: 300_000, messages, schema: { name: 'extraction_strategy', schema: SCHEMA } });
  if (checkResults) content.checks = [];
  return { ...content, model: STRATEGIST, usage };
}
