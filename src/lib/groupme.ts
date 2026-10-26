// Builds the Monday plan as plain-text GroupMe messages, in send order.
// Pure formatting of the rules output; no numbers are computed here.

import { shortDate, type Analysis, type Doses, type Load } from "./rules";

export const GROUPME_LIMIT = 1000;

function doses(d: Doses | null): string {
  if (!d) return "";
  const p: string[] = [];
  if (d.chlorineGal) p.push(`${d.chlorineGal.toFixed(1)} gal chlorine`);
  if (d.acidQt) p.push(`${d.acidQt} qt acid`);
  if (d.saltBags) p.push(`${d.saltBags} salt bags`);
  return p.join(", ");
}

function load(l: Load): string {
  return `${l.chlorineGal ? l.chlorineGal.toFixed(1) : 0} gal chlorine · ${l.acidQt} qt acid · ${l.saltBags} salt bags`;
}

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

export function buildGroupMeMessages(a: Analysis): string[] {
  const byId = new Map(a.pools.map((r) => [r.pool.id, r]));
  const day = shortDate(a.todayISO);
  const messages: string[][] = [];

  // 1. Headline
  const head = [`🚨 Royal Palm · ${day} plan`];
  if (a.unsafe.length) {
    head.push(`${a.unsafe.length} pool${a.unsafe.length === 1 ? "" : "s"} unsafe to swim, nobody had reviewed:`);
    for (const r of a.unsafe) {
      const why: string[] = [];
      if (r.reading?.water === "green" || r.reading?.water === "cloudy") why.push(`${r.reading.water} water`);
      if (r.reading?.fc != null) why.push(`FC ${r.reading.fc}`);
      head.push(`- ${r.pool.id} ${r.pool.customer} (${why.join(", ")})`);
    }
  } else {
    head.push("No pools unsafe to swim.");
  }
  head.push("");
  head.push(`💵 $${a.billing.total.toLocaleString("en-US")} billable found`);
  head.push(`- $${a.billing.saltDollars} salt (${a.billing.saltBags} bags)`);
  head.push(`- $${a.billing.drainDollars} drain/refill (${a.billing.drains}, needs customer OK)`);
  messages.push(head);

  // 2. One message per tech
  for (const p of a.plans) {
    const m = [`🚚 ${p.tech} · ${p.stops.length} extra stop${p.stops.length === 1 ? "" : "s"}`];
    p.stops.forEach((s, i) => {
      const r = byId.get(s.poolId);
      const fc = r?.reading?.fc;
      const reason =
        s.reason === "green" || s.reason === "cloudy" ? `${s.label}${fc != null ? `, FC ${fc}` : ""}` : s.label;
      const what =
        s.reason === "makeup" ? "test on site" : s.doses ? doses(s.doses) || "no dose needed" : "no computed dose, test on site";
      m.push(`${i + 1}. ${s.poolId} ${s.customer} · ${reason}${s.reassigned ? ` · REASSIGNED from ${s.ownTech}` : ""}`);
      m.push(`   ${what}`);
    });
    if (p.stops.length === 0) m.push("No extra stops.");
    if (p.handedOff.length) m.push(`Handed off: ${p.handedOff.map((s) => `${s.poolId} → ${s.assignedTech}`).join(", ")}`);
    if (p.routeDoses.length) {
      m.push("Regular route today:");
      p.routeDoses.forEach((r) => m.push(`- ${r.poolId} ${r.customer}: ${doses(r.doses)}`));
    }
    m.push(`Truck: ${load(p.load.total)}`);
    messages.push(m);
  }

  // 3. For Tomás
  const t = ["🔧 For Tomás"];
  if (a.tomas.equipment.length) {
    t.push("Equipment, needs repair quote (no price to customer):");
    a.tomas.equipment.forEach((e) => t.push(`- ${e.poolId} ${e.customer} (${e.tech}): "${e.note}"`));
  }
  if (a.tomas.cya.length) {
    t.push("Approvals needed:");
    a.tomas.cya.forEach((c) => t.push(`- ${c.poolId} ${c.customer}: CYA ${c.cya} > 100, $${c.cost} drain/refill, text asks for OK`));
  }
  if (t.length === 1) t.push("Nothing today.");
  messages.push(t);

  // 4. Data flags
  const flagged = a.pools.filter((r) => r.dataFlag);
  const d = ["🧪 Data flags · retest/check, no doses given"];
  flagged.forEach((r) => {
    const why = r.findings
      .filter((f) => f.kind === "data")
      .map((f) => f.text.split(" → ")[0])
      .join("; ");
    d.push(`- ${r.pool.id} ${r.pool.customer} (${r.pool.tech}, retest ${r.pool.serviceDay === a.todayAbbr ? "today" : r.pool.serviceDay}): ${why}`);
  });
  if (flagged.length === 0) d.push("None.");
  messages.push(d);

  return messages.flatMap((lines) => chunk(lines));
}
