// Royal Palm Pool Service rules, straight from data/royalpalm_playbook.md.
// Everything about money, safety, doses and capacity lives here, in plain code.
// No AI is involved in any of it.

import { missingColumns, parseCsv } from "./csv";
import { classifyByKeywords, isNoService, type NoteClass } from "./notes";

export const RULES = {
  fcMin: 3,
  fcMax: 5,
  fcUnsafe: 1.0,
  fcTarget: 5,
  fcShock: 10,
  phActLow: 7.2,
  phActHigh: 7.8,
  phTarget: 7.5,
  phValidMin: 6.0,
  phValidMax: 9.0,
  alkMin: 80,
  alkMax: 120,
  cyaMin: 30,
  cyaMax: 80,
  cyaDrain: 100,
  drainCost: 175,
  saltMin: 3000,
  saltMax: 3800,
  saltDoseBelow: 2800,
  saltTarget: 3400,
  saltPpmPerBag: 480,
  saltBagPrice: 12,
  gallonsMin: 8000,
  gallonsMax: 40000,
  maxExtraStops: 3,
} as const;

// ---------- Types ----------

export type Language = "en" | "es";

export interface Pool {
  id: string;
  customer: string;
  area: string;
  type: "chlorine" | "salt";
  gallons: number | null;
  gallonsRaw: string;
  hasSpa: boolean;
  serviceDay: string; // Mon, Tue, ...
  tech: string;
  monthlyRate: number | null;
  language: Language;
}

export interface Reading {
  poolId: string;
  date: string; // YYYY-MM-DD
  tech: string;
  fc: number | null;
  ph: number | null;
  alk: number | null;
  cya: number | null;
  salt: number | null;
  water: string;
  note: string;
}

export type Status =
  | "Revisit today"
  | "Tomás"
  | "Data flag"
  | "Dose at next visit"
  | "OK";

export const STATUS_ORDER: Status[] = [
  "Revisit today",
  "Tomás",
  "Data flag",
  "Dose at next visit",
  "OK",
];

export type FindingKind =
  | "unsafe"
  | "makeup"
  | "data"
  | "equipment"
  | "cya"
  | "chlorine"
  | "acid"
  | "salt"
  | "note"
  | "info";

export interface Finding {
  kind: FindingKind;
  /** The status this finding pushes the pool toward. null = informational. */
  status: Status | null;
  text: string;
  /** Worked formula, when a dose was computed. */
  calc?: string;
}

export interface Doses {
  chlorineGal: number;
  acidQt: number;
  saltBags: number;
  saltCost: number;
}

export type RevisitReason = "green" | "cloudy" | "lowFC" | "makeup";

export interface PoolResult {
  pool: Pool;
  reading: Reading | null;
  status: Status;
  findings: Finding[];
  /** null when doses can't be computed (data flag) or nothing was read. */
  doses: Doses | null;
  /** When the doses are given. */
  doseWhen: string;
  revisit: { reason: RevisitReason; urgency: number; label: string } | null;
  unsafe: boolean;
  makeup: boolean;
  dataFlag: boolean;
  onRouteToday: boolean;
  equipmentNote: string | null;
  noteClass: NoteClass | null;
  cyaHigh: number | null;
}

export interface Stop {
  poolId: string;
  customer: string;
  area: string;
  ownTech: string;
  assignedTech: string;
  reassigned: boolean;
  reason: RevisitReason;
  label: string;
  urgency: number;
  doses: Doses | null;
  overCapacity: boolean;
}

export interface Load {
  chlorineGal: number;
  acidQt: number;
  saltBags: number;
}

export interface TechPlan {
  tech: string;
  stops: Stop[];
  handedOff: Stop[];
  routeDoses: { poolId: string; customer: string; doses: Doses }[];
  load: { extra: Load; route: Load; total: Load };
}

export type TextKind = "unsafe" | "makeup" | "cya";

