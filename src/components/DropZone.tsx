"use client";

import { useCallback, useEffect, useState } from "react";
import { useOps } from "@/store";

const NEEDED = ["network.json", "ops.json", "telemetry.csv"];

/**
 * Drop a dataset folder's three files anywhere on the console: they're saved as a new folder
 * and loaded. This is how the judges' folder comes in on stage.
 */
export function DropZone() {
  const [over, setOver] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const init = useOps((s) => s.init);
  const selectFolder = useOps((s) => s.selectFolder);

  const upload = useCallback(
    async (list: FileList | File[]) => {
      const files = Array.from(list);
      const pick = (n: string) => files.find((f) => f.name.toLowerCase() === n);
      const missing = NEEDED.filter((n) => !pick(n));
      if (missing.length) {
        setStatus(`Need ${missing.join(", ")}`);
        setTimeout(() => setStatus(null), 4000);
        return;
      }
      const fd = new FormData();
      for (const n of NEEDED) fd.append(n, pick(n)!);
      const guess = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split("/")[0];
      if (guess) fd.append("name", guess);
      setStatus("Uploading…");
      const r = await fetch("/api/datasets/upload", { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; folder?: string; rows?: number; error?: string };
      if (!r.ok || !j.ok || !j.folder) {
        setStatus(j.error ?? `Upload failed (${r.status})`);
        return;
      }
      setStatus(`Loaded ${j.folder} · ${j.rows?.toLocaleString("en-US")} rows`);
      useOps.setState({ phase: "idle" });
      await init();
      await selectFolder(j.folder);
      setTimeout(() => setStatus(null), 5000);
    },
    [init, selectFolder],
  );

  useEffect(() => {
    const onDrag = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        setOver(true);
      }
    };
    const onLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      setOver(false);
      void upload(e.dataTransfer.files);
    };
    window.addEventListener("dragover", onDrag);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDrag);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [upload]);

  return (
    <>
      <label className="btn cursor-pointer" title="Load a new dataset folder (network.json, ops.json, telemetry.csv)">
        Load folder
        <input
          type="file"
          multiple
          className="sr-only"
          // @ts-expect-error non-standard but universally supported
          webkitdirectory=""
          onChange={(e) => e.target.files && void upload(e.target.files)}
        />
      </label>
      {status && <span className="text-xs text-ink-2 whitespace-nowrap">{status}</span>}
      {over && (
        <div className="dropzone" aria-hidden>
          <div>
            <p className="text-xl font-semibold">Drop the folder</p>
            <p className="text-ink-2 mt-1">network.json · ops.json · telemetry.csv</p>
          </div>
        </div>
      )}
    </>
  );
}
