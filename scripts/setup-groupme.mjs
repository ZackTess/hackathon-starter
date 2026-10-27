#!/usr/bin/env node
// One-time GroupMe setup for Royal Palm Pool Service.
//
//   node scripts/setup-groupme.mjs          create what's missing, test new bots
//   node scripts/setup-groupme.mjs --test   also send the test message to every group
//
// Reads GROUPME_ACCESS_TOKEN from .env.local. The token is sent only in a
// request header, never in a URL, and is never printed. Safe to rerun: groups
// and bots that already exist (matched by name) are reused, not duplicated.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".env.local");
const API = "https://api.groupme.com/v3";
const BOT_NAME = "Royal Palm Bot";
const TEST_TEXT = "Royal Palm Bot connected ✓";
const FORCE_TEST = process.argv.includes("--test");

const TARGETS = [
  { group: "Royal Palm – Team", envKey: "GROUPME_BOT_TEAM" },
  { group: "Royal Palm – Jenny", envKey: "GROUPME_BOT_JENNY" },
  { group: "Royal Palm – Omar", envKey: "GROUPME_BOT_OMAR" },
  { group: "Royal Palm – Raúl", envKey: "GROUPME_BOT_RAUL" },
  { group: "Royal Palm – Tomás", envKey: "GROUPME_BOT_TOMAS" },
  { group: "Royal Palm – Customer Outbox", envKey: "GROUPME_BOT_OUTBOX" },
];

// ---------- .env.local ----------

function readEnv() {
  if (!existsSync(ENV_FILE)) return { text: "", vars: {} };
  const text = readFileSync(ENV_FILE, "utf8");
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return { text, vars };
}

/** Set KEY=value in .env.local, replacing an existing line or appending. */
function writeEnvVar(key, value) {
  const { text } = readEnv();
  const line = `${key}=${value}`;
  const re = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
  let next;
  if (re.test(text)) next = text.replace(re, line);
  else next = `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
  writeFileSync(ENV_FILE, next, { mode: 0o600 });
}

const mask = (id) => (id ? `…${String(id).slice(-4)}` : "?");

// ---------- GroupMe API ----------

const env = readEnv().vars;
const TOKEN = (process.env.GROUPME_ACCESS_TOKEN || env.GROUPME_ACCESS_TOKEN || "").trim();

if (!TOKEN) {
  console.error(
    "GROUPME_ACCESS_TOKEN is missing.\n" +
      "Get it at https://dev.groupme.com (top right, 'Access Token'), then add this line to .env.local:\n" +
      "  GROUPME_ACCESS_TOKEN=your-token\n" +
      "and run this script again."
  );
  process.exit(1);
}

/** Never let the token leak into error output. */
const scrub = (s) => String(s).split(TOKEN).join("[token]");

async function api(method, pathname, body) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: { "X-Access-Token": TOKEN, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  if (!res.ok) {
    const hint = res.status === 401 ? " (check GROUPME_ACCESS_TOKEN)" : "";
    throw new Error(scrub(`${method} ${pathname} failed: HTTP ${res.status}${hint} ${raw.slice(0, 200)}`));
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw).response ?? null;
  } catch {
    return null;
  }
}

async function listGroups() {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const batch = (await api("GET", `/groups?per_page=100&page=${page}&omit=memberships`)) ?? [];
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

async function listBots() {
  return (await api("GET", "/bots")) ?? [];
}

async function postAsBot(botId, text) {
  // The bot post endpoint needs no token; the bot ID is the credential.
  const res = await fetch(`${API}/bots/post`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bot_id: botId, text }),
  });
  if (!res.ok) throw new Error(`test message failed: HTTP ${res.status}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Main ----------

async function main() {
  const groups = await listGroups();
  const bots = await listBots();
  const summary = [];

  for (const t of TARGETS) {
    const row = { group: t.group, groupStatus: "", botStatus: "", envStatus: "", test: "" };

    // 1. Group
    let group = groups.find((g) => g.name === t.group);
    if (group) {
      row.groupStatus = "exists";
    } else {
      group = await api("POST", "/groups", { name: t.group, share: false });
      groups.push(group);
      row.groupStatus = "created";
    }

    // 2. Bot
    let bot = bots.find((b) => String(b.group_id) === String(group.id) && b.name === BOT_NAME);
    let newBot = false;
    if (bot) {
      row.botStatus = "exists";
    } else {
      const created = await api("POST", "/bots", { bot: { name: BOT_NAME, group_id: String(group.id) } });
      bot = created?.bot ?? created;
      if (!bot?.bot_id) throw new Error(`GroupMe didn't return a bot ID for "${t.group}".`);
      bots.push(bot);
      newBot = true;
      row.botStatus = "created";
    }

    // 3. .env.local
    const current = readEnv().vars[t.envKey];
    if (current === bot.bot_id) {
      row.envStatus = "already set";
    } else {
      writeEnvVar(t.envKey, bot.bot_id);
      row.envStatus = current ? "updated" : "written";
    }

    // 4. Test message (new bots, or everyone with --test)
    if (newBot || row.envStatus !== "already set" || FORCE_TEST) {
      await postAsBot(bot.bot_id, TEST_TEXT);
      row.test = "sent";
      await sleep(800);
    } else {
      row.test = "skipped (use --test)";
    }

    row.botId = mask(bot.bot_id);
    summary.push({ ...row, envKey: t.envKey });
    console.log(
      `${t.group}: group ${row.groupStatus}, bot ${row.botStatus} (${row.botId}), ${t.envKey} ${row.envStatus}, test ${row.test}`
    );
  }

  console.log(`\nDone. ${summary.length} groups ready. Bot IDs are in .env.local (not committed). Restart the app to load them.`);
}

main().catch((err) => {
  console.error(scrub(err instanceof Error ? err.message : err));
  process.exit(1);
});
