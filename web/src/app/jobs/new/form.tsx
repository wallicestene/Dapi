"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { FileText, Mic, Square, Upload } from "lucide-react";
import { toWav } from "@/lib/wav";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function NewJobForm() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Spoken jobs: record, then Muse Voice Transcribe hears it and Muse Spark writes it up.
  const recorder = useRef<MediaRecorder | null>(null);
  const [voice, setVoice] = useState<"idle" | "recording" | "listening">("idle");
  const [heard, setHeard] = useState<string | null>(null);

  const record = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setVoice("listening");
        try {
          const form = new FormData();
          form.set("audio", await toWav(new Blob(chunks, { type: rec.mimeType })), "spec.wav");
          const res = await fetch("/api/voice", { method: "POST", body: form });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error ?? "Couldn't hear that recording.");
          setHeard(body.transcript);
          setFile(null);
          setText(body.spec);
        } catch (err) {
          setError((err as Error).message);
        }
        setVoice("idle");
      };
      recorder.current = rec;
      rec.start();
      setVoice("recording");
    } catch {
      setError("Dapi couldn't use the microphone. Allow it in the browser, or type the spec instead.");
    }
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    const form = new FormData();
    if (file) form.set("spec", file);
    else form.set("text", text);
    const res = await fetch("/api/jobs", { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Couldn't start the job. Try again.");
      setBusy(false);
      return;
    }
    router.push(`/jobs/${body.id}`);
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start();
      }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label="Choose your spec file"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const dropped = e.dataTransfer.files[0];
          if (dropped) setFile(dropped);
        }}
        className={cn(
          "flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-control bg-sheet px-6 py-8 text-center hover:bg-raised",
          over && "border-ink bg-raised"
        )}
      >
        {file ? (
          <>
            <FileText aria-hidden className="size-5 text-ink-2" />
            <p className="text-[15px] font-medium">{file.name}</p>
            <p className="text-[13px] text-ink-2">{(file.size / 1024).toFixed(0)} KB · click to choose another</p>
          </>
        ) : (
          <>
            <Upload aria-hidden className="size-5 text-ink-2" />
            <p className="text-[15px] font-medium">Drop your spec here, or click to choose it</p>
            <p className="text-[13px] text-ink-2">PDF, Markdown or text, up to 15 MB</p>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept=".pdf,.md,.txt"
          className="hidden"
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            if (chosen) setFile(chosen);
          }}
        />
      </div>

      {!file && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-sheet px-4 py-3">
          {voice === "recording" ? (
            <Button type="button" onClick={() => recorder.current?.stop()} className="h-9 gap-2 px-4">
              <Square aria-hidden className="size-3.5" /> Stop and use it
            </Button>
          ) : (
            <Button type="button" variant="outline" disabled={voice === "listening"} onClick={record} className="h-9 gap-2 border-control bg-white px-4">
              <Mic aria-hidden className="size-4" /> {voice === "listening" ? "Listening…" : "Describe it out loud"}
            </Button>
          )}
          <p className="text-[13px] text-ink-2">
            {voice === "recording"
              ? "Recording: say which site, what one row is, and the columns you need."
              : voice === "listening"
                ? "Muse Voice Transcribe is listening to your recording; Muse Spark will write it up as a spec."
                : "Say what you need; Dapi writes it up as a spec you can check before it starts."}
          </p>
          {heard && <p className="w-full text-[13px] text-ink-2">Heard: <q>{heard}</q></p>}
        </div>
      )}

      {!file && (
        <div className="flex flex-col gap-2">
          <label htmlFor="spec-text" className="text-[14px] font-medium">
            {heard ? "The spec, written up from what you said: check it, then start" : "Or paste it"}
          </label>
          <Textarea
            id="spec-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            placeholder={"Source: https://…\nColumns: …\nSample rows: …\nRules: one row per …"}
            className="border-control bg-white text-[14px] placeholder:text-ink-3"
          />
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || (!file && !text.trim())} className="h-9 px-4">
          {busy ? "Starting…" : "Start the job"}
        </Button>
        {file && (
          <Button type="button" variant="ghost" className="h-9 text-ink-2" onClick={() => setFile(null)}>
            Remove the file
          </Button>
        )}
        <p className="text-[13px] text-ink-2">Nothing runs on Apify until you approve the plan.</p>
      </div>
      {error && <p className="text-[14px] text-pencil-red">{error}</p>}
    </form>
  );
}
