/**
 * Shared-fleet ledger for historical replay. When "now" is after a failure's onset and we plan
 * it at onset, earlier recommended plans are assumed followed, so their trucks are busy until
 * `cycle_min` after their last arrival (SPEC).
 */
export class FleetLedger {
  private busy = new Map<string, number[]>();

  /** Trucks of `systemId` free at `tUnix`. */
  freeAt(systemId: string, fleetSize: number, tUnix: number): number {
    const b = this.busy.get(systemId) ?? [];
    return Math.max(0, fleetSize - b.filter((until) => until > tUnix).length);
  }

  /** Record one busy-until timestamp per dispatched truck. */
  commit(systemId: string, busyUntilUnix: number[]): void {
    const b = this.busy.get(systemId) ?? [];
    b.push(...busyUntilUnix);
    this.busy.set(systemId, b);
  }
}
