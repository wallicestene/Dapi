// The investigation agent. After the investigator's first pass, Muse Wonder takes over
// on Meta's Responses API: it holds the playbook, the spec and every finding, calls
// tools as it sees fit (Meta's own web search with citations; a look at a page,
// screenshot and text together; counts over the list; a record's page; the register;
// a test of any endpoint it means to rely on), and ends by submitting the plan. Meta
// keeps the conversation's state between steps.

import { respond } from './meta.js';
import { PLAYBOOK, SCHEMA, VOICE } from './strategy.js';
import { makeTools } from './investigate/checks.js';

export const AGENT = 'muse-wonder-1.0';
const MAX_STEPS = 24;

const INSTRUCTIONS = `${PLAYBOOK}

---

You are Dapi's investigation agent. Dapi's investigator has made a first pass over the site (the findings you get). Make sure Dapi knows, for every column the spec asks for, where the site renders it and the best way to get it, then submit the plan with submit_strategy.

Work as the playbook says. Before planning, settle the gaps and risks you see with tools; prefer the fewest requests; and verify every route you mean to rely on: test_endpoint with values you already know (from the sample, or from a record page you opened). Use web_search to find official registers, open APIs and their documentation, and look_at_page to see a page the way a person does. Never rely on an endpoint you haven't tested.

When the cheaper route (a register in batches, one big list page) lacks one piece the page shows, find that piece before giving the route up: a code's name (a county, a status, a category) is almost always in the site's own data, in the list page's filters, facets or config block, or a code list the register publishes. One lookup request beats hundreds of page loads, and a slow or stalling site makes every page load a risk.

The first pass is code with assumptions; a new site can break them. When the findings say it stopped short (stoppedShort, notes) or leave columns unmapped, finish the investigation yourself: open a record's page or click what reveals more and watch the requests (click_and_watch), map the missing columns where they're rendered (map_page_fields), and verify. Every column the spec asks for needs a route in the plan, or a named gap.

Dapi tests the extraction against the spec's samples before any run, reading only the list's first pages. When the list runs to more pages than that, verify how to ask the site for one record directly (the feed's search or filter by a sample's ID or name: test_endpoint with that sample's values) and list it in "sources" as the sample lookup; the test reaches the samples through it. Without one, the samples go unchecked.

Be efficient: a handful of tool calls, not dozens. Call submit_strategy once, when the plan is settled. In "sources", list every endpoint the plan uses beyond the findings' own, with how you verified it. For the client: "summary", "pace.why", "risks" and "gaps" follow the client voice below, and "renderedAt" says where on the site in the client's words ("each certificate's page, under Address"). "how" and "evidence" are for the code writer: exact keys, selectors and fields.

${VOICE}`;

const fn = (name, description, properties, required = Object.keys(properties)) => ({
  type: 'function',
  name,
  description,
  parameters: { type: 'object', properties, required, additionalProperties: false },
});

const { checks: _checks, ...planProperties } = SCHEMA.properties;
const PLAN = {
  ...planProperties,
  sources: {
    type: 'array',
    items: {
      type: 'object',
      properties: { name: { type: 'string' }, method: { type: 'string' }, url: { type: 'string' }, purpose: { type: 'string' }, verified: { type: 'string' } },
      required: ['name', 'method', 'url', 'purpose', 'verified'],
      additionalProperties: false,
    },
  },
};

const TOOLS = [
  { type: 'web_search' },
  fn('look_at_page', "A page's screenshot (cookie banners dismissed) with its title, text and links. For pages on the site or on a host a cited search result named.", { url: { type: 'string' } }),
  fn('list_values', 'Every distinct value of a field in the site list, with counts (e.g. "virksomhet.status").', { field: { type: 'string' } }),
  fn('open_record_page', "Open the page of a record whose list field equals a value, and read its values with the verified selectors.", { field: { type: 'string' }, equals: { type: 'string' } }),
  fn('call_register', 'Ask the verified register about one record: by its ID, or by a list field that equals a value.', { id: { type: 'string' }, field: { type: 'string' }, equals: { type: 'string' } }),
  fn('fetch_url', 'Read a URL on the site or a host a cited search result named.', { url: { type: 'string' } }),
  fn('click_and_watch', 'Open a page, click the element showing some text, and report the data requests the click made or the page it led to (with a screenshot).', { url: { type: 'string' }, text: { type: 'string' } }),
  fn('map_page_fields', "Selectors for columns on a page, each checked against it: give each column's value when you know it, or a hint (its label) when you don't.", {
    url: { type: 'string' },
    columns: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' }, hint: { type: 'string' } }, required: ['name', 'value', 'hint'], additionalProperties: false },
    },
  }),
  fn('search_page_source', "Find a piece of text anywhere in a page's source, scripts and config blocks included, with the text around each match: e.g. search the list page for a county name seen on a record page to find where codes map to names.", { url: { type: 'string' }, text: { type: 'string' } }),
  fn('test_endpoint', 'Try an endpoint the plan would rely on: status, records held, and which expected values it returns.', {
    url: { type: 'string' },
    method: { type: 'string' },
    body: { type: 'string' },
    expect: { type: 'array', items: { type: 'string' } },
  }),
  fn('submit_strategy', 'Submit the settled extraction plan. Call once, last.', PLAN, [...SCHEMA.required.filter((k) => k !== 'checks'), 'sources']),
];

