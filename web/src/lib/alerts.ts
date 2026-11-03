"use client";

import { useEffect, useRef, useState } from "react";
import type { Job } from "./types";

// The moments a job needs you or is done: its plan waits for your Go, it's delivered,
// or it stopped. Each one gets a soft chime (rising for good news, falling for a stop),
// the tab title flashing until you look, and, when the tab is in the background and
// you've allowed it, a desktop notification. Off is remembered in this browser.
const KEY = "dapi-alerts";

export function useAlerts(job: Job) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    try {
      setOn(localStorage.getItem(KEY) !== "off");
    } catch {
      // no storage: alerts stay on
    }
  }, []);

  const was = useRef(job.status);
  useEffect(() => {
    const before = was.current;
    was.current = job.status;
    if (!on || before === job.status) return;
    const moment: [string, string, boolean] | null =
      job.status === "waiting"
        ? ["Ready to run", "The plan is ready. Dapi needs your Go.", false]
        : job.status === "done"
          ? ["Delivered", `${(job.rows ?? 0).toLocaleString("en-US")} rows, counted against the source.`, false]
          : job.status === "held"
            ? ["Paused", "Paused before the next step. Resume when you're ready.", false]
          : job.status === "failed" || job.status === "declined"
            ? ["Stopped", job.failed ?? job.declined ?? "A step needs you.", true]
            : null;
    if (!moment) return;
    const [title, body, sad] = moment;
    chime(sad);
    flashTitle(title);
    notify(title, body);
  }, [job.status, job.rows, job.failed, job.declined, on]);

  const toggle = async () => {
    const next = !on;
    if (next && typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission().catch(() => {});
    }
    setOn(next);
    try {
      localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      // not remembered
    }
    if (next) chime(false);
  };
  return { on, toggle };
}

function chime(sad: boolean) {
  try {
    const ctx = new AudioContext();
    const notes = sad ? [523.25, 392] : [659.25, 987.77];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.55);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {
    // no sound available
  }
}

function flashTitle(text: string) {
  const original = document.title;
  let shown = false;
  const timer = setInterval(() => {
    document.title = shown ? original : `● ${text}`;
    shown = !shown;
  }, 1000);
  const stop = () => {
    clearInterval(timer);
    document.title = original;
    window.removeEventListener("focus", stop);
    document.removeEventListener("visibilitychange", seen);
  };
  const seen = () => {
    if (!document.hidden) stop();
  };
  window.addEventListener("focus", stop);
  document.addEventListener("visibilitychange", seen);
  // Already looking at it: a few flashes, then back to normal.
  if (!document.hidden && document.hasFocus()) setTimeout(stop, 6000);
}

function notify(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted" || !document.hidden) return;
  const note = new Notification(`Dapi · ${title}`, { body, icon: "/icon.svg" });
  note.onclick = () => {
    window.focus();
    note.close();
  };
}
