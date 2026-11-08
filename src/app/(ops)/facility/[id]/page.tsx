import { Suspense } from "react";
import { FacilityView } from "./FacilityView";

// Params are request-time data under cacheComponents: resolve them inside Suspense so the shell prerenders.
export default function FacilityPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      <Resolved params={params} />
    </Suspense>
  );
}

async function Resolved({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FacilityView id={decodeURIComponent(id)} />;
}
