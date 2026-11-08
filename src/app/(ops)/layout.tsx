"use client";

import { useEffect } from "react";
import { useOps } from "@/store";
import { LoadingPanel } from "@/components/LoadingPanel";
import { TopBar } from "@/components/TopBar";
import { SideRail } from "@/components/SideRail";
import { FiringToast } from "@/components/FiringToast";
import { useMounted } from "@/components/useMounted";

/** Shell for the operator screens: top bar, dataset bootstrap, loading state. Footer lives in the root layout. */
export default function OpsLayout({ children }: { children: React.ReactNode }) {
  const mounted = useMounted();
  const init = useOps((s) => s.init);
  const phase = useOps((s) => s.phase);
  useEffect(() => {
    if (mounted) void init();
    // Debug handle for scripted demos and smoke tests: window.flare.getState().setNow(...)
    if (typeof window !== "undefined") (window as unknown as { flare?: typeof useOps }).flare = useOps;
  }, [mounted, init]);

  return (
    <div className="h-[calc(100dvh-2rem)] flex min-h-0">
      {mounted && <SideRail />}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {mounted && <TopBar />}
        {/* Pages render nothing until the store is ready, so children always mount (Next validates every segment renders). */}
        <main className="flex-1 min-h-0 overflow-auto">
          {!(mounted && phase === "ready") && <LoadingPanel />}
          {children}
        </main>
      </div>
      {mounted && <FiringToast />}
    </div>
  );
}
