"use client";

import { useOps } from "@/store";

export function FolderPicker() {
  const folders = useOps((s) => s.folders);
  const folder = useOps((s) => s.folder);
  const phase = useOps((s) => s.phase);
  const selectFolder = useOps((s) => s.selectFolder);
  const loading = phase === "fetching" || phase === "parsing" || phase === "analysing" || phase === "listing";
  return (
    <label className="flex items-center gap-2 text-sm text-ink-2">
      <span className="hidden min-[1100px]:inline">Folder</span>
      <select
        className="select num max-w-[240px]"
        value={folder ?? ""}
        onChange={(e) => selectFolder(e.target.value)}
        disabled={loading || !folders.length}
        aria-label="Dataset folder"
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
