// Translation after the run, for specs whose samples are written in another language
// than the site (read through a browser translation). The extraction reads the site as
// it is, with receipts on the original; Muse Spark then translates the columns the
// samples translated, each distinct value once, following the samples' own wording.

import { chat, SPARK } from './meta.js';

const PROMPT = `You translate values in a dataset extracted from a website, for a client who wrote their spec in another language.
Translate each value from the source language into the target language, the way the client's examples do: keep their wording, punctuation and style for the same phrases, and translate names of organisations only as far as the examples do.
Never change numbers, postcodes, dates, codes, URLs or email addresses, and never add or drop information. A value that needs no translation (a proper name, an address line) comes back unchanged.
Be consistent across the whole dataset: a word gets the same treatment in every value (if "AVD" becomes "DEPT" in one name, it does in all; if a company's name stays as it is, so do its branches). "decided" holds translations already made for other values in this dataset: follow them.`;

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

const BATCH = 40;

// values: distinct strings. Returns a Map from each to its translation, token use, and
// the values that couldn't be translated (they stay in the site's language). A batch
// that times out or fails is tried again, then split in half, so one slow reply never
// stops the job.
export async function translateValues({ values, from, to, examples, onProgress = () => {} }) {
  const out = new Map();
  const tokens = { in: 0, out: 0 };
  const failed = [];
  // Sorted, so a company and its branches land in the same batch.
  const todo = values.filter((v) => v && v.trim()).sort((a, b) => a.localeCompare(b));

  async function translateBatch(batch) {
    // Earlier decisions for values that share a word with this batch.
    const words = new Set(batch.flatMap((v) => v.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2)));
    const decided = [...out]
      .filter(([source]) => source.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((w) => words.has(w)))
      .slice(-40)
      .map(([source, text]) => ({ source, translation: text }));
    const { content, usage } = await chat({
      model: SPARK,
      reasoningEffort: 'low',
      timeoutMs: 240_000,
      messages: [
        { role: 'system', content: PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            from,
            to,
            examples: examples.map((e) => ({ column: e.column, source: e.source, translation: e.target })),
            decided,
            values: batch.map((text, id) => ({ id, text })),
          }),
        },
      ],
      schema: { name: 'translations', schema: SCHEMA },
    });
    tokens.in += usage?.prompt_tokens ?? 0;
    tokens.out += usage?.completion_tokens ?? 0;
    for (const { id, text } of content.values) if (batch[id] !== undefined) out.set(batch[id], text);
  }

  async function settle(batch, tries = 2) {
    for (let attempt = 1; attempt <= tries; attempt++) {
      try {
        return await translateBatch(batch);
      } catch {
        // try again, then smaller
      }
    }
    if (batch.length > 5) {
      const half = Math.ceil(batch.length / 2);
      await settle(batch.slice(0, half), 1);
      await settle(batch.slice(half), 1);
    } else failed.push(...batch);
  }

  for (let i = 0; i < todo.length; i += BATCH) {
    await settle(todo.slice(i, i + BATCH));
    onProgress(Math.min(i + BATCH, todo.length), todo.length);
  }
  // The client's own examples win over the model for the exact same phrase.
  for (const e of examples) if (e.source) out.set(e.source, e.target);
  return { map: out, tokens, failed: failed.filter((v) => !out.has(v)) };
}
