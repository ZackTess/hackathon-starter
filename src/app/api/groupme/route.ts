// Posts the Monday plan to GroupMe. The bot ID stays on the server.

const GROUPME_URL = "https://api.groupme.com/v3/bots/post";
const LIMIT = 1000;
const MAX_MESSAGES = 12;
const DELAY_MS = 1200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: Request) {
  const botId = process.env.GROUPME_BOT_ID;
  if (!botId) {
    return Response.json(
      { error: "GroupMe bot isn't set up. Add GROUPME_BOT_ID to .env.local and restart.", sent: 0 },
      { status: 503 }
    );
  }

  let messages: unknown;
  try {
    ({ messages } = await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON", sent: 0 }, { status: 400 });
  }
  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > MAX_MESSAGES ||
    !messages.every((m) => typeof m === "string" && m.trim() && m.length <= LIMIT)
  ) {
    return Response.json(
      { error: `Send 1–${MAX_MESSAGES} non-empty messages of at most ${LIMIT} characters.`, sent: 0 },
      { status: 400 }
    );
  }

  // Send one at a time, in order, with a pause so GroupMe keeps the order.
  let sent = 0;
  for (const text of messages as string[]) {
    if (sent > 0) await sleep(DELAY_MS);
    try {
      const res = await fetch(GROUPME_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_id: botId, text }),
      });
      if (!res.ok) {
        return Response.json(
          { error: `GroupMe rejected message ${sent + 1} (HTTP ${res.status}).`, sent },
          { status: 502 }
        );
      }
      sent++;
    } catch {
      return Response.json({ error: `Couldn't reach GroupMe on message ${sent + 1}.`, sent }, { status: 502 });
    }
  }
  return Response.json({ sent });
}