export interface TextJob {
  id: string;
  poolId: string;
  to: string;
  firstName: string;
  language: Language;
  kinds: TextKind[];
  /** Plain-English facts. The only things a draft may say. */
  facts: string[];
  data: {
    visitDate: string | null;
    todayISO: string;
    tech: string;
    fc: number | null;
    water: string | null;
    cya: number | null;
    drainCost: number;
  };
  /** Dollar amounts a draft is allowed to mention. */
  allowedDollars: number[];
}

export interface Analysis {
  todayISO: string;
  todayAbbr: string;
  weekStartISO: string;
  weekEndISO: string;
  techs: string[];
  pools: PoolResult[];
  plans: TechPlan[];
  unsafe: PoolResult[];
  billing: {
    saltBags: number;
    saltDollars: number;
    drains: number;
    drainDollars: number;
    total: number;
  };
  tomas: {
    equipment: { poolId: string; customer: string; tech: string; note: string; date: string }[];
    cya: { poolId: string; customer: string; cya: number; cost: number; language: Language }[];
  };
  textJobs: TextJob[];
  warnings: string[];
}

// ---------- Parsing ----------

const POOL_COLS = ["pool_id", "customer", "gallons", "service_day", "tech", "language", "type"];
const READING_COLS = ["pool_id", "visit_date", "free_chlorine", "ph", "alkalinity", "cya", "salt", "water", "tech_note"];

