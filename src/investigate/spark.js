// The investigator's two questions for Muse Spark: which endpoint holds the spec's
// columns (and under which keys), and which control on a record reveals the rest.

import { chat } from '../meta.js';
import { shrink } from './data.js';

// Kept first and unchanged so the API can cache it.
const MATCH_PROMPT = `You help a data extraction tool decide which JSON endpoint holds the data a spec asks for.
You get the spec's columns (with any instructions), its sample rows, and the JSON endpoints a page called, each with sample records.
Pick the endpoint whose records are the items the spec's rows are built from. Lookup lists, filter options, settings, feature flags, translations and tracking are not.
For each column, give the key or keys inside one record of that endpoint that hold its value, using dots for nesting. For a value built from several keys (joined, split, reformatted), list every key and say how in "how". If no key in that endpoint holds the column, give an empty list.
Match by meaning and by the sample values. Set best to null if no endpoint holds the records.`;

const MATCH_SCHEMA = {
  type: 'object',
  properties: {
    best: { type: ['integer', 'null'] },
    fields: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          column: { type: 'string' },
          keys: { type: 'array', items: { type: 'string' } },
          how: { type: 'string' },
        },
        required: ['column', 'keys', 'how'],
        additionalProperties: false,
      },
    },
    reason: { type: 'string' },
  },
  required: ['best', 'fields', 'reason'],
  additionalProperties: false,
};

export async function matchColumns({ columns, samples, candidates }) {
  const payload = {
    columns: columns.map((c) => ({ name: c.name, instructions: c.instructions, constant: c.constant })),
    samples: samples.map((s) => s.values),
    endpoints: candidates.map((c, i) => ({
      id: i,
      endpoint: `${c.method} ${c.url.split('?')[0]}`,
      recordPath: c.records.path,
      recordCount: c.records.count,
      sampleRecords: c.records.records.slice(0, 2).map((r) => shrink(r)),
    })),
  };
  const { content, usage } = await chat({
    reasoningEffort: 'low',
    messages: [
      { role: 'system', content: MATCH_PROMPT },
      { role: 'user', content: JSON.stringify(payload) },
    ],
    schema: { name: 'column_match', schema: MATCH_SCHEMA },
  });
  if (content.best !== null && !candidates[content.best]) content.best = null;
  return { ...content, usage };
}

const PICK_PROMPT = `You are looking at a web page to find how to reveal more data for one record.
You get a screenshot with the record visible, the record's text, the spec columns the page's list data doesn't include (with the spec's instructions for them), and the clickable controls inside that record, numbered.
Choose the one control that, when clicked, most likely reveals those columns for this record: a details link, a "View" button, an expand toggle. Prefer what the spec's instructions name. Answer null if no control would.`;

const PICK_SCHEMA = {
  type: 'object',
  properties: { control: { type: ['integer', 'null'] }, reason: { type: 'string' } },
  required: ['control', 'reason'],
  additionalProperties: false,
};

export async function pickControl({ screenshot, recordText, missing, controls }) {
  const { content, usage } = await chat({
    messages: [
      { role: 'system', content: PICK_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshot.toString('base64')}` } },
          {
            type: 'text',
            text: JSON.stringify({
              record: recordText,
              missingColumns: missing.map((c) => ({ name: c.name, instructions: c.instructions })),
              controls: controls.map(({ id, text, tag, href }) => ({ id, text, tag, href })),
            }),
          },
        ],
      },
    ],
    schema: { name: 'control_pick', schema: PICK_SCHEMA },
  });
  if (content.control !== null && !controls[content.control]) content.control = null;
  return { ...content, usage };
}
