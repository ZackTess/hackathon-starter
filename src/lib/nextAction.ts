// "Next action" for a pool: what happens next and when. Pure wording on top
// of the rules output; no numbers are computed here.

import type { Analysis, Doses, PoolResult } from "./rules";

function doseText(d: Doses | null): string {
  if (!d) return "";
  const p: string[] = [];
  if (d.chlorineGal) p.push(`${d.chlorineGal.toFixed(1)} gal chlorine`);
  if (d.acidQt) p.push(`${d.acidQt} qt acid`);
  if (d.saltBags) p.push(`${d.saltBags} salt bags`);
  return p.join(" + ");
}

/** Which tech does this pool's next task: the reassigned tech for a moved stop, else the pool's own. */
export function taskTech(r: PoolResult, a: Analysis): string {
  const stop = a.plans.flatMap((p) => p.stops).find((s) => s.poolId === r.pool.id);
  return stop?.assignedTech ?? r.pool.tech;
}

export function nextAction(r: PoolResult, a: Analysis): string {
  const day = r.pool.serviceDay === a.todayAbbr ? "today's" : r.pool.serviceDay;
  const doses = doseText(r.doses);
  const tech = taskTech(r, a);

  switch (r.status) {
    case "Revisit today":
      if (r.makeup) return `Make-up visit today · ${tech}`;
      return `Revisit today · ${doses || "test on site"} · ${tech}`;
    case "Tomás": {
      const parts: string[] = [];
      if (r.cyaHigh != null) parts.push("Get customer OK for $175 drain/refill");
      if (r.equipmentNote) parts.push("Tomás to quote repair");
      const extra = doses ? ` · dose ${doses} at ${day} visit` : "";
      return `${parts.join(" · ")}${extra}`;
    }
    case "Data flag":
      return `Retest at ${day} visit · no doses until then`;
    case "Dose at next visit":
      return doses ? `Dose ${doses} at ${day} visit` : `Check at ${day} visit`;
    default:
      return `Routine service ${r.pool.serviceDay === a.todayAbbr ? "today" : r.pool.serviceDay}`;
  }
}
