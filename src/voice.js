// Spoken specs: Muse Voice Transcribe turns a recording into text (one-shot endpoint,
// as Meta's cookbook documents it: POST /v1/asr/transcribe, a JSON "request" part and
// the WAV audio), then Muse Spark writes it up as a spec Dapi can run, the way a
// freelancer would write up a client's call: source, row unit, columns, rules, and
// questions for anything the client left open.

import { fileURLToPath } from 'node:url';
import { chat } from './meta.js';

try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  // the shell environment
}

export const VOICE = 'muse-voice-transcribe-1.0';

// wav: a Buffer of WAV audio (up to 10 minutes, 32 MB). keywords bias recognition
// toward words it would otherwise mis-hear (site names, jargon).
export async function transcribe(wav, { keywords = [] } = {}) {
  if (!process.env.MODEL_API_KEY) throw new Error('MODEL_API_KEY is not set: add it to dapi/.env');
  const form = new FormData();
  form.set('request', new Blob([JSON.stringify({ mode: 'PUSH_TO_TALK', model: VOICE, audioEncoding: 'WAV', ...(keywords.length && { keywords }) })], { type: 'application/json' }));
  form.set('audio', new Blob([wav], { type: 'audio/wav' }), 'spec.wav');
  const res = await fetch('https://api.meta.ai/v1/asr/transcribe', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.MODEL_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`Muse Voice Transcribe returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json(); // { sessionId, transcript, audioDurationMs, turns }
}

const PROMPT = `A client described a data extraction job out loud; you get the transcript. Write it up as the spec a freelance data extractor would work from, in plain text:

Source: the URL of the public page they named (complete a spoken address like "arbeidstilsynet dot no" to https://www.arbeidstilsynet.no, and a Wikipedia article they name, like "List of national parks of the United States", to https://en.wikipedia.org/wiki/List_of_national_parks_of_the_United_States).
One row per: what one row of the table is.
Columns: one per line as "- Name: what it holds". The name is short, one to three words in title case (the client's own name for the column when they gave one), since it becomes the column's header; the note after the colon is in the client's words where they gave them.
Sample rows: when they spoke an example row, a Markdown table with a column for each column above. A transcript spells spoken numbers and dates its own way ("4 million 79,318", "February 26 1919"); write them as a page would print them (4,079,318; February 26, 1919), since that spelling is the transcriber's, not the client's.
Rules: one per line, everything they said about the whole table (which records, how many, formats), as close to their words as you can. Keep their reasons: "the page says how many there are, I want every one" tells the extractor where to count from.
Questions: anything they left open that would change the output.

Keep only what they said or clearly meant; don't invent columns or sample values. No sample rows unless they spoke some.`;

export async function specFromTranscript(transcript) {
  const { content } = await chat({ reasoningEffort: 'low', messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: transcript }] });
  return content.trim();
}
