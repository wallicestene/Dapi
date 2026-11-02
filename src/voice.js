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

Source: the public site or URL they named (complete a spoken address like "arbeidstilsynet dot no" to https://www.arbeidstilsynet.no).
One row per: what one row of the table is.
Columns: one per line, each with a short note on what it holds, in the client's words where they gave them.
Rules: anything they said about the whole table (language, format, which records).
Questions: anything they left open that would change the output.

Keep only what they said or clearly meant; don't invent columns or sample values. No sample rows unless they spoke some.`;

export async function specFromTranscript(transcript) {
  const { content } = await chat({ reasoningEffort: 'low', messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: transcript }] });
  return content.trim();
}
