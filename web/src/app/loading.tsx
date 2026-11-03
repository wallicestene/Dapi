import { Mark } from "@/components/mark";

// While a page is on its way (a slow connection, a big job): the mark draws itself in the
// middle of the screen, over and over, until the page arrives. It waits a moment before
// it shows, so a page that loads quickly never flashes it.
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="dapi-loading fixed inset-0 z-50 grid place-items-center bg-background">
      <Mark className="mark-loop size-20" />
    </div>
  );
}
