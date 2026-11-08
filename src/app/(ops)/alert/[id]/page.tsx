import { Suspense } from "react";
import { AlertView } from "./AlertView";

export default async function AlertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <AlertView id={id} />
    </Suspense>
  );
}
