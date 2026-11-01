// Spec reader: turns an extraction spec (PDF or text) into columns, rules and
// sample rows. The sample rows become the test cases the generated extractor has
// to reproduce, so they are copied exactly, never tidied.
// Usage: node src/read-spec.js <spec.pdf|spec.md|spec.txt>   ->   <spec>.spec.json

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chat, pdfPart, SPARK } from './meta.js';

const PROMPT = `You read data extraction specs the way an experienced freelance data extractor does. A spec names a web source, the columns the output table must have, sample rows showing expected values, and rules in plain English (often in a notes or comment column). Samples may be laid out one per column or one per row.

Specs are written by people, quickly. They carry typos, inconsistent capitals and spacing, and values typed under the wrong column. Read for what the writer meant, and keep a record of every fix so the user can check it.

Return:
- title, and sourceUrl: the URL to extract from.
- rowUnit: what one output row represents, in a few words, e.g. "one compliance issue".
- columns: every output column, in the spec's order. name: the column's name with obvious slips fixed: a missing, doubled or swapped letter ("Organizaton name"), stray spaces or punctuation, capitals that break the pattern the other columns follow. Judge by how the spec writes its other columns and by the source's own terms; leave unusual but deliberate names alone. instructions: the spec's note for the column ("" if it says nothing). Clients write notes from what they see on the page ("click View", "from the main page overview"); keep the note as written: Dapi reads it as what they want, not as steps it must follow. constant: the value if the spec fixes it for every row, e.g. "set the country as India"; otherwise null.
- corrections: every column name you changed, as {original, corrected, why}. Empty if none.
- rules: every instruction about the table as a whole, e.g. how rows split or how to write dates.
- samples: every sample row, labelled as in the spec, its values keyed by the corrected column names. Copy each value exactly as the spec shows it, character for character, including typos, capitals and punctuation, because these values are used as test cases: Dapi compares them with the source tolerantly, and reports a value that looks mistyped or typed under the wrong column rather than failing on it. When a value wraps across lines, rejoin it the way the page shows it, keeping hyphens that belong to the value. When a sample leaves a column blank, give it as an empty string: blank is an expected value too.
- questions: anything the spec leaves unclear that would change the output, phrased as a question to the person who wrote it. Empty if nothing is unclear.
- personalData: every column that names or contacts a person: a named individual (such as a legal representative, owner or contact), or their phone number, email or home address. Give the column and, in a few words, why. Data about companies and organisations (their name, business phone, office address, website) doesn't count. Empty if no column does. This is for the user's information only: public data the site shows any visitor is collected either way.

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
    corrections: {
      type: 'array',
      items: {
        type: 'object',
        properties: { original: { type: 'string' }, corrected: { type: 'string' }, why: { type: 'string' } },
        required: ['original', 'corrected', 'why'],
        additionalProperties: false,
      },
    },
    personalData: {
      type: 'array',
      items: {
        type: 'object',
        properties: { column: { type: 'string' }, why: { type: 'string' } },
        required: ['column', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'sourceUrl', 'rowUnit', 'columns', 'rules', 'samples', 'questions', 'corrections', 'personalData'],
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
    if (!sampled && column.constant === null) problems.push(`Your sample leaves "${name}" blank: Dapi looks for it on other records, and can't check it against a value of yours.`);
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
