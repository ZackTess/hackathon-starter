// Builds the Monday plan as plain-text GroupMe messages, one batch per group.
// Pure formatting of the rules output; no numbers are computed here.

import { shortDate, type Analysis, type Doses, type Load, type Stop } from "./rules";

export const GROUPME_LIMIT = 1000;

export interface GroupBatch {
  /** "team", "tomas", or a tech slug like "raul". The server maps it to GROUPME_BOT_<TARGET>. */
  target: string;
  /** Group name as people see it. */
  label: string;
  messages: string[];
}

/** "Raúl" → "raul". Used for the bot env var name. */
export function techSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function doses(d: Doses | null): string {
  if (!d) return "";
  const p: string[] = [];
  if (d.chlorineGal) p.push(`${d.chlorineGal.toFixed(1)} gal chlorine`);
  if (d.acidQt) p.push(`${d.acidQt} qt acid`);
  if (d.saltBags) p.push(`${d.saltBags} salt bags`);
  return p.join(" + ");
}

function load(l: Load): string {
  return `${l.chlorineGal ? l.chlorineGal.toFixed(1) : 0} gal chlorine · ${l.acidQt} qt acid · ${l.saltBags} salt bags`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Split lines into messages under the limit, never breaking a line unless it alone is too long. */
function chunk(lines: string[], limit = GROUPME_LIMIT): string[] {
  const out: string[] = [];
  let cur = "";
  for (const raw of lines) {
    const pieces: string[] = [];
    for (let s = raw; s.length > 0; s = s.slice(limit)) pieces.push(s.slice(0, limit));
    if (pieces.length === 0) pieces.push("");
    for (const line of pieces) {
      const next = cur ? `${cur}\n${line}` : line;
      if (next.length > limit) {
        out.push(cur);
        cur = `(cont.)\n${line}`.slice(0, limit);
      } else {
        cur = next;
      }
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const isUnsafe = (s: Stop) => s.reason !== "makeup";

export function buildGroupMePlan(a: Analysis): GroupBatch[] {
  const byId = new Map(a.pools.map((r) => [r.pool.id, r]));
  const day = shortDate(a.todayISO);
  const flagged = a.pools.filter((r) => r.dataFlag);
  const batches: GroupBatch[] = [];

  // ---- Team: short overview ----
  const team = [`🚨 Royal Palm · ${day}`];
  team.push(
    a.unsafe.length
      ? `${plural(a.unsafe.length, "pool")} unsafe to swim (${a.unsafe.map((r) => r.pool.id).join(", ")}). Revisits today.`
      : "No unsafe pools this week."
  );
  team.push(`$${a.billing.total.toLocaleString("en-US")} billable found ($${a.billing.saltDollars} salt, $${a.billing.drainDollars} drain pending OK).`);
  team.push("");
  // Busiest tech first, matching how the day will feel.
  const plans = [...a.plans].sort((x, y) => y.stops.length - x.stops.length || a.techs.indexOf(x.tech) - a.techs.indexOf(y.tech));
  for (const p of plans) {
    const bits = [plural(p.stops.length, "extra stop")];
    const unsafe = p.stops.filter(isUnsafe).length;
    if (unsafe) bits.push(`${unsafe} unsafe first`);
    const picked = p.stops.filter((s) => s.reassigned);
    if (picked.length) bits.push(`picked up ${picked.map((s) => `${s.poolId} from ${s.ownTech}`).join(", ")}`);
    team.push(`${p.tech}: ${bits.join(", ")}`);
  }
  team.push(`Tomás: ${plural(a.tomas.equipment.length, "repair call")}, ${plural(a.tomas.cya.length, "approval")}`);
  team.push("");
  team.push("Full details sent to each of you directly.");
  batches.push({ target: "team", label: "Royal Palm – Team", messages: chunk(team) });

  // ---- Each tech: action first ----
  for (const p of a.plans) {
    const m = [`🚚 ${p.tech} · ${day} · ${plural(p.stops.length, "extra stop")}`];
    const unsafe = p.stops.filter(isUnsafe);
    const makeups = p.stops.filter((s) => !isUnsafe(s));
    let n = 0;

    if (unsafe.length) {
      m.push("Unsafe first, keep swimmers out until treated:");
      for (const s of unsafe) {
        const r = byId.get(s.poolId);
        const fc = r?.reading?.fc;
        const action = s.doses ? doses(s.doses) || "Test and treat" : "Test on site (no computed dose)";
        const why = s.reason === "lowFC" ? `FC ${fc}` : `${s.label.toLowerCase()}${fc != null ? `, FC ${fc}` : ""}`;
        m.push(`${++n}. ${s.poolId} ${s.customer}: ${action}. ${why[0].toUpperCase()}${why.slice(1)}${s.reassigned ? ` (from ${s.ownTech})` : ""}`);
      }
    }
    if (makeups.length) {
      m.push(`${makeups.length === 1 ? "Make-up visit" : "Make-up visits"}, full service, test on site:`);
      for (const s of makeups) {
        m.push(`${++n}. ${s.poolId} ${s.customer}, ${s.area}${s.reassigned ? ` (picked up from ${s.ownTech})` : ""}`);
      }
    }
    if (p.stops.length === 0) m.push("No extra stops today.");
    if (p.handedOff.length) {
      m.push(`Handed off: ${p.handedOff.map((s) => `${s.poolId} ${s.customer} → ${s.assignedTech}`).join(", ")}`);
    }
    if (p.routeDoses.length) {
      m.push("On your regular route today:");
      p.routeDoses.forEach((r) => m.push(`- ${r.poolId} ${r.customer}: ${doses(r.doses)}`));
    }
    m.push("");
    m.push(`Load the truck: ${load(p.load.total)}`);
    batches.push({ target: techSlug(p.tech), label: `Royal Palm – ${p.tech}`, messages: chunk(m) });
  }

  // ---- Tomás: approvals, repairs, data flags ----
  const t = [`🔧 Tomás · ${day}`];
  if (a.tomas.cya.length) {
    t.push(`Approvals (${a.tomas.cya.length}), customer text drafted asking for OK:`);
    a.tomas.cya.forEach((c) => t.push(`- ${c.poolId} ${c.customer}: CYA ${c.cya} > 100, $${c.cost} drain/refill. Wait for YES.`));
  }
  if (a.tomas.equipment.length) {
    t.push(`Repair calls (${a.tomas.equipment.length}), quote them, never give a price by text:`);
    a.tomas.equipment.forEach((e) => t.push(`- ${e.poolId} ${e.customer} (${e.tech}): "${e.note}"`));
  }
  if (a.tomas.cya.length + a.tomas.equipment.length === 0) t.push("No approvals or repair calls.");
  t.push("");
  t.push(`🧪 Data flags (${flagged.length}), retest at next visit, no doses given:`);
  if (flagged.length === 0) t.push("None.");
  flagged.forEach((r) => {
    const why = r.findings
      .filter((f) => f.kind === "data")
      .map((f) => f.text.split(" → ")[0])
      .join("; ");
    const when = r.pool.serviceDay === a.todayAbbr ? "today" : r.pool.serviceDay;
    t.push(`- ${r.pool.id} ${r.pool.customer} (${r.pool.tech}, ${when}): ${why}`);
  });
  batches.push({ target: "tomas", label: "Royal Palm – Tomás", messages: chunk(t) });

  return batches;
}
