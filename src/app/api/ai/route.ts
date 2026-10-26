import Anthropic from "@anthropic-ai/sdk";

// Change this to tell Claude what your app does.
const SYSTEM_PROMPT =
  "You are a helpful assistant. Answer clearly and keep it short.";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "No API key. Add ANTHROPIC_API_KEY to .env.local and restart." },
      { status: 500 }
    );
  }

  const { input } = await req.json();
  if (!input || typeof input !== "string") {
    return Response.json({ error: "Send { input: string }" }, { status: 400 });
  }

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: input }],
    });

    const text = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");

    return Response.json({ output: text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something broke";
    return Response.json({ error: message }, { status: 500 });
  }
}
