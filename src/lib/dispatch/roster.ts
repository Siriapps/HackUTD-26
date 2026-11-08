// On-call roster: config/ops-roster.json (gitignored, real numbers) → falls back to the example file.
// DISPATCH_ONCALL_HANDLE overrides the on-call tech for quick demos.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PhotonPlatform } from "@/lib/photon/client";

export interface Person {
  name: string;
  role: string;
  channel: PhotonPlatform;
  handle: string;
  email?: string;
  systems?: string[];
}
export interface Roster {
  on_call: Person[];
  supervisor: Person[];
  morning_crew: Person[];
  /** "example" = placeholder numbers; never send to those. */
  source?: "roster" | "example" | "env" | "none";
}

export async function loadRoster(): Promise<Roster> {
  const dir = path.join(process.cwd(), "config");
  for (const f of ["ops-roster.json", "ops-roster.example.json"]) {
    try {
      const r = JSON.parse(await readFile(path.join(dir, f), "utf8")) as Roster;
      r.source = f === "ops-roster.json" ? "roster" : "example";
      const override = process.env.DISPATCH_ONCALL_HANDLE?.trim();
      if (override) {
        r.on_call = [{ name: "On call", role: "technician", channel: "imessage", handle: override, systems: ["*"] }];
        r.source = "env";
      }
      return r;
    } catch {
      /* try next */
    }
  }
  return { on_call: [], supervisor: [], morning_crew: [], source: "none" };
}

/** First on-call person covering this system ("*" covers all). */
export function onCallFor(roster: Roster, system: string): Person | undefined {
  return roster.on_call.find((p) => !p.systems?.length || p.systems.includes("*") || p.systems.includes(system));
}
