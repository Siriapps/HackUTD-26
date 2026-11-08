/** Arrival minutes for one truck making `trips` trips: response, response + cycle, ... */
export function arrivalsMin(responseMin: number, cycleMin: number, trips: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < trips; k++) out.push(responseMin + k * cycleMin);
  return out;
}

/** A truck is busy until `cycle_min` after its last arrival: start + response + trips × cycle. */
export function busyUntilUnix(startUnix: number, responseMin: number, cycleMin: number, trips: number): number {
  return startUnix + (responseMin + trips * cycleMin) * 60;
}

/** How many trips one truck can land strictly before the horizon (minutes). */
export function maxTrips(responseMin: number, cycleMin: number, horizonMin: number): number {
  if (responseMin >= horizonMin) return 0;
  return 1 + Math.floor((horizonMin - 1 - responseMin) / cycleMin);
}
