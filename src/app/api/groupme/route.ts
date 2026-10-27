// Posts the Monday plan to GroupMe: Team first, then each person's group.
// Bot IDs come from .env.local (GROUPME_BOT_TEAM, GROUPME_BOT_<TECH>, GROUPME_BOT_TOMAS)
// and never leave the server.

const GROUPME_URL = "https://api.groupme.com/v3/bots/post";
const LIMIT = 1000;
const MAX_MESSAGES = 30;
const DELAY_MS = 1200;

type Batch = { target: string; messages: string[] };
type Result = { target: string; sent: number; total: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const envKey = (target: string) => `GROUPME_BOT_${target.toUpperCase()}`;

function isBatchList(v: unknown): v is Batch[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (b) =>
        b &&
        typeof b.target === "string" &&
        /^[a-z0-9]{1,30}$/.test(b.target) &&
        Array.isArray(b.messages) &&
        b.messages.length > 0 &&
        b.messages.every((m: unknown) => typeof m === "string" && m.trim() !== "" && m.length <= LIMIT)
    )
  );
}

export async function POST(req: Request) {
  let batches: unknown;
  try {
    ({ batches } = await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON", results: [] }, { status: 400 });
  }
  if (!isBatchList(batches) || batches.reduce((n, b) => n + b.messages.length, 0) > MAX_MESSAGES) {
    return Response.json({ error: "Invalid message batches.", results: [] }, { status: 400 });
  }

  // Team goes first no matter what order arrived.
  const ordered = [...batches].sort((a, b) => Number(b.target === "team") - Number(a.target === "team"));

  // Check every bot before posting anything, so no group gets a half plan.
  const missing = ordered.map((b) => envKey(b.target)).filter((k) => !process.env[k]);
  if (missing.length) {
    return Response.json(
      { error: `GroupMe isn't set up for: ${missing.join(", ")}. Run node scripts/setup-groupme.mjs and restart.`, results: [] },
      { status: 503 }
    );
  }

  const results: Result[] = [];
  let first = true;
  for (const b of ordered) {
    const botId = process.env[envKey(b.target)]!;
    const r: Result = { target: b.target, sent: 0, total: b.messages.length };
    results.push(r);
    for (const text of b.messages) {
      if (!first) await sleep(DELAY_MS);
      first = false;
      try {
        const res = await fetch(GROUPME_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bot_id: botId, text }),
        });
        if (!res.ok) {
          return Response.json(
            { error: `GroupMe rejected a message for ${b.target} (HTTP ${res.status}). Stopped there.`, results },
            { status: 502 }
          );
        }
        r.sent++;
      } catch {
        return Response.json({ error: `Couldn't reach GroupMe while sending to ${b.target}. Stopped there.`, results }, { status: 502 });
      }
    }
  }
  return Response.json({ results });
}
