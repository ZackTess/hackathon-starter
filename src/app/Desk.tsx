"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import {
  analyze,
  RULES,
  parsePools,
  parseReadings,
  shortDate,
  STATUS_ORDER,
  type Doses,
  type Load,
  type PoolResult,
  type Status,
  type TechPlan,
  type TextJob,
} from "@/lib/rules";
import { classifyByKeywords, fixedClass, isNoService, noteKey, type NoteClass } from "@/lib/notes";
import { checkDraft, templateText } from "@/lib/texts";
import { buildGroupMeMessages, GROUPME_LIMIT } from "@/lib/groupme";

type AiState = "loading" | "gemini" | "fallback";
type AiResult<T> = { key: string; ok: boolean; data: T };

const STATUS_STYLE: Record<Status, string> = {
  "Revisit today": "bg-red-600 text-white",
  "Tomás": "bg-amber-400 text-amber-950",
  "Data flag": "bg-slate-500 text-white",
  "Dose at next visit": "bg-sky-600 text-white",
  OK: "bg-emerald-600 text-white",
};

function Badge({ status }: { status: Status }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>
      {status}
    </span>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {sub && <p className="mt-0.5 text-sm text-neutral-500">{sub}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

const card = "rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900";

function doseList(d: Doses | null): string {
  if (!d) return "";
  const parts: string[] = [];
  if (d.chlorineGal) parts.push(`${d.chlorineGal.toFixed(1)} gal chlorine`);
  if (d.acidQt) parts.push(`${d.acidQt} qt acid`);
  if (d.saltBags) parts.push(`${d.saltBags} bags salt ($${d.saltCost})`);
  return parts.join(" · ");
}

function LoadRow({ label, load, strong }: { label: string; load: Load; strong?: boolean }) {
  const cls = strong ? "font-semibold" : "text-neutral-600 dark:text-neutral-400";
  return (
    <tr className={cls}>
      <td className="py-1 pr-2">{label}</td>
      <td className="py-1 text-right tabular-nums">{load.chlorineGal.toFixed(1)}</td>
      <td className="py-1 text-right tabular-nums">{load.acidQt}</td>
      <td className="py-1 text-right tabular-nums">{load.saltBags}</td>
    </tr>
  );
}

function TechCard({ plan, max }: { plan: TechPlan; max: number }) {
  return (
    <div className={card}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold">{plan.tech}</h3>
        <span className={`text-sm tabular-nums ${plan.stops.length > max ? "text-red-600" : "text-neutral-500"}`}>
          {plan.stops.length} / {max} extra stops
        </span>
      </div>

      {plan.stops.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">No extra stops.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {plan.stops.map((s) => (
            <li key={s.poolId} className="rounded-lg bg-neutral-50 p-3 text-sm dark:bg-neutral-800/60">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-neutral-500">{s.poolId}</span>
                <span className="font-medium">{s.customer}</span>
                {s.reassigned && (
                  <span className="rounded-full border border-violet-500 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
                    Reassigned from {s.ownTech}
                  </span>
                )}
                {s.overCapacity && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Over capacity</span>
                )}
              </div>
              <div className="mt-1 text-neutral-600 dark:text-neutral-400">
                {s.label} · {s.area}
              </div>
              <div className="mt-1">
                {s.reason === "makeup"
                  ? "Bring standard kit: test on site"
                  : s.doses
                    ? doseList(s.doses) || "No dose needed"
                    : "No computed dose (data flag): test on site"}
              </div>
            </li>
          ))}
        </ol>
      )}

      {plan.handedOff.length > 0 && (
        <p className="mt-3 text-sm text-violet-700 dark:text-violet-300">
          Handed off: {plan.handedOff.map((s) => `${s.poolId} → ${s.assignedTech}`).join(", ")}
        </p>
      )}

      {plan.routeDoses.length > 0 && (
        <div className="mt-3 text-sm">
          <div className="font-medium">Doses on today&apos;s regular route</div>
          <ul className="mt-1 text-neutral-600 dark:text-neutral-400">
            {plan.routeDoses.map((r) => (
              <li key={r.poolId}>
                <span className="font-mono text-xs">{r.poolId}</span> {r.customer}: {doseList(r.doses)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
            <th className="pb-1 text-left align-bottom font-medium">Truck load</th>
            <th className="pb-1 pl-2 text-right font-medium">Chlorine<br />gal</th>
            <th className="pb-1 pl-2 text-right font-medium">Acid<br />qt</th>
            <th className="pb-1 pl-2 text-right font-medium">Salt<br />bags</th>
          </tr>
        </thead>
        <tbody>
          <LoadRow label="Extra stops" load={plan.load.extra} />
          <LoadRow label="Regular route" load={plan.load.route} />
          <LoadRow label="Total" load={plan.load.total} strong />
        </tbody>
      </table>
    </div>
  );
}

function PoolRow({ r, noteSource }: { r: PoolResult; noteSource: string | null }) {
  const doses = doseList(r.doses);
  return (
    <li className="border-b border-neutral-200 py-3 last:border-0 dark:border-neutral-800 md:grid md:grid-cols-[12rem_1fr_12rem] md:gap-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-neutral-500">{r.pool.id}</span>
          <Badge status={r.status} />
        </div>
        <div className="mt-1 font-medium">{r.pool.customer}</div>
        <div className="text-xs text-neutral-500">
          {r.pool.tech} · {r.pool.serviceDay} · {r.pool.type} · {r.pool.gallons?.toLocaleString("en-US") ?? "?"} gal
        </div>
      </div>
      <div className="mt-2 text-sm md:mt-0">
        {r.findings.length === 0 ? (
          <span className="text-neutral-500">All readings in range.</span>
        ) : (
          <ul className="space-y-1">
            {r.findings.map((f, i) => (
              <li key={i} className={f.status ? "" : "text-neutral-500"}>
                {f.text}
                {f.calc && <div className="font-mono text-xs text-neutral-500">{f.calc}</div>}
              </li>
            ))}
          </ul>
        )}
        {noteSource && r.reading?.note && (
          <div className="mt-1 text-xs text-neutral-400">Note sorted by {noteSource}</div>
        )}
      </div>
      <div className="mt-2 text-sm md:mt-0">
        {doses ? (
          <>
            <div className="text-xs uppercase tracking-wide text-neutral-500">Doses {r.doseWhen === "today" ? "today" : `· ${r.doseWhen}`}</div>
            <div>{doses}</div>
          </>
        ) : r.dataFlag ? (
          <span className="text-neutral-500">No doses (data flag)</span>
        ) : r.makeup ? (
          <span className="text-neutral-500">Test on site today</span>
        ) : (
          <span className="text-neutral-400">—</span>
        )}
      </div>
    </li>
  );
}

function UploadButton({ label, name, onFile }: { label: string; name: string; onFile: (text: string, name: string) => void }) {
  async function change(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    onFile(await f.text(), f.name);
    e.target.value = "";
  }
  return (
    <label className="flex flex-1 cursor-pointer flex-col rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-sm hover:border-neutral-500 dark:border-neutral-700">
      <span className="font-medium">{label}</span>
      <span className="truncate text-xs text-neutral-500">{name}</span>
      <input type="file" accept=".csv,text/csv" className="sr-only" onChange={change} />
    </label>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
      className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

type SendState = { kind: "idle" } | { kind: "sending" } | { kind: "done"; sent: number } | { kind: "error"; sent: number; error: string };

function GroupMePanel({ messages }: { messages: string[] }) {
  const [state, setState] = useState<SendState>({ kind: "idle" });

  async function send() {
    if (!window.confirm(`Post ${messages.length} messages to the GroupMe chat?`)) return;
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/groupme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      const data = await res.json();
      if (!res.ok) setState({ kind: "error", sent: data.sent ?? 0, error: data.error || "Send failed" });
      else setState({ kind: "done", sent: data.sent });
    } catch {
      setState({ kind: "error", sent: 0, error: "Couldn't reach the server." });
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={send}
          disabled={state.kind === "sending"}
          className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
        >
          {state.kind === "sending" ? `Sending ${messages.length} messages…` : "Send Monday plan to GroupMe"}
        </button>
        <CopyButton text={messages.join("\n\n")} label="Copy all" />
      </div>
      {state.kind === "done" && (
        <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">Sent {state.sent} of {messages.length} messages.</p>
      )}
      {state.kind === "error" && (
        <p className="mt-2 text-sm text-red-600">
          {state.error}
          {state.sent > 0 ? ` (${state.sent} of ${messages.length} went through.)` : ""} You can still copy and paste the messages below.
        </p>
      )}
      <ol className="mt-3 space-y-3">
        {messages.map((m, i) => (
          <li key={i} className={card}>
            <div className="flex items-center justify-between text-xs text-neutral-500">
              <span>
                Message {i + 1} of {messages.length} · {m.length}/{GROUPME_LIMIT}
              </span>
              <CopyButton text={m} />
            </div>
            <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{m}</pre>
          </li>
        ))}
      </ol>
    </div>
  );
}

type Draft = { text: string; source: "Gemini" | "Template"; note?: string };

function TextCard({ job, draft }: { job: TextJob; draft: Draft }) {
  const [copied, setCopied] = useState(false);
  const kinds = { unsafe: "Unsafe water", makeup: "Make-up visit", cya: "Drain approval" };
  return (
    <div className={card}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{job.to}</span>
        <span className="font-mono text-xs text-neutral-500">{job.poolId}</span>
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-semibold uppercase dark:bg-neutral-800">
          {job.language === "es" ? "Español" : "English"}
        </span>
        {job.kinds.map((k) => (
          <span key={k} className="text-xs text-neutral-500">{kinds[k]}</span>
        ))}
      </div>
      <p className="mt-3 whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-sm leading-relaxed dark:bg-neutral-800/60">{draft.text}</p>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-neutral-500">
        <span>
          {draft.source === "Gemini" ? "Drafted by Gemini, checked" : "Template"}
          {draft.note ? ` (${draft.note})` : ""}
        </span>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(draft.text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {}
          }}
          className="rounded-md border border-neutral-300 px-2.5 py-1 font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export default function Desk({ defaultPools, defaultReadings }: { defaultPools: string; defaultReadings: string }) {
  const [poolsFile, setPoolsFile] = useState({ text: defaultPools, name: "data/royalpalm_pools.csv" });
  const [readingsFile, setReadingsFile] = useState({ text: defaultReadings, name: "data/royalpalm_readings.csv" });
  // Each AI result remembers which input it answered, so stale or pending
  // results simply fall back to keywords/templates.
  const [noteRes, setNoteRes] = useState<AiResult<Record<string, NoteClass>> | null>(null);
  const [textRes, setTextRes] = useState<AiResult<Record<string, Draft>> | null>(null);
  const [filter, setFilter] = useState<Status | "All">("All");

  const pools = useMemo(() => parsePools(poolsFile.text), [poolsFile.text]);
  const readings = useMemo(() => parseReadings(readingsFile.text), [readingsFile.text]);

  // (1) Gemini sorts the tech notes.
  const notes = useMemo(() => {
    const uniq = new Map<string, string>();
    readings.readings.forEach((r) => {
      if (r.note.trim() && !isNoService(r.note)) uniq.set(noteKey(r.note), r.note);
    });
    return [...uniq.entries()].map(([id, note]) => ({ id, note }));
  }, [readings.readings]);
  const notesKey = useMemo(() => JSON.stringify(notes), [notes]);

  useEffect(() => {
    if (notes.length === 0) return;
    let cancelled = false;
    fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: "classify", notes }) })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || data.fallback) throw new Error("fallback");
        const map: Record<string, NoteClass> = {};
        for (const r of data.results ?? []) {
          if (["equipment", "chemistry", "routine"].includes(r.category) && notes.some((n) => n.id === r.id)) map[r.id] = r.category;
        }
        if (!cancelled) setNoteRes({ key: notesKey, ok: Object.keys(map).length > 0, data: map });
      })
      .catch(() => {
        if (!cancelled) setNoteRes({ key: notesKey, ok: false, data: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [notes, notesKey]);

  const aiNotes = useMemo(
    () => (noteRes && noteRes.key === notesKey && noteRes.ok ? noteRes.data : {}),
    [noteRes, notesKey]
  );
  const classifyState: AiState =
    notes.length === 0 ? "fallback" : noteRes?.key !== notesKey ? "loading" : noteRes.ok ? "gemini" : "fallback";

  // Fixed playbook cases first, then Gemini, then keywords.
  const classify = useCallback(
    (note: string): NoteClass => fixedClass(note) ?? aiNotes[noteKey(note)] ?? classifyByKeywords(note),
    [aiNotes]
  );
  const noteSource = useCallback(
    (note: string) => (fixedClass(note) ? "playbook rule" : aiNotes[noteKey(note)] ? "Gemini" : "keywords"),
    [aiNotes]
  );

  const a = useMemo(() => analyze(pools.pools, readings.readings, classify), [pools.pools, readings.readings, classify]);

  // (2) Gemini drafts customer texts from the facts the rules produced.
  const jobsKey = JSON.stringify(a.textJobs.map((j) => [j.id, j.language, j.facts]));
  useEffect(() => {
    const jobs = a.textJobs;
    if (jobs.length === 0) return;
    let cancelled = false;
    fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "texts",
        jobs: jobs.map((j) => ({ id: j.id, language: j.language, firstName: j.firstName, kinds: j.kinds, facts: j.facts })),
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || data.fallback) throw new Error("fallback");
        const out: Record<string, Draft> = {};
        for (const t of data.texts ?? []) {
          const job = jobs.find((j) => j.id === t.id);
          if (!job || typeof t.text !== "string") continue;
          const problem = checkDraft(job, t.text.trim());
          out[job.id] = problem
            ? { text: templateText(job), source: "Template", note: `Gemini draft rejected: ${problem}` }
            : { text: t.text.trim(), source: "Gemini" };
        }
        if (!cancelled) setTextRes({ key: jobsKey, ok: true, data: out });
      })
      .catch(() => {
        if (!cancelled) setTextRes({ key: jobsKey, ok: false, data: {} });
      });
    return () => {
      cancelled = true;
    };
    // a.textJobs is represented by jobsKey; refetch only when the facts change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsKey]);

  const aiDrafts = textRes && textRes.key === jobsKey && textRes.ok ? textRes.data : {};
  const textsState: AiState =
    a.textJobs.length === 0 ? "fallback" : textRes?.key !== jobsKey ? "loading" : textRes.ok ? "gemini" : "fallback";

  const groupMe = useMemo(() => buildGroupMeMessages(a), [a]);

  const draftFor = (job: TextJob): Draft => aiDrafts[job.id] ?? { text: templateText(job), source: "Template" };

  const counts = STATUS_ORDER.map((s) => [s, a.pools.filter((r) => r.status === s).length] as const);
  const shown = filter === "All" ? a.pools : a.pools.filter((r) => r.status === filter);
  const sorted = [...shown].sort(
    (x, y) => STATUS_ORDER.indexOf(x.status) - STATUS_ORDER.indexOf(y.status) || x.pool.id.localeCompare(y.pool.id)
  );
  const fileError = pools.error || readings.error;
  const todayLong = new Date(a.todayISO + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  const aiMode =
    classifyState === "loading" || textsState === "loading"
      ? "AI: checking…"
      : classifyState === "gemini" && textsState === "gemini"
        ? "AI: Gemini"
        : classifyState === "fallback" && textsState === "fallback"
          ? "AI: off, using templates"
          : classifyState === "gemini"
            ? "AI: Gemini notes, template texts"
            : "AI: keyword notes, Gemini texts";

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-24 pt-8">
      <header>
        <p className="text-sm font-medium text-sky-700 dark:text-sky-400">Royal Palm Pool Service</p>
        <h1 className="text-2xl font-semibold tracking-tight">Operator desk</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {todayLong} · readings {shortDate(a.weekStartISO)} – {shortDate(a.weekEndISO)}
        </p>
      </header>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <UploadButton label="Upload pools CSV" name={poolsFile.name} onFile={(text, name) => setPoolsFile({ text, name })} />
        <UploadButton label="Upload readings CSV" name={readingsFile.name} onFile={(text, name) => setReadingsFile({ text, name })} />
        <button
          onClick={() => {
            setPoolsFile({ text: defaultPools, name: "data/royalpalm_pools.csv" });
            setReadingsFile({ text: defaultReadings, name: "data/royalpalm_readings.csv" });
          }}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Use /data files
        </button>
      </div>
      {fileError && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{fileError}</p>}
      {a.warnings.map((w) => (
        <p key={w} className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">{w}</p>
      ))}

      {/* Headline */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-red-600 p-5 text-white">
          <div className="text-5xl font-bold tabular-nums">{a.unsafe.length}</div>
          <div className="mt-1 font-medium">pools were unsafe to swim and nobody had reviewed them</div>
          <div className="mt-2 text-sm text-red-100">
            {a.unsafe.map((r) => `${r.pool.id} ${r.pool.customer}`).join(" · ") || "None"}
          </div>
        </div>
        <div className="rounded-xl bg-emerald-700 p-5 text-white">
          <div className="text-5xl font-bold tabular-nums">${a.billing.total.toLocaleString("en-US")}</div>
          <div className="mt-1 font-medium">billable found</div>
          <div className="mt-2 text-sm text-emerald-100">
            ${a.billing.saltDollars} salt ({a.billing.saltBags} bags × ${RULES.saltBagPrice}) · ${a.billing.drainDollars} drain/refill (
            {a.billing.drains}, needs customer OK)
          </div>
        </div>
      </div>

      <Section title="Monday plan" sub={`Extra stops per tech (max ${RULES.maxExtraStops}). Chemicals travel with the stop.`}>
        <div className="grid gap-3 md:grid-cols-3">
          {a.plans.map((p) => (
            <TechCard key={p.tech} plan={p} max={RULES.maxExtraStops} />
          ))}
        </div>
      </Section>

      <Section title="GroupMe" sub="Plain-text messages, sent in this order. Copy them if the bot isn't set up.">
        <GroupMePanel messages={groupMe} />
      </Section>

      <Section title="For Tomás">
        <div className="grid gap-3 md:grid-cols-2">
          <div className={card}>
            <h3 className="font-semibold">Equipment: needs a repair quote</h3>
            <p className="text-xs text-neutral-500">Don&apos;t quote a price to the customer.</p>
            {a.tomas.equipment.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-500">None.</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {a.tomas.equipment.map((e) => (
                  <li key={e.poolId}>
                    <span className="font-mono text-xs text-neutral-500">{e.poolId}</span> <span className="font-medium">{e.customer}</span>
                    <div className="text-neutral-600 dark:text-neutral-400">
                      &ldquo;{e.note}&rdquo; ({e.tech}, {shortDate(e.date)})
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={card}>
            <h3 className="font-semibold">CYA approvals: ${RULES.drainCost} drain/refill</h3>
            <p className="text-xs text-neutral-500">Text sent asking for OK. Do nothing until they reply.</p>
            {a.tomas.cya.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-500">None.</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {a.tomas.cya.map((c) => (
                  <li key={c.poolId}>
                    <span className="font-mono text-xs text-neutral-500">{c.poolId}</span> <span className="font-medium">{c.customer}</span>
                    <div className="text-neutral-600 dark:text-neutral-400">
                      CYA {c.cya} &gt; 100 → ${c.cost}, awaiting customer OK
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Section>

      <Section title="Customer texts" sub="Drafts only. Nothing is sent from here.">
        {a.textJobs.length === 0 ? (
          <p className="text-sm text-neutral-500">No texts needed.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {a.textJobs.map((j) => (
              <TextCard key={j.id} job={j} draft={draftFor(j)} />
            ))}
          </div>
        )}
      </Section>

      <Section title="All pools" sub="One status per pool, with every finding and its reason.">
        <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {(["All", ...STATUS_ORDER] as const).map((s) => {
            const n = s === "All" ? a.pools.length : counts.find(([k]) => k === s)![1];
            const on = filter === s;
            return (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`whitespace-nowrap rounded-full border px-3 py-1 text-sm ${
                  on
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-neutral-300 dark:border-neutral-700"
                }`}
              >
                {s} <span className="tabular-nums opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
        <ul className={card + " py-1"}>
          {sorted.map((r) => (
            <PoolRow
              key={r.pool.id}
              r={r}
              noteSource={r.reading?.note && !r.makeup ? noteSource(r.reading.note) : null}
            />
          ))}
        </ul>
      </Section>
      <div
        role="status"
        className="fixed bottom-3 right-3 z-10 rounded-full border border-neutral-200 bg-white/90 px-3 py-1 text-xs text-neutral-600 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/90 dark:text-neutral-300"
      >
        {aiMode}
      </div>
    </main>
  );
}
