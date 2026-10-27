// Template customer texts (used when Gemini is off or a draft fails checks),
// plus the checks every Gemini draft must pass before we show it.

import type { TextJob } from "./rules";

export const SIGNATURE = "Royal Palm Pool Service";

const ES_DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const ES_MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const EN_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function d(iso: string) {
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
const en = (iso: string) => {
  const x = d(iso);
  return `${EN_DAYS[x.getUTCDay()]}, ${EN_MONTHS[x.getUTCMonth()]} ${x.getUTCDate()}`;
};
const es = (iso: string) => {
  const x = d(iso);
  return `${ES_DAYS[x.getUTCDay()]} ${x.getUTCDate()} de ${ES_MONTHS[x.getUTCMonth()]}`;
};

export function templateText(job: TextJob): string {
  const { data, kinds, firstName } = job;
  const parts: string[] = [];
  const unsafeProblems = (lang: "en" | "es") => {
    const p: string[] = [];
    if (data.fc != null && data.fc < 1)
      p.push(lang === "en" ? `chlorine at ${data.fc} ppm (the safe minimum is 1.0)` : `el cloro en ${data.fc} ppm (el mínimo seguro es 1.0)`);
    if (data.water === "green") p.push(lang === "en" ? "green water" : "agua verde");
    if (data.water === "cloudy") p.push(lang === "en" ? "cloudy water" : "agua turbia");
    return p.join(lang === "en" ? " and " : " y ");
  };

  if (job.language === "es") {
    parts.push(`Hola ${firstName},`);
    if (kinds.includes("unsafe") && data.visitDate) {
      parts.push(
        `en la prueba del agua del ${es(data.visitDate)} encontramos ${unsafeProblems("es")}. Por ahora la piscina no es segura para nadar; por favor, que nadie se meta. ${data.tech} pasará hoy, ${es(data.todayISO)}, para tratar el agua.`
      );
    }
    if (kinds.includes("makeup")) {
      parts.push(`pasaremos hoy, ${es(data.todayISO)}, para darle servicio a su piscina.`);
    }
    if (kinds.includes("cya") && data.cya != null) {
      parts.push(
        `${kinds.length > 1 ? "Además, el" : "el"} estabilizador (ácido cianúrico) está en ${data.cya} ppm; lo ideal es 30–80. Tan alto, el cloro no funciona bien. La solución es vaciar parte de la piscina y volver a llenarla, por $${data.drainCost}. ¿Nos da su aprobación? Responda SÍ y lo programamos. No lo haremos sin su OK.`
      );
    }
  } else {
    parts.push(`Hi ${firstName},`);
    if (kinds.includes("unsafe") && data.visitDate) {
      parts.push(
        `our water test on ${en(data.visitDate)} found ${unsafeProblems("en")}. The pool isn't safe to swim in yet, so please keep everyone out. ${data.tech} will be there today, ${en(data.todayISO)}, to treat the water.`
      );
    }
    if (kinds.includes("makeup")) {
      parts.push(`we'll be there today, ${en(data.todayISO)}, to service your pool.`);
    }
    if (kinds.includes("cya") && data.cya != null) {
      parts.push(
        `${kinds.length > 1 ? "Also, your" : "your"} stabilizer (CYA) tested ${data.cya} ppm; the healthy range is 30–80. That high, chlorine can't do its job well. The fix is a partial drain and refill for $${data.drainCost}. Can we go ahead? Reply YES to approve. We won't do it without your OK.`
      );
    }
  }

  // Greeting on its own line, then the body as a normal sentence.
  const [greet, ...rest] = parts;
  const body = rest.join(" ");
  return `${greet}\n${body.charAt(0).toUpperCase()}${body.slice(1)}\n— ${SIGNATURE}`;
}

const MISS_REASON =
  /\b(dog|perro|gate|port[oó]n|reja|padlock|candado|locked|cerrad[oa]|missed|could ?n[o']t|couldn't|unable|no pudimos|no se pudo|faltamos|perdimos)\b/i;
const BLAME = /\b(your fault|you (didn't|did not|forgot|failed|should have)|su culpa|usted no|olvidó|debió)\b/i;
const REPAIR_PRICE = /\b(repair|reparaci[oó]n)\b[^.]*\$\s?\d/i;

/** Returns why a draft is unsafe to show, or null if it passes. */
export function checkDraft(job: TextJob, text: string): string | null {
  if (!text || text.length < 20) return "empty draft";
  if (text.length > 700) return "too long";
  if (!text.includes(SIGNATURE)) return "missing signature";
  const dollars = [...text.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
  if (dollars.some((n) => !job.allowedDollars.includes(n))) return "mentions a price we didn't give it";
  // Required facts: an approval text must state the price, and revisit texts must say today.
  if (job.allowedDollars.some((n) => !dollars.includes(n))) return "leaves out the price";
  if ((job.kinds.includes("unsafe") || job.kinds.includes("makeup")) && !/\b(today|hoy)\b/i.test(text)) return "doesn't say we're coming today";
  if (job.kinds.includes("cya") && !/\b(yes|s[ií]|ok|okay|aprob|approv|autoriz)/i.test(text)) return "doesn't ask for approval";
  if (job.kinds.includes("makeup") && MISS_REASON.test(text)) return "explains the missed visit";
  if (BLAME.test(text)) return "blames the customer";
  if (REPAIR_PRICE.test(text)) return "quotes a repair price";
  if (job.language === "es" && !/\b(hola|hoy|piscina|usted|su)\b/i.test(text)) return "not in Spanish";
  if (job.language === "en" && !/\b(hi|hello|today|pool|your)\b/i.test(text)) return "not in English";
  return null;
}
