// Live sync: pull both Google Sheets, rerun the rules, and alert GroupMe about
// pools that newly need a revisit, Tomás, or a data-flag retest.
// The first sync is a baseline (no alerts). Each pool+issue is alerted once,
// tracked in .data/live-state.json.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyze, parsePools, parseReadings, type Status } from "@/lib/rules";
import { classifyByKeywords, fixedClass } from "@/lib/notes";
import { nextAction, taskTech } from "@/lib/nextAction";
import { techSlug } from "@/lib/groupme";

const STATE_FILE = process.env.LIVE_STATE_FILE || path.join(process.cwd(), ".data", "live-state.json");
const ALERT_STATUSES: Status[] = ["Revisit today", "Tomás", "Data flag"];
const GROUPME_URL = "https://api.groupme.com/v3/bots/post";
const FETCH_TIMEOUT_MS = 10000;
const POST_DELAY_MS = 1200;

type State = { baseline: boolean; alerted: Record<string, string> };
export type LiveAlert = {
  poolId: string;
  customer: string;
  status: Status;
  tech: string;
  action: string;
  reason: string;
  posted: { tech: boolean; tomas: boolean };
};

/** Accepts an edit/share link or a direct CSV URL; returns a CSV URL. */
function csvUrl(link: string): string {
  const m = link.match(/\/spreadsheets\/d\/([\w-]+)/);
  if (!m) return link;
  const gid = link.match(/[#&?]gid=(\d+)/)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv&gid=${gid}`;
}

async function fetchCsv(link: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(csvUrl(link), { cache: "no-store", signal: ctrl.signal, redirect: "follow" });
    const text = await res.text();
    if (!res.ok || /^\s*</.test(text)) throw new Error(`HTTP ${res.status}`);
    return text;
  } finally {
    clearTimeout(t);
  }
}

async function loadState(): Promise<State> {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    return { baseline: false, alerted: {} };
  }
}

async function saveState(s: State) {
  await mkdir(path.dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(s, null, 2));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post(target: string, text: string): Promise<boolean> {
  const botId = process.env[`GROUPME_BOT_${target.toUpperCase()}`];
  if (!botId) return false;
  try {
    const res = await fetch(GROUPME_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bot_id: botId, text: text.slice(0, 1000) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// One sync at a time, so two open tabs can't double-alert.
let queue: Promise<unknown> = Promise.resolve();

export async function POST() {
  const run = queue.then(sync, sync);
  queue = run.catch(() => {});
  return run;
}

async function sync(): Promise<Response> {
  const poolsLink = process.env.SHEET_POOLS_URL;
  const readingsLink = process.env.SHEET_READINGS_URL;
  if (!poolsLink || !readingsLink) {
    return Response.json({ error: "Add SHEET_POOLS_URL and SHEET_READINGS_URL to .env.local." }, { status: 503 });
  }

  let poolsCsv: string, readingsCsv: string;
  try {
    [poolsCsv, readingsCsv] = await Promise.all([fetchCsv(poolsLink), fetchCsv(readingsLink)]);
  } catch (e) {
    return Response.json({ error: `Couldn't read the Google Sheets (${e instanceof Error ? e.message : "error"}).` }, { status: 502 });
  }

  const p = parsePools(poolsCsv);
  const r = parseReadings(readingsCsv);
  if (p.error || r.error) return Response.json({ error: p.error || r.error }, { status: 422 });

  // Server-side note sorting: playbook rules, then keywords (no AI needed for alerts).
  const a = analyze(p.pools, r.readings, (note) => fixedClass(note) ?? classifyByKeywords(note));

  const state = await loadState();
  const current = a.pools.filter((x) => ALERT_STATUSES.includes(x.status));
  const alerts: LiveAlert[] = [];
  const syncedAt = Date.now();

  if (!state.baseline) {
    // First sync: remember what's already known, alert nothing.
    for (const x of current) state.alerted[`${x.pool.id}|${x.status}`] = new Date(syncedAt).toISOString();
    state.baseline = true;
    await saveState(state);
    return Response.json({ syncedAt, pools: poolsCsv, readings: readingsCsv, alerts, baseline: true });
  }

  let first = true;
  for (const x of current) {
    const key = `${x.pool.id}|${x.status}`;
    if (state.alerted[key]) continue;

    const tech = taskTech(x, a);
    const action = nextAction(x, a);
    const reason = x.findings.find((f) => f.status === x.status)?.text ?? x.status;
    const techMsg = `🔔 New: ${x.pool.id} ${x.pool.customer} · ${x.status}\n${action}\nWhy: ${reason}`;
    const tomasMsg = `🔔 ${x.pool.id} ${x.pool.customer} (${tech}): ${x.status}. ${reason}`;

    if (!first) await sleep(POST_DELAY_MS);
    first = false;
    const techOk = await post(techSlug(tech), techMsg);
    await sleep(POST_DELAY_MS);
    const tomasOk = await post("tomas", tomasMsg);

    // Alert once per pool+issue, even if a post failed (the toast says so), so nothing repeats every minute.
    state.alerted[key] = new Date().toISOString();
    alerts.push({
      poolId: x.pool.id,
      customer: x.pool.customer,
      status: x.status,
      tech,
      action,
      reason,
      posted: { tech: techOk, tomas: tomasOk },
    });
  }
  if (alerts.length) await saveState(state);

  return Response.json({ syncedAt, pools: poolsCsv, readings: readingsCsv, alerts, baseline: false });
}
