// Spec reader: turns an extraction spec (PDF or text) into columns, rules and
// sample rows. The sample rows become the test cases the generated extractor has
// to reproduce, so they are copied exactly, never tidied.
// Usage: node src/read-spec.js <spec.pdf|spec.md|spec.txt>   ->   <spec>.spec.json

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chat, pdfPart, SPARK } from './meta.js';

const PROMPT = `You read data extraction specs. A spec names a public web source, the columns the output table must have, sample rows showing expected values, and rules in plain English (often in a notes or comment column). Samples may be laid out one per column or one per row.

Return:
- title, and sourceUrl: the URL to extract from.
- rowUnit: what one output row represents, in a few words, e.g. "one compliance issue".
- columns: every output column, in the spec's order. instructions: where or how to get the value, taken from the spec's notes ("" if it says nothing). constant: the value if the spec fixes it for every row, e.g. "set the country as India"; otherwise null.
- rules: every instruction about the table as a whole, e.g. how rows split or how to write dates.
- samples: every sample row, labelled as in the spec. Copy each value exactly as the spec shows it, character for character, including typos, capitals and punctuation, because these values are used as test cases. When a value wraps across lines, rejoin it the way the page shows it, keeping hyphens that belong to the value. When a sample leaves a column blank, give it as an empty string: blank is an expected value too.
- questions: anything the spec leaves unclear that would change the output, phrased as a question to the person who wrote it. Empty if nothing is unclear.

Don't invent columns, samples or rules that aren't in the spec.`;

const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    sourceUrl: { type: 'string' },
    rowUnit: { type: 'string' },
    columns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          instructions: { type: 'string' },
          constant: { type: ['string', 'null'] },
        },
        required: ['name', 'instructions', 'constant'],
        additionalProperties: false,
      },
    },
    rules: { type: 'array', items: { type: 'string' } },
    // Values as {column, value} pairs: a strict schema can't have open-ended keys.
    samples: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          values: {
            type: 'array',
            items: {
              type: 'object',
              properties: { column: { type: 'string' }, value: { type: 'string' } },
              required: ['column', 'value'],
              additionalProperties: false,
            },
          },
        },
        required: ['label', 'values'],
        additionalProperties: false,
      },
    },
    questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'sourceUrl', 'rowUnit', 'columns', 'rules', 'samples', 'questions'],
  additionalProperties: false,
};

export async function readSpec(filePath) {
  const bytes = fs.readFileSync(filePath);
  const document =
    path.extname(filePath).toLowerCase() === '.pdf'
      ? pdfPart(bytes, path.basename(filePath))
      : { type: 'text', text: bytes.toString('utf8') };

  const { content, usage } = await chat({
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: [document, { type: 'text', text: 'Read this extraction spec.' }] },
    ],
    schema: { name: 'extraction_spec', schema: SPEC_SCHEMA },
  });

  const spec = {
    ...content,
    samples: content.samples.map((s) => ({
      label: s.label,
      values: Object.fromEntries(s.values.map((v) => [v.column, v.value])),
    })),
  };
  return { spec, problems: check(spec), usage };
}

// Things that would make the samples useless as test cases.
function check(spec) {
  const problems = [];
  const names = spec.columns.map((c) => c.name);
  if (new Set(names).size !== names.length) problems.push('duplicate column names');
  if (spec.samples.length === 0) problems.push('no sample rows: nothing to test the extractor against');

  for (const sample of spec.samples) {
    for (const column of Object.keys(sample.values)) {
      if (!names.includes(column)) problems.push(`${sample.label} has a value for unknown column "${column}"`);
    }
  }
  for (const name of names) {
    const column = spec.columns.find((c) => c.name === name);
    const sampled = spec.samples.some((s) => s.values[name]);
    if (!sampled && column.constant === null) problems.push(`no sample shows a value for "${name}"`);
  }
  return problems;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node src/read-spec.js <spec.pdf|spec.md|spec.txt>');
    process.exit(1);
  }

  const started = Date.now();
  const { spec, problems, usage } = await readSpec(filePath);

  console.log(`${spec.title}\n${spec.sourceUrl}\nOne row = ${spec.rowUnit}\n`);
  console.log(`Columns (${spec.columns.length}):`);
  for (const c of spec.columns) {
    const note = c.constant !== null ? `always "${c.constant}"` : c.instructions;
    console.log(`  ${c.name}${note ? `  —  ${note}` : ''}`);
  }
  console.log('\nRules:');
  for (const r of spec.rules) console.log(`  - ${r}`);
  console.log(`\nSamples (${spec.samples.length}):`);
  for (const s of spec.samples) console.log(`  ${s.label}: ${Object.keys(s.values).length} values`);
  console.log(`\nQuestions for the spec's author: ${spec.questions.length ? '' : 'none'}`);
  for (const q of spec.questions) console.log(`  ? ${q}`);
  console.log(`Problems: ${problems.length ? '' : 'none'}`);
  for (const p of problems) console.log(`  ! ${p}`);

  const { prompt_tokens: tokensIn, completion_tokens: tokensOut } = usage ?? {};
  console.log(`\n${SPARK}: ${tokensIn} tokens in, ${tokensOut} out, ${Date.now() - started} ms`);

  const outPath = filePath.replace(/\.[^.]+$/, '.spec.json');
  fs.writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n');
  console.log(`wrote ${outPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
