import { GoogleGenAI } from "@google/genai";

// Gemini does two jobs only: classify tech notes and draft customer texts.
// All doses, money, safety and capacity are computed in src/lib/rules.ts.

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const TIMEOUT_MS = 25000;

type ClassifyBody = { task: "classify"; notes: { id: string; note: string }[] };
type TextsBody = {
  task: "texts";
  jobs: { id: string; language: "en" | "es"; firstName: string; facts: string[]; kinds: string[] }[];
};

const CLASSIFY_PROMPT = `You sort pool technician notes for Royal Palm Pool Service.
For each note pick exactly one category:
- "equipment": a problem with a pump, filter, heater, salt cell, or a leak (anything broken, noisy, leaking, error codes, not turning on).
- "chemistry": a water-chemistry observation or a warning light about a chemical level. "Low salt light" is chemistry, NOT equipment.
- "routine": normal service work. "Cleaned filter", "Skimmed leaves", "Brushed walls, emptied baskets" are routine.
Return every id you were given.`;

const TEXTS_PROMPT = `You draft short SMS texts to pool-service customers for Royal Palm Pool Service.
Rules:
- Write in the language given: "es" = Spanish (Latin American, usted), "en" = English.
- Use ONLY the facts given. Do not add numbers, prices, times, or reasons that are not in the facts.
- Include EVERY fact given, especially any price (write it exactly, e.g. $175) and that we are coming today.
- Short and specific: what we found, what happens next, and when. 2–4 sentences.
- Never blame the customer. Never quote a repair price.
- For make-up visits, say we'll be there today. Never say or hint at why a visit was missed.
- Greet by first name. End with a new line containing exactly: — Royal Palm Pool Service`;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Gemini timed out")), TIMEOUT_MS)),
  ]);
}

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // No key: tell the page to use keywords and templates. Not an error.
    return Response.json({ fallback: true });
  }

  let body: ClassifyBody | TextsBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    if (body.task === "classify" && Array.isArray(body.notes)) {
      const res = await withTimeout(
        ai.models.generateContent({
          model: MODEL,
          contents: JSON.stringify(body.notes.slice(0, 200)),
          config: {
            systemInstruction: CLASSIFY_PROMPT,
            temperature: 0,
            responseMimeType: "application/json",
            responseJsonSchema: {
              type: "object",
              properties: {
                results: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      category: { type: "string", enum: ["equipment", "chemistry", "routine"] },
                    },
                    required: ["id", "category"],
                  },
                },
              },
              required: ["results"],
            },
          },
        })
      );
      const parsed = JSON.parse(res.text ?? "{}");
      return Response.json({ results: parsed.results ?? [], model: MODEL });
    }

    if (body.task === "texts" && Array.isArray(body.jobs)) {
      // One request per text, in parallel: total time ≈ the slowest single draft.
      // A text that fails is left out, and the page uses its template instead.
      const drafts = await Promise.allSettled(
        body.jobs.slice(0, 50).map(async (job) => {
          const res = await withTimeout(
            ai.models.generateContent({
              model: MODEL,
              contents: JSON.stringify(job),
              config: {
                systemInstruction: TEXTS_PROMPT,
                temperature: 0.3,
                responseMimeType: "application/json",
                responseJsonSchema: {
                  type: "object",
                  properties: { text: { type: "string" } },
                  required: ["text"],
                },
              },
            })
          );
          const parsed = JSON.parse(res.text ?? "{}");
          if (typeof parsed.text !== "string") throw new Error("no text");
          return { id: job.id, text: parsed.text as string };
        })
      );
      const texts = drafts.flatMap((d) => (d.status === "fulfilled" ? [d.value] : []));
      const failed = drafts.length - texts.length;
      if (failed) console.warn(`Gemini drafted ${texts.length}/${drafts.length} texts; the rest use templates.`);
      if (texts.length === 0) return Response.json({ fallback: true });
      return Response.json({ texts, model: MODEL });
    }

    return Response.json({ error: "Unknown task" }, { status: 400 });
  } catch (err) {
    // Any Gemini failure: log on the server, and let the page fall back quietly.
    console.warn("Gemini call failed, using fallback:", err instanceof Error ? err.message : err);
    return Response.json({ fallback: true });
  }
}
