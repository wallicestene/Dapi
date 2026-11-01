"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { FileText, Upload } from "lucide-react";
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
        <div className="flex flex-col gap-2">
          <label htmlFor="spec-text" className="text-[14px] font-medium">
            Or paste it
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