function num(v: string | undefined): number | null {
  if (v == null) return null;
  const s = v.replace(/,/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const DAY_ABBRS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function normDay(v: string): string {
  const s = v.trim().slice(0, 3).toLowerCase();
  return DAY_ABBRS.find((d) => d.toLowerCase() === s) ?? v.trim();
}

export function parsePools(text: string): { pools: Pool[]; error: string | null } {
  const rows = parseCsv(text);
  const missing = missingColumns(rows, POOL_COLS);
  if (missing.length) return { pools: [], error: `Pools file is missing columns: ${missing.join(", ")}` };
  return {
    error: null,
    pools: rows
      .filter((r) => r.pool_id)
      .map((r) => ({
        id: r.pool_id,
        customer: r.customer,
        area: r.area ?? "",
        type: r.type?.toLowerCase().startsWith("salt") ? "salt" : "chlorine",
        gallons: num(r.gallons),
        gallonsRaw: r.gallons,
        hasSpa: /^(yes|y|true|1)$/i.test(r.has_spa ?? ""),
        serviceDay: normDay(r.service_day),
        tech: r.tech,
        monthlyRate: num(r.monthly_rate),
        language: r.language?.toLowerCase().startsWith("es") ? "es" : "en",
      })),
  };
}

export function parseReadings(text: string): { readings: Reading[]; error: string | null } {
  const rows = parseCsv(text);
  const missing = missingColumns(rows, READING_COLS);
  if (missing.length) return { readings: [], error: `Readings file is missing columns: ${missing.join(", ")}` };
  return {
    error: null,
    readings: rows
      .filter((r) => r.pool_id && /^\d{4}-\d{2}-\d{2}$/.test(r.visit_date))
      .map((r) => ({
        poolId: r.pool_id,
        date: r.visit_date,
        tech: r.tech ?? "",
        fc: num(r.free_chlorine),
        ph: num(r.ph),
        alk: num(r.alkalinity),
        cya: num(r.cya),
        salt: num(r.salt),
        water: (r.water ?? "").toLowerCase(),
        note: r.tech_note ?? "",
      })),
  };
}

// ---------- Dates ----------

function toDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}
function mondayOf(d: Date): Date {
  return addDays(d, -((d.getUTCDay() + 6) % 7));
}
export function dayAbbr(iso: string): string {
  return DAY_ABBRS[toDate(iso).getUTCDay()];
}
export function shortDate(iso: string): string {
  const d = toDate(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${DAY_ABBRS[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// ---------- Math ----------

/** Round up to the next multiple of `step`, ignoring float noise. */
export function roundUp(x: number, step: number): number {
  if (x <= 0) return 0;
  const units = Math.ceil(Number((x / step).toFixed(9)));
  return Number((units * step).toFixed(4));
}

const fmt = (n: number) => n.toLocaleString("en-US");
const fix = (n: number, d = 2) => Number(n.toFixed(d)).toString();

export function chlorineDose(fc: number, target: number, gallons: number) {
  const raw = ((target - fc) * (gallons / 10000)) / 10;
  const gal = roundUp(raw, 0.5);
  return {
    gal,
    calc: `(${target} − ${fc}) × ${fmt(gallons)}/10,000 ÷ 10 = ${fix(raw)} → ${gal.toFixed(1)} gal`,
  };
}

export function acidDose(ph: number, gallons: number) {
  const raw = ((ph - RULES.phTarget) / 0.2) * (gallons / 10000);
  const qt = roundUp(raw, 1);
  return {
    qt,
    calc: `(${ph} − ${RULES.phTarget}) ÷ 0.2 × ${fmt(gallons)}/10,000 = ${fix(raw)} → ${qt} qt`,
  };
}

export function saltDose(salt: number, gallons: number) {
  const raw = ((RULES.saltTarget - salt) / RULES.saltPpmPerBag) * (gallons / 10000);
  const bags = roundUp(raw, 1);
  return {
    bags,
    cost: bags * RULES.saltBagPrice,
    calc: `(${fmt(RULES.saltTarget)} − ${fmt(salt)}) ÷ ${RULES.saltPpmPerBag} × ${fmt(gallons)}/10,000 = ${fix(raw)} → ${bags} bags × $${RULES.saltBagPrice} = $${bags * RULES.saltBagPrice}`,
  };
}

// ---------- Per-pool analysis ----------

const URGENCY: Record<RevisitReason, number> = { green: 3, cloudy: 2, lowFC: 2, makeup: 1 };

function analyzePool(
  pool: Pool,
  reading: Reading | null,
  todayAbbr: string,
  classify: (note: string) => NoteClass
): PoolResult {
  const findings: Finding[] = [];
  const onRouteToday = pool.serviceDay === todayAbbr;
  const nextLabel = onRouteToday ? `${pool.serviceDay}, today's route` : pool.serviceDay;

  const base: PoolResult = {
    pool,
    reading,
    status: "OK",
    findings,
    doses: null,
    doseWhen: nextLabel,
    revisit: null,
    unsafe: false,
    makeup: false,
    dataFlag: false,
    onRouteToday,
    equipmentNote: null,
    noteClass: null,
    cyaHigh: null,
  };

  const gallons = pool.gallons;
  const gallonsBad = gallons == null || gallons < RULES.gallonsMin || gallons > RULES.gallonsMax;
  if (gallonsBad) {
    findings.push({
      kind: "data",
      status: "Data flag",
      text: `Gallons ${gallons != null ? fmt(gallons) : pool.gallonsRaw || "missing"} outside ${fmt(RULES.gallonsMin)}–${fmt(RULES.gallonsMax)} → data flag, no doses computed`,
    });
  }

  if (!reading) {
    findings.push({
      kind: "data",
      status: "Data flag",
      text: "No reading logged last week → data flag, check with the tech",
    });
    return finish(base, true);
  }

  // Make-up visit: the tech couldn't service the pool.
  if (isNoService(reading.note)) {
    findings.push({
      kind: "makeup",
      status: "Revisit today",
      text: `No service ${shortDate(reading.date)} ("${reading.note}") → make-up visit today`,
    });
    base.makeup = true;
    base.revisit = { reason: "makeup", urgency: URGENCY.makeup, label: "Make-up visit" };
    base.doseWhen = "today (test on site)";
    return finish(base, gallonsBad);
  }

  const { fc, ph, alk, cya, salt, water } = reading;

  // Bad data
  if (ph == null) {
    findings.push({ kind: "data", status: "Data flag", text: "pH not recorded → retest at next visit, no doses computed" });
  } else if (ph < RULES.phValidMin || ph > RULES.phValidMax) {
    findings.push({
      kind: "data",
      status: "Data flag",
      text: `pH ${ph} outside ${RULES.phValidMin.toFixed(1)}–${RULES.phValidMax.toFixed(1)} → likely typo, retest at next visit, no doses computed`,
    });
  }
  if (fc == null) {
    findings.push({ kind: "data", status: "Data flag", text: "FC not recorded → retest at next visit, no doses computed" });
  }
  const dataFlag = findings.some((f) => f.kind === "data");
  const canDose = !dataFlag && gallons != null;

  // Safety → revisit today
  const green = water === "green";
  const cloudy = water === "cloudy";
  const lowFC = fc != null && fc < RULES.fcUnsafe;
  if (lowFC) {
    findings.push({
      kind: "unsafe",
      status: "Revisit today",
      text: `FC ${fc} < ${RULES.fcUnsafe.toFixed(1)} → revisit today, unsafe to swim`,
    });
  }
  if (green || cloudy) {
    findings.push({
      kind: "unsafe",
      status: "Revisit today",
      text: `Water ${water} → revisit today, unsafe to swim`,
    });
  }
  if (water && !["clear", "green", "cloudy"].includes(water)) {
    findings.push({ kind: "note", status: "Dose at next visit", text: `Water logged as "${water}" → check at next visit` });
  }

  const unsafe = lowFC || green || cloudy;
  if (unsafe) {
    const reason: RevisitReason = green ? "green" : cloudy ? "cloudy" : "lowFC";
    const label = green ? "Green water" : cloudy ? "Cloudy water" : `Low FC (${fc})`;
    base.revisit = { reason, urgency: URGENCY[reason], label };
  }
  const revisit = base.revisit != null;
  const when = revisit ? "today" : `at next visit (${nextLabel})`;
  const doseStatus: Status = revisit ? "Revisit today" : "Dose at next visit";
  base.doseWhen = revisit ? "today" : nextLabel;
  const doses: Doses = { chlorineGal: 0, acidQt: 0, saltBags: 0, saltCost: 0 };

  // Chlorine
  if (fc != null && (fc < RULES.fcMin || green)) {
    const target = green ? RULES.fcShock : RULES.fcTarget;
    const why = green ? `Water green → shock to ${target} ppm` : `FC ${fc} < ${RULES.fcMin.toFixed(1)} → raise to ${target} ppm`;
    if (canDose) {
      const d = chlorineDose(fc, target, gallons);
      doses.chlorineGal = d.gal;
      findings.push({ kind: "chlorine", status: doseStatus, text: `${why}: ${d.gal.toFixed(1)} gal chlorine ${when}`, calc: d.calc });
    } else {
      findings.push({ kind: "chlorine", status: doseStatus, text: `${why}, but no dose computed (data flag)` });
    }
  } else if (fc != null && fc > RULES.fcMax) {
    findings.push({ kind: "note", status: "Dose at next visit", text: `FC ${fc} > ${RULES.fcMax} → note for next visit, no Monday dose` });
  }

  // pH / acid
  const phValid = ph != null && ph >= RULES.phValidMin && ph <= RULES.phValidMax;
  if (phValid && ph > RULES.phActHigh) {
    const why = `pH ${ph} > ${RULES.phActHigh} → bring to ${RULES.phTarget}`;
    if (canDose) {
      const d = acidDose(ph, gallons);
      doses.acidQt = d.qt;
      findings.push({ kind: "acid", status: doseStatus, text: `${why}: ${d.qt} qt acid ${when}`, calc: d.calc });
    } else {
      findings.push({ kind: "acid", status: doseStatus, text: `${why}, but no dose computed (data flag)` });
    }
  } else if (phValid && ph < RULES.phActLow) {
    findings.push({ kind: "note", status: "Dose at next visit", text: `pH ${ph} < ${RULES.phActLow} → raise at next visit, no Monday dose` });
  }

  // Alkalinity
  if (alk != null && (alk < RULES.alkMin || alk > RULES.alkMax)) {
    findings.push({
      kind: "note",
      status: "Dose at next visit",
      text: `Alkalinity ${alk} outside ${RULES.alkMin}–${RULES.alkMax} → note for next visit, no Monday dose`,
    });
  }

  // CYA
  if (cya != null && cya > RULES.cyaDrain) {
    base.cyaHigh = cya;
    findings.push({
      kind: "cya",
      status: "Tomás",
      text: `CYA ${cya} > ${RULES.cyaDrain} → partial drain/refill, $${RULES.drainCost}, needs customer OK (text asks)`,
    });
  } else if (cya != null && (cya < RULES.cyaMin || cya > RULES.cyaMax)) {
    findings.push({
      kind: "note",
      status: "Dose at next visit",
      text: `CYA ${cya} outside ${RULES.cyaMin}–${RULES.cyaMax} → note for next visit, no Monday dose`,
    });
  }

  // Salt (saltwater pools only)
  if (pool.type === "salt") {
    if (salt == null) {
      findings.push({ kind: "note", status: "Dose at next visit", text: "Salt not recorded → retest at next visit" });
    } else if (salt < RULES.saltDoseBelow) {
      const why = `Salt ${fmt(salt)} < ${fmt(RULES.saltDoseBelow)} → bring to ${fmt(RULES.saltTarget)}`;
      if (canDose) {
        const d = saltDose(salt, gallons);
        doses.saltBags = d.bags;
        doses.saltCost = d.cost;
        findings.push({ kind: "salt", status: doseStatus, text: `${why}: ${d.bags} bags ${when}, bill $${d.cost}`, calc: d.calc });
      } else {
        findings.push({ kind: "salt", status: doseStatus, text: `${why}, but no dose computed (data flag)` });
      }
    } else if (salt < RULES.saltMin) {
      findings.push({
        kind: "info",
        status: null,
        text: `Salt ${fmt(salt)} between ${fmt(RULES.saltDoseBelow)}–${fmt(RULES.saltMin)} → watch, no dose`,
      });
    } else if (salt > RULES.saltMax) {
      findings.push({ kind: "note", status: "Dose at next visit", text: `Salt ${fmt(salt)} > ${fmt(RULES.saltMax)} → note for next visit, no Monday dose` });
    }
  }

  // Tech note
  if (reading.note.trim()) {
    const cls = classify(reading.note);
    base.noteClass = cls;
    if (cls === "equipment") {
      base.equipmentNote = reading.note;
      findings.push({ kind: "equipment", status: "Tomás", text: `Note "${reading.note}" → equipment problem, Tomás to quote repair` });
    } else if (cls === "chemistry") {
      findings.push({ kind: "info", status: null, text: `Note "${reading.note}" → chemistry warning, not equipment` });
    }
  }

  if (canDose) base.doses = doses;
  base.unsafe = unsafe;
  return finish(base, dataFlag || gallonsBad);
}

function finish(r: PoolResult, dataFlag: boolean): PoolResult {
  r.dataFlag = dataFlag;
  if (dataFlag) r.doses = null;
  r.status = STATUS_ORDER.find((s) => r.findings.some((f) => f.status === s)) ?? "OK";
  return r;
}

// ---------- Capacity ----------

function assignStops(results: PoolResult[], techs: string[], warnings: string[]): Stop[] {
  type Working = Stop & { fc: number | null };
  const stops: Working[] = results
    .filter((r) => r.revisit && !r.onRouteToday)
    .map((r) => ({
      poolId: r.pool.id,
      customer: r.pool.customer,
      area: r.pool.area,
      ownTech: r.pool.tech,
      assignedTech: r.pool.tech,
      reassigned: false,
      reason: r.revisit!.reason,
      label: r.revisit!.label,
      urgency: r.revisit!.urgency,
      doses: r.doses,
      overCapacity: false,
      fc: r.reading?.fc ?? null,
    }));

  const count = (t: string) => stops.filter((s) => s.assignedTech === t).length;
  // Least urgent first: make-ups, then cloudy/low FC (higher FC = less urgent), green last.
  const lessUrgent = (a: Working, b: Working) =>
    a.urgency - b.urgency || (b.fc ?? -1) - (a.fc ?? -1) || b.poolId.localeCompare(a.poolId);

  for (let guard = 0; guard < 100; guard++) {
    const over = techs.find((t) => count(t) > RULES.maxExtraStops);
    if (!over) break;
    const target = techs
      .filter((t) => t !== over)
      .sort((a, b) => count(a) - count(b) || techs.indexOf(a) - techs.indexOf(b))[0];
    const mine = stops.filter((s) => s.assignedTech === over).sort(lessUrgent);
    if (!target || count(target) >= RULES.maxExtraStops) {
      // Everyone is full. Every revisit still happens Monday, so keep it and flag it.
      mine.slice(RULES.maxExtraStops).forEach((s) => (s.overCapacity = true));
      warnings.push(`All techs are at ${RULES.maxExtraStops} extra stops. ${over} is over capacity.`);
      break;
    }
    const move = mine[0];
    move.assignedTech = target;
    move.reassigned = move.assignedTech !== move.ownTech;
  }

  return stops
    .map(({ fc, ...s }): Stop => (void fc, s))
    .sort((a, b) => b.urgency - a.urgency || a.poolId.localeCompare(b.poolId));
}

const emptyLoad = (): Load => ({ chlorineGal: 0, acidQt: 0, saltBags: 0 });
function addLoad(l: Load, d: Doses | null) {
  if (!d) return;
  l.chlorineGal += d.chlorineGal;
  l.acidQt += d.acidQt;
  l.saltBags += d.saltBags;
}

// ---------- Main ----------

export function analyze(
  pools: Pool[],
  readings: Reading[],
  classify: (note: string) => NoteClass = classifyByKeywords
): Analysis {
  const warnings: string[] = [];

  // "Last week" = the Mon–Fri week of the newest reading. Today = the next Monday.
  const dates = readings.map((r) => r.date).sort();
  const latest = dates.length ? toDate(dates[dates.length - 1]) : mondayOf(new Date());
  const weekStart = mondayOf(latest);
  const weekEnd = addDays(weekStart, 6);
  const today = addDays(weekStart, 7);
  const todayISO = toISO(today);
  const todayAbbr = dayAbbr(todayISO);
  const ws = toISO(weekStart);
  const we = toISO(weekEnd);

  const latestByPool = new Map<string, Reading>();
  for (const r of readings) {
    if (r.date < ws || r.date > we) continue;
    const prev = latestByPool.get(r.poolId);
    if (!prev || r.date >= prev.date) latestByPool.set(r.poolId, r);
  }
  const poolIds = new Set(pools.map((p) => p.id));
  const unknown = [...new Set(readings.map((r) => r.poolId).filter((id) => !poolIds.has(id)))];
  if (unknown.length) warnings.push(`Readings for unknown pools ignored: ${unknown.join(", ")}`);
  const older = readings.filter((r) => r.date < ws).length;
  if (older) warnings.push(`${older} reading(s) older than last week ignored.`);

  const results = pools.map((p) => analyzePool(p, latestByPool.get(p.id) ?? null, todayAbbr, classify));

  const techs = [...new Set(pools.map((p) => p.tech).filter(Boolean))];
  const stops = assignStops(results, techs, warnings);

  const plans: TechPlan[] = techs.map((tech) => {
    const mine = stops.filter((s) => s.assignedTech === tech);
    const handedOff = stops.filter((s) => s.ownTech === tech && s.assignedTech !== tech);
    const routeDoses = results
      .filter((r) => r.pool.tech === tech && r.onRouteToday && r.doses)
      .filter((r) => r.doses!.chlorineGal + r.doses!.acidQt + r.doses!.saltBags > 0)
      .map((r) => ({ poolId: r.pool.id, customer: r.pool.customer, doses: r.doses! }));
    const extra = emptyLoad();
    mine.forEach((s) => addLoad(extra, s.doses));
    const route = emptyLoad();
    routeDoses.forEach((r) => addLoad(route, r.doses));
    const total = emptyLoad();
    addLoad(total, { ...extra, saltCost: 0 });
    addLoad(total, { ...route, saltCost: 0 });
    return { tech, stops: mine, handedOff, routeDoses, load: { extra, route, total } };
  });

  // Billing
  const saltBags = results.reduce((n, r) => n + (r.doses?.saltBags ?? 0), 0);
  const drains = results.filter((r) => r.cyaHigh != null).length;
  const billing = {
    saltBags,
    saltDollars: saltBags * RULES.saltBagPrice,
    drains,
    drainDollars: drains * RULES.drainCost,
    total: saltBags * RULES.saltBagPrice + drains * RULES.drainCost,
  };

  const tomas = {
    equipment: results
      .filter((r) => r.equipmentNote)
      .map((r) => ({
        poolId: r.pool.id,
        customer: r.pool.customer,
        tech: r.pool.tech,
        note: r.equipmentNote!,
        date: r.reading!.date,
      })),
    cya: results
      .filter((r) => r.cyaHigh != null)
      .map((r) => ({
        poolId: r.pool.id,
        customer: r.pool.customer,
        cya: r.cyaHigh!,
        cost: RULES.drainCost,
        language: r.pool.language,
      })),
  };

  const textJobs = buildTextJobs(results, stops, todayISO);

  return {
    todayISO,
    todayAbbr,
    weekStartISO: ws,
    weekEndISO: toISO(addDays(weekStart, 4)),
    techs,
    pools: results,
    plans,
    unsafe: results.filter((r) => r.unsafe),
    billing,
    tomas,
    textJobs,
    warnings,
  };
}

// ---------- Customer text facts ----------

function longDate(iso: string): string {
  return toDate(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function buildTextJobs(results: PoolResult[], stops: Stop[], todayISO: string): TextJob[] {
  const jobs: TextJob[] = [];
  for (const r of results) {
    const kinds: TextKind[] = [];
    if (r.unsafe) kinds.push("unsafe");
    if (r.makeup) kinds.push("makeup");
    if (r.cyaHigh != null) kinds.push("cya");
    if (!kinds.length) continue;

    const stop = stops.find((s) => s.poolId === r.pool.id);
    const tech = stop?.assignedTech ?? r.pool.tech;
    const visit = r.reading?.date ?? null;
    const facts: string[] = [];
    const allowedDollars: number[] = [];

    if (kinds.includes("unsafe") && r.reading) {
      const problems: string[] = [];
      const fc = r.reading.fc;
      if (fc != null && fc < RULES.fcUnsafe) problems.push(`free chlorine at ${fc} ppm (the safe minimum is 1.0)`);
      if (r.reading.water === "green" || r.reading.water === "cloudy") problems.push(`${r.reading.water} water`);
      facts.push(`Our water test on ${longDate(r.reading.date)} found ${problems.join(" and ")}.`);
      facts.push("The pool is not safe to swim in until we treat it. Please keep everyone out of it.");
      facts.push(`Our technician ${tech} will come today, ${longDate(todayISO)}, to treat the water.`);
    }
    if (kinds.includes("makeup")) {
      facts.push(`We will be at the home today, ${longDate(todayISO)}, to service the pool.`);
    }
    if (kinds.includes("cya") && r.cyaHigh != null) {
      facts.push(
        `Stabilizer (cyanuric acid) tested ${r.cyaHigh} ppm${visit ? ` on ${longDate(visit)}` : ""}. The healthy range is 30–80 ppm; above 100 it keeps chlorine from working well.`
      );
      facts.push(`The fix is a partial drain and refill. It costs $${RULES.drainCost}.`);
      facts.push("We will only do it with the customer's OK. Ask them to reply YES to approve.");
      allowedDollars.push(RULES.drainCost);
    }

    jobs.push({
      id: `${r.pool.id}:${kinds.join("+")}`,
      poolId: r.pool.id,
      to: r.pool.customer,
      firstName: r.pool.customer.split(" ")[0],
      language: r.pool.language,
      kinds,
      facts,
      data: {
        visitDate: visit,
        todayISO,
        tech,
        fc: r.reading?.fc ?? null,
        water: r.reading?.water ?? null,
        cya: r.cyaHigh,
        drainCost: RULES.drainCost,
      },
      allowedDollars,
    });
  }
  return jobs;
}