// What each step did, for the user, as it happens.
function describe(name, args, result) {
  if (result?.error) return `couldn't: ${result.error}`;
  switch (name) {
    case 'list_values':
      return `counted ${args.field} across ${result.records} records: ${Object.entries(result.values).slice(0, 4).map(([v, n]) => `${v} (${n})`).join(', ')}`;
    case 'open_record_page':
      return `opened a record with ${args.field} = ${args.equals}`;
    case 'call_register':
      return `asked the register about ${result.id}`;
    case 'fetch_url':
      return `read ${args.url}`;
    case 'search_page_source':
      return `searched ${args.url}'s source for “${args.text}”: ${result.matches} match${result.matches === 1 ? '' : 'es'}`;
    case 'test_endpoint':
      return `tested ${args.url}: ${result.works ? `works${result.records !== null ? `, ${result.records} records` : ''}${args.expect?.length ? `, ${result.expectedFound.length} of ${args.expect.length} sample values found` : ''}` : `HTTP ${result.status}`}`;
    case 'look_at_page':
      return `looked at ${args.url}`;
    case 'click_and_watch':
      return `clicked “${args.text}” on ${args.url}: ${result.navigatedTo ? `led to ${result.navigatedTo}` : `${result.requests?.length ?? 0} data request${result.requests?.length === 1 ? '' : 's'}`}`;
    case 'map_page_fields':
      return `mapped ${Object.keys(result).length} column${Object.keys(result).length === 1 ? '' : 's'} on ${args.url} (${Object.values(result).filter((f) => f.verified || f.got).length} found)`;
    default:
      return name;
  }
}

export async function runAgent({ spec, sourceSpec, findings, onEvent = () => {} }) {
  const tools = makeTools(findings);
  const opening = JSON.stringify({ spec, specAsTheSiteWritesIt: sourceSpec, findings });
  // Our own record of every step, so the loop can carry on without Meta's stored state.
  const trail = [];
  const next = async (previous, input) => {
    try {
      return await respond({ model: AGENT, previous, input, tools: TOOLS, reasoningEffort: 'medium' });
    } catch (err) {
      if (!/not found or expired/i.test(err.message)) throw err;
      onEvent({ kind: 'agent', tool: 'resume', text: 'Meta no longer held the conversation, so Muse Wonder carried on from Dapi\'s own record of every step so far.' });
      return respond({
        model: AGENT,
        instructions: INSTRUCTIONS,
        input: [
          { role: 'user', content: opening },
          { role: 'user', content: `Your investigation so far, every tool call and its result:\n${JSON.stringify(trail).slice(0, 60_000)}\n\nCarry on: settle what's left, then call submit_strategy.` },
        ],
        tools: TOOLS,
        reasoningEffort: 'medium',
      });
    }
  };
  const usage = { in: 0, out: 0, searches: 0 };
  const count = (r) => {
    usage.in += r.usage?.input_tokens ?? 0;
    usage.out += r.usage?.output_tokens ?? 0;
  };
  let response = await respond({ model: AGENT, instructions: INSTRUCTIONS, input: opening, tools: TOOLS, reasoningEffort: 'medium' });
  count(response);

  for (let step = 0; step < MAX_STEPS; step++) {
    for (const item of response.output ?? []) {
      if (item.type === 'web_search_call') {
        usage.searches++;
        const query = item.action?.query ?? item.query;
        onEvent({ kind: 'agent', tool: 'web_search', text: `Muse Wonder searched the web${query ? `: “${query}”` : ''}.` });
      }
      // Hosts that cited search results name become reachable for the other tools.
      for (const part of item.type === 'message' ? item.content ?? [] : []) {
        for (const a of part.annotations ?? []) if (a.type === 'url_citation' && a.url) tools.allowHost(a.url);
      }
    }
    const calls = (response.output ?? []).filter((o) => o.type === 'function_call');
    const submit = calls.find((c) => c.name === 'submit_strategy');
    if (submit) return { ...JSON.parse(submit.arguments), checks: [], model: AGENT, usage, steps: step + 1 };

    let input;
    if (!calls.length) {
      input = [{ role: 'user', content: 'Settle any remaining gap with a tool, or call submit_strategy with the plan now.' }];
    } else {
      input = [];
      const images = [];
      for (const call of calls) {
        let args = {};
        let result;
        try {
          args = JSON.parse(call.arguments || '{}');
          if (!tools[call.name]) throw new Error(`no tool ${call.name}`);
          result = await tools[call.name](args);
        } catch (err) {
          result = { error: err.message.split('\n')[0] };
        }
        if (result?.image) {
          images.push({ type: 'input_image', image_url: `data:image/png;base64,${result.image.toString('base64')}` });
          result = { ...result.text, screenshot: 'attached below' };
        }
        onEvent({ kind: 'agent', tool: call.name, args, text: `Muse Wonder ${describe(call.name, args, result)}.` });
        trail.push({ tool: call.name, args, result: JSON.stringify(result).slice(0, 3000) });
        input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result).slice(0, 12_000) });
      }
      if (images.length) input.push({ role: 'user', content: [{ type: 'input_text', text: 'Screenshots from look_at_page, in order:' }, ...images] });
    }
    response = await next(response.id, input);
    count(response);
  }
  throw new Error(`the agent didn't submit a plan within ${MAX_STEPS} steps`);
}
