// A spoken job: Muse Voice Transcribe turns the recording (WAV) into text, then Muse
// Spark writes it up as a spec the user checks before starting the job.

import { READ_ONLY, pipeline } from "@/lib/server/dapi";

const MAX_BYTES = 32 * 1024 * 1024;

export async function POST(request: Request) {
  if (READ_ONLY) return Response.json({ error: "This copy of Dapi is for exploring finished jobs; new jobs run locally." }, { status: 403 });
  const form = await request.formData();
  const audio = form.get("audio");
  if (!(audio instanceof File) || !audio.size) return Response.json({ error: "No recording arrived." }, { status: 400 });
  if (audio.size > MAX_BYTES) return Response.json({ error: "That recording is over 32 MB; keep it under ten minutes." }, { status: 400 });
  try {
    const { transcribe, specFromTranscript } = await pipeline<{
      transcribe: (wav: Buffer, o?: { keywords?: string[] }) => Promise<{ transcript: string; audioDurationMs: number }>;
      specFromTranscript: (t: string) => Promise<string>;
    }>("src/voice.js");
    const heard = await transcribe(Buffer.from(await audio.arrayBuffer()), { keywords: ["Apify", "Dapi"] });
    if (!heard.transcript?.trim()) return Response.json({ error: "Muse Voice Transcribe heard no speech in that recording." }, { status: 422 });
    const spec = await specFromTranscript(heard.transcript);
    return Response.json({ transcript: heard.transcript, seconds: Math.round(heard.audioDurationMs / 1000), spec });
  } catch (err) {
    return Response.json({ error: (err as Error).message.split("\n")[0] }, { status: 502 });
  }
}
