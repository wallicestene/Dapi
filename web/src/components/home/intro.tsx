"use client";

import { useEffect } from "react";
import { Mark } from "@/components/mark";

// The first visit opens on the mark drawing itself in the middle of the screen, then the
// page. The animation is pure CSS, so it clears itself even before scripts run. Once it
// starts, a session cookie tells the server not to send it again this visit, and once it
// ends, <html data-seen> keeps a client-side return to the home page from replaying it.
export function Intro() {
  useEffect(() => {
    document.cookie = "dapi-intro=1; path=/; samesite=lax";
  }, []);
  return (
    <div
      aria-hidden
      className="dapi-intro"
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) document.documentElement.dataset.seen = "1";
      }}
    >
      <Mark draw className="size-28" />
    </div>
  );
}
