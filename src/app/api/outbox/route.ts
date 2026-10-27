// Posts customer texts that Tomás approved to the "Royal Palm – Customer Outbox"
// GroupMe group. Only runs when the page sends an explicit, tapped request.

const GROUPME_URL = "https://api.groupme.com/v3/bots/post";
const LIMIT = 1000;
const MAX_ITEMS = 25;
const DELAY_MS = 1200;

type Item = { id: string; to: string; language: "en" | "es"; poolId: string; text: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LANG = { en: "English", es: "Spanish" } as const;

function format(i: Item): string {
  return `To: ${i.to} (${LANG[i.language]}) · ${i.poolId}\n\n${i.text}`;
}

function valid(v: unknown): v is Item[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.length <= MAX_ITEMS &&
    v.every(
      (i) =>
        i &&
        typeof i.id === "string" &&
        /^[\w:+-]{1,60}$/.test(i.id) &&
        typeof i.to === "string" &&
        i.to.trim() !== "" &&
        i.to.length <= 80 &&
        (i.language === "en" || i.language === "es") &&
        typeof i.poolId === "string" &&
        /^[A-Za-z0-9-]{1,12}$/.test(i.poolId) &&
        typeof i.text === "string" &&
        i.text.trim() !== "" &&
        format(i).length <= LIMIT
    )
  );
}

export async function POST(req: Request) {
  const botId = process.env.GROUPME_BOT_OUTBOX;
  if (!botId) {
    return Response.json(
      { error: "Customer Outbox isn't set up. Run node scripts/setup-groupme.mjs and restart.", results: [] },
      { status: 503 }
    );
  }

  let items: unknown;
  try {
    ({ items } = await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON", results: [] }, { status: 400 });
  }
  if (!valid(items)) return Response.json({ error: "Invalid texts.", results: [] }, { status: 400 });

  const results: { id: string; sent: boolean }[] = [];
  for (const [n, item] of items.entries()) {
    if (n > 0) await sleep(DELAY_MS);
    let ok = false;
    try {
      const res = await fetch(GROUPME_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_id: botId, text: format(item) }),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    results.push({ id: item.id, sent: ok });
    if (!ok) {
      // Stop so a GroupMe outage doesn't half-send a batch silently.
      return Response.json({ error: `GroupMe didn't accept the text to ${item.to}. Stopped there.`, results }, { status: 502 });
    }
  }
  return Response.json({ results });
}
