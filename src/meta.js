// The one place Dapi talks to the Meta Model API: auth, retries, errors.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.meta.ai/v1';
export const SPARK = 'muse-spark-1.3';

// MODEL_API_KEY lives in dapi/.env, which is gitignored. Never hard-code it.
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  // No .env file: use whatever the shell environment has.
}

// A Muse Spark chat completion. With a schema, the answer comes back parsed.
export async function chat({ messages, schema, model = SPARK, reasoningEffort, timeoutMs = 120_000 }) {
  const body = {
    model,
    messages,
    // On chat completions this is reasoning_effort; reasoning.effort returns 400.
    ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
    ...(schema && {
      response_format: {
        type: 'json_schema',
        json_schema: { name: schema.name, schema: schema.schema, strict: true },
      },
    }),
  };

  const res = await post('/chat/completions', body, timeoutMs);
  const content = res.choices[0].message.content;
  return { content: schema ? JSON.parse(content) : content, usage: res.usage };
}

// A PDF as a chat-completions content part, sent inline (up to 50 MB, 100 pages of text).
export function pdfPart(buffer, filename) {
  return {
    type: 'file',
    file: { filename, file_data: `data:application/pdf;base64,${buffer.toString('base64')}` },
  };
}

// Retries 429s, 5xx and dropped connections with exponential backoff and jitter,
// honouring Retry-After. Rate limits are per team, so one busy run can hit them for
// everything else.
async function post(path, body, timeoutMs, attempts = 3) {
  if (!process.env.MODEL_API_KEY) throw new Error('MODEL_API_KEY is not set: add it to dapi/.env');
  const backoff = (attempt) => new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000 + Math.random() * 1000));

  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.MODEL_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // DNS hiccups and resets surface as "fetch failed"; a timeout does not retry.
      if (err.name === 'TimeoutError' || attempt === attempts) throw err;
      await backoff(attempt);
      continue;
    }
    if (res.ok) {
      const json = await res.json();
      record(body.model, json.usage);
      return json;
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === attempts) {
      throw new Error(`Meta API ${path} returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const retryAfter = Number(res.headers.get('retry-after'));
    if (retryAfter > 0) await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    else await backoff(attempt);
  }
}

// What each call cost, appended to jobs/usage.jsonl: a public deployment adds it up and
// stops taking jobs before the month's Meta budget runs out. Prices per million tokens:
// input, output, cached input (AGENTS.md).
const PRICE = {
  'muse-wonder-1.0': [4, 20, 0.2],
  'muse-spark-1.3': [1.25, 4.25, 0.15],
  'muse-spark-1.3-contributor': [0.1, 0.2, 0.1],
};
function record(model, usage) {
  if (!usage) return;
  try {
    const input = usage.prompt_tokens ?? usage.input_tokens ?? 0;
    const cached = usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? 0;
    const output = usage.completion_tokens ?? usage.output_tokens ?? 0;
    const [pin, pout, pcached] = PRICE[model] ?? PRICE[SPARK];
    const usd = ((input - cached) * pin + cached * pcached + output * pout) / 1e6;
    const dir = path.resolve(process.env.DAPI_JOBS_DIR ?? fileURLToPath(new URL('../jobs', import.meta.url)));
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'usage.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), job: process.env.DAPI_JOB_ID ?? null, model, input, cached, output, usd: Number(usd.toFixed(6)) })}\n`);
  } catch {
    // the ledger never stops a call
  }
}

// One step of an agent loop on the Responses API: Meta keeps the conversation's state
// (continue with `previous`), the model calls tools as it sees fit, and built-in tools
// such as web_search run on Meta's side. Only tool_choice "auto" is supported.
export async function respond({ model, instructions, input, tools, previous, reasoningEffort, timeoutMs = 300_000 }) {
  return post(
    '/responses',
    {
      model,
      ...(instructions && { instructions }),
      input,
      // Kept on Meta's side, so the next step can continue from it.
      store: true,
      ...(tools && { tools }),
      ...(previous && { previous_response_id: previous }),
      ...(reasoningEffort && { reasoning: { effort: reasoningEffort } }),
    },
    timeoutMs
  );
}
