"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowRight, FileText, Loader2, Mic, Square, Upload, X } from "lucide-react";
import { toWav } from "@/lib/wav";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DotPattern } from "@/components/ui/dot-pattern";
import { cn } from "@/lib/utils";

type Mode = "file" | "text" | "voice";
const MODES: { key: Mode; label: string }[] = [
  { key: "file", label: "Upload" },
  { key: "text", label: "Paste" },
  { key: "voice", label: "Speak" },
];

export function NewJobForm() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("file");
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
          // The written-up spec goes to Paste, to check before starting.
          setHeard(body.transcript);
          setText(body.spec);
          setMode("text");
        } catch (err) {
          setError((err as Error).message);
        }
        setVoice("idle");
      };
      recorder.current = rec;
      rec.start();
      setVoice("recording");
    } catch {
      setError("Dapi couldn't use the microphone. Allow it in the browser, or paste the spec instead.");
    }
  };

  const ready = mode === "file" ? Boolean(file) : mode === "text" ? Boolean(text.trim()) : false;
  const start = async () => {
    setBusy(true);
    setError(null);
    const form = new FormData();
    if (mode === "file" && file) form.set("spec", file);
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
      className="flex flex-col overflow-hidden rounded-xl border bg-sheet shadow-[0_1px_2px_rgb(15_26_36/0.05)]"
      onSubmit={(e) => {
        e.preventDefault();
        start();
      }}
    >
      <div role="tablist" aria-label="How to send the spec" className="flex gap-1 border-b p-1.5">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={mode === m.key}
            onClick={() => setMode(m.key)}
            className={cn("h-9 flex-1 rounded-lg text-[14px] font-medium transition-colors", mode === m.key ? "bg-white text-ink shadow-[0_1px_2px_rgb(15_26_36/0.1)] ring-1 ring-border" : "text-ink-2 hover:bg-raised hover:text-ink")}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="p-5">
        {mode === "file" &&
          (file ? (
            <div className="flex items-center gap-4 rounded-lg border bg-white px-4 py-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-raised">
                <FileText aria-hidden className="size-5 text-ink-2" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[15px] font-medium">{file.name}</p>
                <p className="text-[13px] text-ink-2">{(file.size / 1024).toFixed(0)} KB · ready to read</p>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label="Remove the file" className="ml-auto text-ink-2" onClick={() => setFile(null)}>
                <X />
              </Button>
            </div>
          ) : (
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
                "relative flex min-h-60 cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-lg border border-dashed border-control bg-white px-6 py-10 text-center transition-colors hover:border-ink-3",
                over && "border-source bg-[#f4f2ff]"
              )}
            >
              <DotPattern width={14} height={14} cr={1} className="text-ink/15 [mask-image:radial-gradient(240px_circle_at_center,white,transparent)]" />
              <span className={cn("relative grid size-12 place-items-center rounded-full bg-ink text-sheet transition-transform", over && "scale-110 bg-source")}>
                <Upload aria-hidden className="size-5" />
              </span>
              <p className="relative text-[16px] font-semibold">Drop your spec here</p>
              <p className="relative text-[13px] text-ink-2">PDF, Markdown or text, up to 15 MB · or click to choose</p>
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
          ))}

        {mode === "text" && (
          <div className="flex flex-col gap-2">
            {heard && (
              <p className="rounded-lg bg-raised px-3 py-2 text-[13px] text-ink-2">
                Heard: <q>{heard}</q> Muse Spark wrote it up below. Check it, then start.
              </p>
            )}
            <label htmlFor="spec-text" className="sr-only">
              The spec
            </label>
            <Textarea
              id="spec-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={11}
              placeholder={"Source: https://…\nOne row per: …\nColumns: …\nSample rows: …\nRules: …"}
              className="min-h-60 border-control bg-white font-mono text-[13px] leading-relaxed placeholder:text-ink-3"
            />
          </div>
        )}

        {mode === "voice" && (
          <div className="flex min-h-60 flex-col items-center justify-center gap-4 rounded-lg border bg-white px-6 py-10 text-center">
            <button
              type="button"
              disabled={voice === "listening"}
              onClick={voice === "recording" ? () => recorder.current?.stop() : record}
              aria-label={voice === "recording" ? "Stop and use the recording" : "Start recording"}
              className={cn("relative grid size-16 place-items-center rounded-full text-white transition-transform active:scale-95", voice === "recording" ? "bg-extract" : "bg-ink hover:bg-[#2b3f52]")}
            >
              {voice === "recording" && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-extract/40" />}
              {voice === "listening" ? <Loader2 aria-hidden className="size-6 animate-spin" /> : voice === "recording" ? <Square aria-hidden className="relative size-5" /> : <Mic aria-hidden className="size-6" />}
            </button>
            <p className="text-[16px] font-semibold">{voice === "recording" ? "Listening. Tap to stop." : voice === "listening" ? "Writing it up…" : "Say what you need"}</p>
            <p className="max-w-[380px] text-[13px] text-ink-2">
              {voice === "listening" ? "Muse Voice Transcribe hears it; Muse Spark writes it up as a spec you can check." : "Name the site, what one row is, and the columns you want."}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t bg-raised px-5 py-3.5">
        <Button type="submit" disabled={busy || !ready} className="h-10 gap-2 px-4 text-[14px]">
          {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {busy ? "Starting…" : "Start the job"}
          {!busy && <ArrowRight aria-hidden />}
        </Button>
        <p className="text-[13px] text-ink-2">Nothing runs on Apify until you approve the plan.</p>
        {error && <p className="w-full text-[14px] text-pencil-red">{error}</p>}
      </div>
    </form>
  );
}
