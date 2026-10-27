// The one place Dapi talks to the Meta Model API: auth, retries, errors.

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

// Retries 429s and 5xx with exponential backoff and jitter, honouring Retry-After.
// Rate limits are per team, so one busy run can hit them for everything else.
async function post(path, body, timeoutMs, attempts = 3) {
  if (!process.env.MODEL_API_KEY) throw new Error('MODEL_API_KEY is not set: add it to dapi/.env');

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.MODEL_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return res.json();

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === attempts) {
      throw new Error(`Meta API ${path} returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000 + Math.random() * 1000;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}
