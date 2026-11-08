import type { Viewport } from "next";
import { Suspense } from "react";
import FieldView, { FieldSkeleton } from "./FieldView";
import "../field.css";

export const viewport: Viewport = { themeColor: "#070b14", width: "device-width", initialScale: 1, viewportFit: "cover" };

/** Technician view. `params` is read inside Suspense so the shell prerenders under cacheComponents. */
export default function FieldPage({ params }: { params: Promise<{ eventId: string }> }) {
  return (
    <Suspense fallback={<FieldSkeleton />}>
      <FieldView params={params} />
    </Suspense>
  );
}
