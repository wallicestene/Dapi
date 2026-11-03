"use client";

import { useEffect } from "react";
import { Mark } from "@/components/mark";

// The first visit, or a return after a while, opens on the mark drawing itself in the
// middle of the screen, then the page. The animation is pure CSS, so it clears itself
// even before scripts run. Once it starts, a cookie good for 12 hours tells the server
// not to send it again until then, and once it ends, <html data-seen> keeps a
// client-side return to the home page from replaying it.
const AFTER_A_WHILE = 12 * 60 * 60;

export function Intro() {
  useEffect(() => {
    document.cookie = `dapi-intro=1; path=/; max-age=${AFTER_A_WHILE}; samesite=lax`;
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
