// Translation after the run, for specs whose samples are written in another language
// than the site (read through a browser translation). The extraction reads the site as
// it is, with receipts on the original; Muse Spark then translates the columns the
// samples translated, each distinct value once, following the samples' own wording.

import { chat, SPARK } from './meta.js';

const PROMPT = `You translate values in a dataset extracted from a website, for a client who wrote their spec in another language.
Translate each value from the source language into the target language, the way the client's examples do: keep their wording, punctuation and style for the same phrases, and translate names of organisations only as far as the examples do.
Never change numbers, postcodes, dates, codes, URLs or email addresses, and never add or drop information. A value that needs no translation (a proper name, an address line) comes back unchanged.`;

const SCHEMA = {
  type: 'object',
  properties: {
    values: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'integer' }, text: { type: 'string' } },
        required: ['id', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['values'],
  additionalProperties: false,
};

const BATCH = 60;

// values: distinct strings. Returns a Map from each to its translation, and token use.
export async function translateValues({ values, from, to, examples, onProgress = () => {} }) {
  const out = new Map();
  const tokens = { in: 0, out: 0 };
  const todo = values.filter((v) => v && v.trim());
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const { content, usage } = await chat({
      model: SPARK,
      reasoningEffort: 'low',
      timeoutMs: 180_000,
      messages: [
        { role: 'system', content: PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            from,
            to,
            examples: examples.map((e) => ({ column: e.column, source: e.source, translation: e.target })),
            values: batch.map((text, id) => ({ id, text })),
          }),
        },
      ],
      schema: { name: 'translations', schema: SCHEMA },
    });
    tokens.in += usage?.prompt_tokens ?? 0;
    tokens.out += usage?.completion_tokens ?? 0;
    for (const { id, text } of content.values) if (batch[id] !== undefined) out.set(batch[id], text);
    onProgress(Math.min(i + BATCH, todo.length), todo.length);
  }
  // The client's own examples win over the model for the exact same phrase.
  for (const e of examples) if (e.source) out.set(e.source, e.target);
  return { map: out, tokens };
}
