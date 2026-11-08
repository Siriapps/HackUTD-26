"use client";

import { useEffect } from "react";
import { useOps } from "@/store";
import { LoadingPanel } from "@/components/LoadingPanel";
import { TopBar } from "@/components/TopBar";
import { useMounted } from "@/components/useMounted";

/** Shell for the operator screens: top bar, dataset bootstrap, loading state. Footer lives in the root layout. */
export default function OpsLayout({ children }: { children: React.ReactNode }) {
  const mounted = useMounted();
  const init = useOps((s) => s.init);
  const phase = useOps((s) => s.phase);
  useEffect(() => {
    if (mounted) void init();
  }, [mounted, init]);

  return (
    <div className="h-[calc(100dvh-2rem)] flex flex-col min-h-0">
      {mounted && <TopBar />}
      {/* Pages render nothing until the store is ready, so children always mount (Next validates every segment renders). */}
      <main className="flex-1 min-h-0 overflow-auto">
        {!(mounted && phase === "ready") && <LoadingPanel />}
        {children}
      </main>
    </div>
  );
}
