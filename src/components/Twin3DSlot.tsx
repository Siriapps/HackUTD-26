/**
 * W4 slot. Replace the body with `<Twin3D facility={…} readings={…} event={…} plan={…} t={now} />`
 * (lazy-loaded with next/dynamic, ssr: false) once src/components/Twin3D exists. Keep the outer sizing.
 */
export function Twin3DSlot({ facilityId }: { facilityId: string }) {
  return (
    <div
      className="h-full min-h-[200px] rounded-md border border-dashed border-line-1-2 grid place-items-center text-center px-4"
      data-twin-slot={facilityId}
    >
      <div>
        <p className="text-sm text-ink-2">Digital twin</p>
        <p className="text-xs text-ink-3 mt-1">
          Live tank, pump and pipeline for <span className="num">{facilityId}</span> mounts here (W4).
        </p>
      </div>
    </div>
  );
}
