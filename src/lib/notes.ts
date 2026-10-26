// Tech-note classification. Gemini does this when available; these keyword
// rules are the fallback, and the "fixed" rules below always win over Gemini.

export type NoteClass = "equipment" | "chemistry" | "routine";

const ROUTINE =
  /^(cleaned|backwashed|rinsed|changed)( the)? (filter|filters|cartridge|cartridges)$|^skimmed( the)?( leaves| pool| surface)?$|^brushed( the)?( walls| steps| pool)?$|^emptied( the)?( skimmer| pump)? baskets?$|^vacuumed( the)?( pool)?$|^(added|topped off) water$/;

// A warning light about a chemical level (e.g. "Low salt light") is chemistry.
const CHEM_LIGHT =
  /\b(low|high|check)\s+(salt|chlorine|ph|stabilizer)\b.*\b(light|indicator|warning)\b/;

const EQUIPMENT =
  /\b(pump|filter|heater|salt cell|cell|leak|leaks|leaking|leaky|motor|valve|timer|breaker|chlorinator|seal|error code|grinding|broken|cracked|tripping)\b|\b(won['’]?t|will not|doesn['’]?t|does not|not) (turn on|turning on|start|starting|run|running|work|working|heat|heating|prime|priming)\b/;

const CHEMISTRY =
  /\b(stabilizer|cya|chlorine|ph|alkalinity|salt|algae|cloudy|green|calcium|scale)\b/;

function segments(note: string): string[] {
  return note
    .toLowerCase()
    .split(/[,.;]| and then /)
    .map((s) => s.trim())
    .filter(Boolean);
}

function classifySegment(seg: string): NoteClass {
  if (ROUTINE.test(seg)) return "routine";
  if (CHEM_LIGHT.test(seg) && !/\bcell\b/.test(seg)) return "chemistry";
  if (EQUIPMENT.test(seg)) return "equipment";
  if (CHEMISTRY.test(seg)) return "chemistry";
  return "routine";
}

/** Keyword fallback classifier. */
export function classifyByKeywords(note: string): NoteClass {
  const classes = segments(note).map(classifySegment);
  if (classes.includes("equipment")) return "equipment";
  if (classes.includes("chemistry")) return "chemistry";
  return "routine";
}

/**
 * Cases the playbook settles outright. These override Gemini:
 * a note made only of routine chores is routine, and a chemistry warning
 * light with no equipment problem is chemistry.
 */
export function fixedClass(note: string): NoteClass | null {
  const segs = segments(note);
  if (segs.length === 0) return "routine";
  if (segs.every((s) => ROUTINE.test(s))) return "routine";
  const classes = segs.map(classifySegment);
  if (
    segs.some((s) => CHEM_LIGHT.test(s) && !/\bcell\b/.test(s)) &&
    !classes.includes("equipment")
  ) {
    return "chemistry";
  }
  return null;
}

export function isNoService(note: string): boolean {
  return /\bno service\b|could ?n[o']t service|unable to service|skipped/i.test(
    note
  );
}

export function noteKey(note: string): string {
  return note.trim().toLowerCase().replace(/\s+/g, " ");
}
