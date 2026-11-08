import type { Metadata } from "next";
import { Suspense } from "react";
import { TwinPreview } from "./TwinPreview";

export const metadata: Metadata = { title: "Twin preview · Avon Night Shift" };

/** Standalone harness for the digital twin: /twin-preview?folder=…&facility=…&t=…&event=…&plan=… */
export default function Page() {
  return (
    <Suspense fallback={<main className="flex-1 p-4 text-ink-3">Getting the preview ready…</main>}>
      <TwinPreview />
    </Suspense>
  );
}
