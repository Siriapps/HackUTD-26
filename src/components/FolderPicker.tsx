"use client";

import { useOps } from "@/store";

/** Dataset switcher: every folder under public/data with network.json + ops.json + telemetry.csv. */
export function FolderPicker() {
  const folders = useOps((s) => s.folders);
  const folder = useOps((s) => s.folder);
  const phase = useOps((s) => s.phase);
  const selectFolder = useOps((s) => s.selectFolder);
  const loading = phase === "fetching" || phase === "parsing" || phase === "analysing" || phase === "listing";
  return (
    <label className="flex items-center gap-2 text-sm text-ink-2">
      <span className="hidden min-[1100px]:inline text-ink-3">Folder</span>
      <select
        className="select num max-w-[260px]"
        value={folder ?? ""}
        onChange={(e) => selectFolder(e.target.value)}
        disabled={loading || !folders.length}
        aria-label="Dataset folder"
        title={loading ? `Loading ${phase}…` : "Load a folder from public/data"}
      >
        {!folders.length && <option value="">No folders</option>}
        {folders.map((f) => (
          <option key={f.folder} value={f.folder}>
            {f.folder}
          </option>
        ))}
      </select>
    </label>
  );
}
