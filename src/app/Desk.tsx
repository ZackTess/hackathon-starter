"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  analyze,
  RULES,
  parsePools,
  parseReadings,
  shortDate,
  STATUS_ORDER,
  type Doses,
  type PoolResult,
  type Status,
  type Stop,
  type TechPlan,
  type TextJob,
} from "@/lib/rules";
import { classifyByKeywords, fixedClass, isNoService, noteKey, type NoteClass } from "@/lib/notes";
import { checkDraft, templateText } from "@/lib/texts";
import { buildGroupMePlan, GROUPME_LIMIT, type GroupBatch } from "@/lib/groupme";
import { nextAction } from "@/lib/nextAction";

type AiState = "loading" | "gemini" | "fallback";
type AiResult<T> = { key: string; ok: boolean; data: T };
type Draft = { text: string; source: "Gemini" | "Template"; note?: string };
type TabId = "today" | "team" | "tomas" | "pools" | "texts" | "groupme" | "files";
type FileState = { text: string; name: string; loadedAt: number | null; source?: "upload" | "sheet" };
type LiveInfo = { on: boolean; syncing: boolean; lastSyncAt: number | null; error: string; pull: () => void };
type LiveAlert = { poolId: string; customer: string; status: Status; tech: string; action: string; reason: string; posted: { tech: boolean; tomas: boolean } };
type Toast = { id: number; alert: LiveAlert };
/** Customer text status. No entry = Draft. */
type OutboxEntry = { state: "approved" | "sent" | "failed"; text: string; at: number; error?: string };
type Outbox = Record<string, OutboxEntry>;

// ---------- Visual primitives ----------

/** Pressable feedback: quick scale on press, never on hover. */
const press = "transition-transform duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none";
const card = "rounded-[20px] bg-card";

const STATUS_TINT: Record<Status, string> = {
  "Revisit today": "bg-ios-red/15 text-ios-red",
  "Tomás": "bg-ios-orange/15 text-ios-orange",
  "Data flag": "bg-ios-gray/20 text-label2",
  "Dose at next visit": "bg-ios-blue/15 text-ios-blue",
  OK: "bg-ios-green/15 text-ios-green",
};
const STATUS_DOT: Record<Status, string> = {
  "Revisit today": "bg-ios-red",
  "Tomás": "bg-ios-orange",
  "Data flag": "bg-ios-gray",
  "Dose at next visit": "bg-ios-blue",
  OK: "bg-ios-green",
};
const REASON_DOT: Record<Stop["reason"], string> = {
  green: "bg-ios-red",
  cloudy: "bg-ios-orange",
  lowFC: "bg-ios-orange",
  makeup: "bg-ios-blue",
};
const TECH_TINT = ["bg-ios-blue", "bg-ios-indigo", "bg-ios-teal", "bg-ios-orange", "bg-ios-green"];

type IconName = "alert" | "truck" | "dollar" | "wrench" | "flask" | "send" | "copy" | "chevron" | "doc" | "check";

const ICONS: Record<IconName, ReactNode> = {
  alert: (
    <>
      <path d="M10.3 4.2 2.6 17.6A2 2 0 0 0 4.3 20.6h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4.2M12 17h.01" />
    </>
  ),
  truck: (
    <>
      <path d="M2.5 6.5h11v9.5h-11zM13.5 10h4.2l3.3 3.3V16h-7.5" />
      <circle cx="6.5" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </>
  ),
  dollar: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.6 9.3c-.5-.9-1.5-1.4-2.6-1.4-1.5 0-2.6.8-2.6 2s1.1 1.7 2.6 2.1 2.8.9 2.8 2.2-1.2 2.1-2.8 2.1c-1.2 0-2.3-.5-2.8-1.5M12 6.4v1.5M12 16.3v1.4" />
    </>
  ),
  wrench: <path d="M14.5 4a4.5 4.5 0 0 0-4.2 6.1L3.9 16.5a2 2 0 1 0 2.8 2.8l6.4-6.4A4.5 4.5 0 0 0 20 8.5l-2.6 2.6-2.3-.5-.5-2.3L17.2 5.7A4.5 4.5 0 0 0 14.5 4Z" />,
  flask: <path d="M9.5 3.5h5M10.5 3.5v5.4L4.9 18.4a1.4 1.4 0 0 0 1.2 2.1h11.8a1.4 1.4 0 0 0 1.2-2.1l-5.6-9.5V3.5M7.4 14.5h9.2" />,
  send: <path d="M21 3 10.6 13.4M21 3l-6.6 18-3.8-7.6L3 9.6 21 3Z" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />
      <path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  chevron: <path d="m9 5.5 6.5 6.5L9 18.5" />,
  doc: <path d="M14 3.5H7A2.5 2.5 0 0 0 4.5 6v12A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5V9L14 3.5ZM14 3.5V9h5.5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
};

function Icon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

/** Rounded-square glyph like iOS Settings rows. */
function Glyph({ name, tint }: { name: IconName; tint: string }) {
  return (
    <span className={`grid size-8 shrink-0 place-items-center rounded-[9px] text-white ${tint}`}>
      <Icon name={name} className="size-[18px]" />
    </span>
  );
}

function Badge({ status }: { status: Status }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold ${STATUS_TINT[status]}`}>
      {status}
    </span>
  );
}

function Section({ title, sub, trailing, id, children }: { title: string; sub?: string; trailing?: ReactNode; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-9 scroll-mt-20">
      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          <h2 className="text-[22px] font-bold leading-tight tracking-tight">{title}</h2>
          {sub && <p className="mt-0.5 text-[13px] text-label2">{sub}</p>}
        </div>
        {trailing}
      </div>
      <div className="mt-3">{children}</div>
    </section>
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
      className={`inline-flex h-8 items-center gap-1.5 rounded-full bg-fill px-3 text-[13px] font-semibold text-ios-blue ${press}`}
    >
      <Icon name={copied ? "check" : "copy"} className="size-4" />
      {copied ? "Copied" : label}
    </button>
  );
}

function doseList(d: Doses | null): string {
  if (!d) return "";
  const parts: string[] = [];
  if (d.chlorineGal) parts.push(`${d.chlorineGal.toFixed(1)} gal chlorine`);
  if (d.acidQt) parts.push(`${d.acidQt} qt acid`);
  if (d.saltBags) parts.push(`${d.saltBags} bags salt ($${d.saltCost})`);
  return parts.join(" · ");
}

// ---------- Stat cards ----------

function Stat({ icon, tint, text, value, label, sub }: { icon: IconName; tint: string; text: string; value: string; label: string; sub: string }) {
  return (
    <div className={`${card} flex min-w-0 flex-col p-3.5`}>
      <Glyph name={icon} tint={tint} />
      <div className={`mt-3 text-[28px] font-bold leading-none tabular-nums tracking-tight ${text}`}>{value}</div>
      <div className="mt-1.5 text-[13px] font-semibold leading-tight">{label}</div>
      <div className="mt-1 text-[11px] leading-snug text-label2">{sub}</div>
    </div>
  );
}

// ---------- Tech card ----------

function Meter({ used, max }: { used: number; max: number }) {
  return (
    <div className="flex gap-1" aria-label={`${used} of ${max} extra stops`}>
      {Array.from({ length: Math.max(max, used) }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 w-5 rounded-full ${i < used ? (used > max ? "bg-ios-red" : "bg-ios-blue") : "bg-fill"}`}
        />
      ))}
    </div>
  );
}

function LoadTile({ value, unit }: { value: string; unit: string }) {
  return (
    <div className="rounded-[14px] bg-fill px-3 py-2.5">
      <div className="text-[22px] font-bold leading-none tabular-nums tracking-tight">{value}</div>
      <div className="mt-1 text-[11px] font-medium text-label2">{unit}</div>
    </div>
  );
}

function TechCard({ plan, max, tint }: { plan: TechPlan; max: number; tint: string }) {
  const t = plan.load.total;
  const r = plan.load.route;
  const routeBits = [
    r.chlorineGal ? `${r.chlorineGal.toFixed(1)} gal` : "",
    r.acidQt ? `${r.acidQt} qt acid` : "",
    r.saltBags ? `${r.saltBags} salt bags` : "",
  ].filter(Boolean);

  return (
    <div className={`${card} p-4`}>
      <div className="flex items-center gap-3">
        <span className={`grid size-10 shrink-0 place-items-center rounded-full text-[17px] font-semibold text-white ${tint}`}>
          {plan.tech.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-semibold leading-tight">{plan.tech}</h3>
          <p className={`text-[13px] ${plan.stops.length > max ? "text-ios-red" : "text-label2"}`}>
            {plan.stops.length} of {max} extra stops
          </p>
        </div>
        <Meter used={plan.stops.length} max={max} />
      </div>

      {plan.stops.length === 0 ? (
        <p className="mt-4 rounded-[14px] bg-fill px-3 py-3 text-[15px] text-label2">No extra stops today.</p>
      ) : (
        <ol className="mt-4 divide-y divide-sep overflow-hidden rounded-[14px] bg-fill">
          {plan.stops.map((s) => (
            <li key={s.poolId} className="flex gap-3 px-3 py-2.5">
              <span className={`mt-[7px] size-2 shrink-0 rounded-full ${REASON_DOT[s.reason]}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span className="text-[15px] font-semibold">{s.customer}</span>
                  <span className="font-mono text-[12px] text-label2">{s.poolId}</span>
                  {s.reassigned && (
                    <span className="rounded-full bg-ios-indigo/15 px-2 py-0.5 text-[11px] font-semibold text-ios-indigo">
                      Reassigned from {s.ownTech}
                    </span>
                  )}
                  {s.overCapacity && (
                    <span className="rounded-full bg-ios-red/15 px-2 py-0.5 text-[11px] font-semibold text-ios-red">Over capacity</span>
                  )}
                </div>
                <div className="text-[13px] text-label2">
                  {s.label} · {s.area}
                </div>
                <div className="mt-0.5 text-[13px] font-medium">
                  {s.reason === "makeup"
                    ? "Standard kit · test on site"
                    : s.doses
                      ? doseList(s.doses) || "No dose needed"
                      : "No computed dose (data flag) · test on site"}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {plan.handedOff.length > 0 && (
        <p className="mt-2.5 px-1 text-[13px] text-ios-indigo">
          Handed off: {plan.handedOff.map((s) => `${s.poolId} → ${s.assignedTech}`).join(", ")}
        </p>
      )}

      <div className="mt-4 flex items-center gap-1.5 px-1 text-[13px] font-semibold text-label2">
        <Icon name="truck" className="size-4" /> Truck load
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <LoadTile value={t.chlorineGal ? t.chlorineGal.toFixed(1) : "0"} unit="gal chlorine" />
        <LoadTile value={String(t.acidQt)} unit="qt acid" />
        <LoadTile value={String(t.saltBags)} unit="salt bags" />
      </div>
      {plan.routeDoses.length > 0 && (
        <p className="mt-2 px-1 text-[12px] leading-snug text-label2">
          Includes {routeBits.join(", ")} for today&apos;s route:{" "}
          {plan.routeDoses.map((d) => `${d.poolId} ${d.customer}`).join(", ")}
        </p>
      )}
    </div>
  );
}

// ---------- Rows ----------

function Row({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <li className={`flex gap-3 px-4 py-3 ${className}`}>{children}</li>;
}

function NextLine({ text }: { text: string }) {
  return (
    <div className="mt-1 text-[13px] leading-snug">
      <span className="font-semibold text-ios-blue">Next:</span> {text}
    </div>
  );
}

function PoolRow({ r, noteSource, next }: { r: PoolResult; noteSource: string | null; next: string }) {
  const doses = doseList(r.doses);
  const ok = r.status === "OK" && r.findings.length === 0;
  const meta = (
    <div className="text-[12px] text-label2">
      <span className="font-mono">{r.pool.id}</span> · {r.pool.tech} · {r.pool.serviceDay} · {r.pool.type} ·{" "}
      {r.pool.gallons?.toLocaleString("en-US") ?? "?"} gal
    </div>
  );
  const dot = <span className={`mt-[7px] size-2 shrink-0 rounded-full ${STATUS_DOT[r.status]}`} />;

  if (ok) {
    return (
      <Row className="py-2.5">
        {dot}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 truncate text-[15px] font-semibold">{r.pool.customer}</div>
            <Badge status={r.status} />
          </div>
          {meta}
          <NextLine text={next} />
        </div>
        <span className="w-4 shrink-0" aria-hidden />
      </Row>
    );
  }

  const lead = r.findings.find((f) => f.status) ?? r.findings[0];
  const more = r.findings.length - 1;
  return (
    <li>
      <details>
        <summary className="flex cursor-pointer gap-3 px-4 py-3 active:bg-fill">
          {dot}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 truncate text-[15px] font-semibold">{r.pool.customer}</div>
              <Badge status={r.status} />
            </div>
            {meta}
            <NextLine text={next} />
            <div className="mt-1 line-clamp-1 text-[13px] text-label2 [details[open]_&]:hidden">
              {lead?.text}
              {more > 0 && <span className="text-label2"> · +{more} more</span>}
            </div>
          </div>
          <Icon name="chevron" className="chev mt-1 size-4 shrink-0 text-label3 transition-transform duration-200 ease-out motion-reduce:transition-none" />
        </summary>
        <div className="pb-3 pl-9 pr-11">
          <ul className="space-y-1.5">
            {r.findings.map((f, i) => (
              <li key={i} className={`text-[13px] leading-snug ${f.status ? "" : "text-label2"}`}>
                {f.text}
                {f.calc && <div className="font-mono text-[11px] text-label2">{f.calc}</div>}
              </li>
            ))}
          </ul>
          {doses ? (
            <div className="mt-2 inline-flex flex-wrap items-baseline gap-x-1.5 rounded-[10px] bg-fill px-2.5 py-1.5 text-[13px]">
              <span className="font-semibold">{r.doseWhen === "today" ? "Today" : `Next visit · ${r.doseWhen}`}</span>
              <span className="text-label2">{doses}</span>
            </div>
          ) : r.dataFlag ? (
            <div className="mt-2 text-[12px] text-label2">No doses (data flag)</div>
          ) : r.makeup ? (
            <div className="mt-2 text-[12px] text-label2">Test on site today</div>
          ) : null}
          {noteSource && r.reading?.note && r.noteClass && r.noteClass !== "routine" && (
            <div className="mt-1 text-[11px] text-label3">Note sorted by {noteSource}</div>
          )}
        </div>
      </details>
    </li>
  );
}

function FileRow({ label, name, detail, onFile }: { label: string; name: string; detail?: string; onFile: (text: string, name: string) => void }) {
  async function change(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    onFile(await f.text(), f.name);
    e.target.value = "";
  }
  return (
    <Row className="items-center">
      <Glyph name="doc" tint="bg-ios-gray" />
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium">{label}</div>
        <div className="truncate text-[12px] text-label2">{name}</div>
        {detail && <div className="text-[12px] text-label2">{detail}</div>}
      </div>
      <label className={`cursor-pointer rounded-full bg-fill px-3 py-1.5 text-[13px] font-semibold text-ios-blue ${press}`}>
        Upload
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={change} />
      </label>
    </Row>
  );
}

const KIND_LABEL = { unsafe: "Unsafe water", makeup: "Make-up visit", cya: "Drain approval" };

const OUTBOX_PILL = {
  draft: { label: "Draft", tint: "bg-fill text-label2" },
  approved: { label: "Approved", tint: "bg-ios-blue/15 text-ios-blue" },
  sent: { label: "Sent", tint: "bg-ios-green/15 text-ios-green" },
  failed: { label: "Failed", tint: "bg-ios-red/12 text-ios-red" },
} as const;

function TextCard({
  job,
  draft,
  status,
  ready,
  onSend,
}: {
  job: TextJob;
  draft: Draft;
  status: OutboxEntry | undefined;
  ready: boolean;
  onSend: () => void;
}) {
  const initials = job.to
    .split(" ")
    .map((w) => w.charAt(0))
    .slice(0, 2)
    .join("");
  const state = status?.state ?? "draft";
  const pill = OUTBOX_PILL[state];
  // Once approved or sent, show exactly what went out.
  const shown = status && status.state !== "failed" ? status.text : draft.text;
  const time = status ? new Date(status.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";

  return (
    <div className={`${card} p-4`}>
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#a5abb8] to-[#858994] text-[13px] font-semibold text-white">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{job.to}</div>
          <div className="text-[12px] text-label2">
            {job.poolId} · {job.kinds.map((k) => KIND_LABEL[k]).join(" · ")}
          </div>
        </div>
        <span className="rounded-full bg-fill px-2 py-0.5 text-[11px] font-bold tracking-wide text-label2">
          {job.language === "es" ? "ES" : "EN"}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${pill.tint}`}>{pill.label}</span>
      </div>
      <p
        className={`ml-auto mt-3 w-fit max-w-[92%] whitespace-pre-wrap rounded-[20px] rounded-br-[6px] px-3.5 py-2.5 text-[15px] leading-snug transition-colors duration-200 ease-out ${
          state === "sent" ? "bg-ios-green text-white" : "bg-ios-blue text-white"
        }`}
      >
        {shown}
      </p>
      <div className="mt-2 text-right text-[11px] text-label2">
        {state === "sent"
          ? `Sent to Customer Outbox · ${time}`
          : state === "approved"
            ? "Approved by Tomás · sending…"
            : state === "failed"
              ? `Not sent: ${status?.error ?? "GroupMe error"}`
              : `${draft.source === "Gemini" ? "Drafted by Gemini · checked" : "Template"}${draft.note ? ` · ${draft.note}` : ""}`}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <CopyButton text={shown} />
        {state !== "sent" && (
          <button
            onClick={onSend}
            disabled={!ready || state === "approved"}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full bg-ios-blue px-3.5 text-[13px] font-semibold text-white disabled:opacity-50 ${press}`}
          >
            <Icon name="send" className="size-4" />
            {state === "approved" ? "Sending…" : !ready ? "Drafting…" : state === "failed" ? "Retry send" : "Approve & send"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Live sync ----------

/** Current time, ticking in the browser only (null during prerender). */
function useNow(ms = 1000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

function LiveBar({ live }: { live: LiveInfo }) {
  const now = useNow();
  const state = !live.on ? "paused" : live.error ? "error" : live.lastSyncAt ? "live" : "connecting";
  const dot = { live: "bg-ios-green", connecting: "bg-ios-orange", error: "bg-ios-red", paused: "bg-ios-gray" }[state];
  const label =
    state === "paused"
      ? "Paused · using uploaded files"
      : state === "error"
        ? `Sync failed · retrying${live.lastSyncAt && now != null ? ` · last synced ${ago(now - live.lastSyncAt)}` : ""}`
        : state === "connecting"
          ? "Connecting to Google Sheets…"
          : `Live · last synced ${now == null ? "just now" : ago(now - live.lastSyncAt!)}`;
  return (
    <div className="mx-auto flex h-8 max-w-5xl items-center justify-between gap-2 pl-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))]">
      <span className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-label2" title={live.error || undefined}>
        <span className="relative flex size-2 shrink-0">
          {state === "live" && <span className={`absolute inline-flex size-full rounded-full opacity-60 motion-safe:animate-ping ${dot}`} />}
          <span className={`relative inline-flex size-2 rounded-full ${dot}`} />
        </span>
        <span className="truncate tabular-nums">{label}</span>
      </span>
      <button
        onClick={live.pull}
        disabled={live.syncing}
        className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold text-ios-blue disabled:opacity-50 ${press}`}
      >
        {live.syncing ? "Syncing…" : "Pull latest"}
      </button>
    </div>
  );
}

const TOAST_TINT: Partial<Record<Status, string>> = {
  "Revisit today": "bg-ios-red",
  "Tomás": "bg-ios-orange",
  "Data flag": "bg-ios-gray",
};

function ToastStack({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+96px)] z-40 flex flex-col items-center gap-2 px-4">
      {toasts.map(({ id, alert: x }) => (
        <button
          key={id}
          onClick={() => dismiss(id)}
          className="toast-in pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-[18px] border border-sep bg-card/95 p-3 text-left shadow-lg backdrop-blur-xl"
        >
          <span className={`grid size-8 shrink-0 place-items-center rounded-[9px] text-white ${TOAST_TINT[x.status] ?? "bg-ios-blue"}`}>
            <Icon name="alert" className="size-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold leading-snug">
              New · {x.poolId} {x.customer} · {x.status}
            </span>
            <span className="block text-[13px] leading-snug text-label2">{x.action}</span>
            <span className="mt-0.5 block text-[11px] text-label2">
              {x.posted.tech ? `Alert sent to ${x.tech}` : `GroupMe alert to ${x.tech} failed`} ·{" "}
              {x.posted.tomas ? "Tomás notified" : "Tomás alert failed"}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------- GroupMe ----------

type SendResult = { target: string; sent: number; total: number };
type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; results: SendResult[] }
  | { kind: "error"; results: SendResult[]; error: string };

function useGroupMeSend(batches: GroupBatch[]) {
  const [state, setState] = useState<SendState>({ kind: "idle" });
  async function send() {
    if (!window.confirm(`Post the Monday plan to ${batches.length} GroupMe groups? Team goes first, then each person.`)) return;
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/groupme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batches: batches.map((b) => ({ target: b.target, messages: b.messages })) }),
      });
      const data = await res.json();
      if (!res.ok) setState({ kind: "error", results: data.results ?? [], error: data.error || "Send failed" });
      else setState({ kind: "done", results: data.results ?? [] });
    } catch {
      setState({ kind: "error", results: [], error: "Couldn't reach the server." });
    }
  }
  return { state, send };
}

// ---------- Page ----------

type ViewProps = {
  defaultPools: string;
  defaultReadings: string;
  poolsFile: FileState;
  setPoolsFile: (f: FileState) => void;
  readingsFile: FileState;
  setReadingsFile: (f: FileState) => void;
  tab: TabId;
  setTab: (t: TabId) => void;
  rerun: () => void;
  lastRunAt: number | null;
  outbox: Outbox;
  setOutbox: Dispatch<SetStateAction<Outbox>>;
  live: LiveInfo;
};

function DeskView({ defaultPools, defaultReadings, poolsFile, setPoolsFile, readingsFile, setReadingsFile, tab, setTab, rerun, lastRunAt, outbox, setOutbox, live }: ViewProps) {
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

  const groupMe = useMemo(() => buildGroupMePlan(a), [a]);
  const groupLabel = (target: string) => groupMe.find((b) => b.target === target)?.label.replace("Royal Palm – ", "") ?? target;

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

  const gm = useGroupMeSend(groupMe);

  // Customer texts: nothing sends until Tomás taps. The tap is the approval.
  const textsReady = textsState !== "loading";
  const pendingTexts = a.textJobs.filter((j) => {
    const st = outbox[j.id]?.state;
    return st !== "sent" && st !== "approved";
  });
  async function approveAndSend(jobs: TextJob[]) {
    if (!textsReady || jobs.length === 0) return;
    const items = jobs.map((j) => ({ id: j.id, to: j.to, language: j.language, poolId: j.poolId, text: draftFor(j).text }));
    const now = Date.now();
    setOutbox((prev) => {
      const next = { ...prev };
      items.forEach((i) => (next[i.id] = { state: "approved", text: i.text, at: now }));
      return next;
    });
    let results: { id: string; sent: boolean }[] = [];
    let error = "";
    try {
      const res = await fetch("/api/outbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      results = data.results ?? [];
      if (!res.ok) error = data.error || "Send failed";
    } catch {
      error = "Couldn't reach the server.";
    }
    setOutbox((prev) => {
      const next = { ...prev };
      for (const i of items) {
        const r = results.find((x) => x.id === i.id);
        next[i.id] = r?.sent
          ? { state: "sent", text: i.text, at: Date.now() }
          : { state: "failed", text: i.text, at: Date.now(), error: error || "Not sent" };
      }
      return next;
    });
  }
  function approveAll() {
    if (pendingTexts.length === 0) return;
    const ok = window.confirm(
      `Approve and send ${pendingTexts.length} customer text${pendingTexts.length === 1 ? "" : "s"} to the Royal Palm – Customer Outbox group?`
    );
    if (ok) approveAndSend(pendingTexts);
  }
  const extraStops = a.plans.reduce((n, p) => n + p.stops.length, 0);
  const flagged = a.pools.filter((r) => r.dataFlag);
  const resetFiles = () => {
    setPoolsFile({ text: defaultPools, name: "data/royalpalm_pools.csv", loadedAt: null });
    setReadingsFile({ text: defaultReadings, name: "data/royalpalm_readings.csv", loadedAt: null });
  };
  const [techTab, setTechTab] = useState(a.techs[0] ?? "");
  const activeTech = a.plans.find((p) => p.tech === techTab) ?? a.plans[0];

  // ----- Today: next actions (presentation only; everything comes from the analysis) -----
  type Action = { key: string; icon: IconName; tint: string; title: string; sub: string; go: () => void };
  const actions: Action[] = [];
  const allStops = a.plans.flatMap((p) => p.stops).sort((x, y) => y.urgency - x.urgency || x.poolId.localeCompare(y.poolId));
  for (const s of allStops) {
    actions.push({
      key: s.poolId,
      icon: s.reason === "makeup" ? "truck" : "alert",
      tint: s.reason === "makeup" ? "bg-ios-blue" : s.reason === "green" ? "bg-ios-red" : "bg-ios-orange",
      title: `${s.assignedTech}: ${s.poolId} ${s.customer}`,
      sub:
        s.reason === "makeup"
          ? `Make-up visit · test on site${s.reassigned ? ` · from ${s.ownTech}` : ""}`
          : `${s.label} · ${doseList(s.doses) || "test on site"}${s.reassigned ? ` · from ${s.ownTech}` : ""}`,
      go: () => {
        setTechTab(s.assignedTech);
        setTab("team");
      },
    });
  }
  if (a.textJobs.length) {
    const kinds = { unsafe: 0, makeup: 0, cya: 0 };
    a.textJobs.forEach((j) => j.kinds.forEach((k) => kinds[k]++));
    actions.push({
      key: "texts",
      icon: "send",
      tint: "bg-ios-green",
      title: `Text ${a.textJobs.length} customers`,
      sub: [
        kinds.unsafe && `${kinds.unsafe} unsafe water`,
        kinds.makeup && `${kinds.makeup} make-up`,
        kinds.cya && `${kinds.cya} approval`,
      ]
        .filter(Boolean)
        .join(" · "),
      go: () => setTab("texts"),
    });
  }
  if (a.tomas.equipment.length + a.tomas.cya.length) {
    actions.push({
      key: "tomas",
      icon: "wrench",
      tint: "bg-ios-orange",
      title: `Tomás: ${a.tomas.cya.length} approval${a.tomas.cya.length === 1 ? "" : "s"}, ${a.tomas.equipment.length} repair call${a.tomas.equipment.length === 1 ? "" : "s"}`,
      sub: [...a.tomas.cya.map((c) => `${c.poolId} CYA ${c.cya}`), ...a.tomas.equipment.map((e) => e.poolId)].join(" · "),
      go: () => setTab("tomas"),
    });
  }
  if (flagged.length) {
    actions.push({
      key: "flags",
      icon: "flask",
      tint: "bg-ios-gray",
      title: `Retest ${flagged.length} flagged pool${flagged.length === 1 ? "" : "s"}`,
      sub: flagged.map((r) => r.pool.id).join(" · "),
      go: () => setTab("files"),
    });
  }
  actions.push({
    key: "groupme",
    icon: "send",
    tint: "bg-ios-blue",
    title: "Send Monday plan to GroupMe",
    sub: `Team first, then ${groupMe.length - 1} people`,
    go: () => setTab("groupme"),
  });

  const TABS: { id: TabId; label: string; count: number }[] = [
    { id: "today", label: "Today", count: actions.length },
    { id: "team", label: "Team", count: extraStops },
    { id: "tomas", label: "Tomás", count: a.tomas.equipment.length + a.tomas.cya.length },
    { id: "pools", label: "All Pools", count: a.pools.length },
    { id: "texts", label: "Customer Texts", count: a.textJobs.length },
    { id: "groupme", label: "GroupMe", count: groupMe.length },
    { id: "files", label: "Data Files", count: flagged.length },
  ];
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];

  const sendStatus = (target: string): { text: string; tint: string } => {
    if (gm.state.kind === "sending") return { text: "Sending…", tint: "bg-ios-blue/15 text-ios-blue" };
    if (gm.state.kind === "idle") return { text: "Not sent", tint: "bg-fill text-label2" };
    const r = gm.state.results.find((x) => x.target === target);
    if (r && r.sent === r.total) return { text: "Sent ✓", tint: "bg-ios-green/15 text-ios-green" };
    if (r && r.sent > 0) return { text: `Sent ${r.sent}/${r.total}`, tint: "bg-ios-orange/15 text-ios-orange" };
    if (gm.state.kind === "error") return { text: r ? "Failed" : "Not sent", tint: r ? "bg-ios-red/12 text-ios-red" : "bg-fill text-label2" };
    return { text: "Not sent", tint: "bg-fill text-label2" };
  };

  const fileWhen = (f: FileState) => {
    if (f.loadedAt == null) return "Bundled with the app";
    const t = new Date(f.loadedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
    return f.source === "sheet" ? `Synced from Google Sheets ${t}` : `Uploaded ${t}`;
  };

  return (
    <div className="min-h-full pb-[calc(env(safe-area-inset-bottom)+72px)]">
      {/* Header bar: tabs scroll, Send stays on the right */}
      <header className="sticky top-0 z-20 border-b border-sep/60 bg-bg/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 pl-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))]">
          <nav
            role="tablist"
            aria-label="Sections"
            className="-ml-1 flex min-w-0 flex-1 scroll-px-8 gap-1 overflow-x-auto py-2 pl-1 [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {TABS.map((t) => {
              const on = t.id === current.id;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={on}
                  ref={on ? (el) => el?.scrollIntoView({ block: "nearest", inline: "nearest" }) : undefined}
                  onClick={() => setTab(t.id)}
                  className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold ${press} ${
                    on ? "bg-label text-bg" : "text-label hover:bg-fill"
                  }`}
                >
                  {t.label}
                  <span
                    className={`min-w-5 rounded-full px-1.5 text-center text-[11px] leading-[18px] tabular-nums ${
                      on ? "bg-bg/25 text-bg" : "bg-fill text-label2"
                    }`}
                  >
                    {t.count}
                  </span>
                </button>
              );
            })}
            <span className="w-4 shrink-0" aria-hidden />
          </nav>
          <button
            onClick={gm.send}
            disabled={gm.state.kind === "sending"}
            className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-ios-blue px-3.5 text-[13px] font-semibold text-white disabled:opacity-60 ${press}`}
          >
            <Icon name="send" className="size-4" />
            <span className="sm:hidden">{gm.state.kind === "sending" ? "Sending…" : "Send"}</span>
            <span className="hidden sm:inline">{gm.state.kind === "sending" ? "Sending…" : "Send Monday plan"}</span>
          </button>
        </div>
        <div className="border-t border-sep/40">
          <LiveBar live={live} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl pl-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))]">
        {/* Large title */}
        <div className="pt-4">
          <p className="text-[13px] font-semibold text-ios-blue">Royal Palm Pool Service</p>
          <h1 className="text-[34px] font-bold leading-tight tracking-tight">{current.label}</h1>
          <p className="text-[15px] text-label2">
            {todayLong} · readings {shortDate(a.weekStartISO)}–{shortDate(a.weekEndISO)}
          </p>
        </div>

        {/* Banners (every tab) */}
        {gm.state.kind === "done" && (
          <p className="mt-4 rounded-[14px] bg-ios-green/15 px-4 py-3 text-[15px] text-ios-green">
            Sent to {gm.state.results.map((r) => groupLabel(r.target)).join(", ")}. Team first, then each person.
          </p>
        )}
        {gm.state.kind === "error" && (
          <p className="mt-4 rounded-[14px] bg-ios-red/12 px-4 py-3 text-[15px] text-ios-red">
            {gm.state.error}
            {gm.state.results.some((r) => r.sent > 0)
              ? ` Already sent: ${gm.state.results
                  .filter((r) => r.sent > 0)
                  .map((r) => `${groupLabel(r.target)} (${r.sent}/${r.total})`)
                  .join(", ")}.`
              : ""}{" "}
            <button onClick={() => setTab("groupme")} className="font-semibold underline underline-offset-2">
              Copy the messages instead
            </button>
          </p>
        )}
        {fileError && <p className="mt-4 rounded-[14px] bg-ios-red/12 px-4 py-3 text-[15px] text-ios-red">{fileError}</p>}
        {a.warnings.map((w) => (
          <p key={w} className="mt-3 rounded-[14px] bg-ios-orange/15 px-4 py-3 text-[15px] text-ios-orange">
            {w}
          </p>
        ))}

        {/* ---------- Today ---------- */}
        {current.id === "today" && (
          <>
            <div className="mt-5 grid grid-cols-3 gap-2.5">
              <Stat
                icon="alert"
                tint="bg-ios-red"
                text="text-ios-red"
                value={String(a.unsafe.length)}
                label="Unsafe pools"
                sub={a.unsafe.length ? `Nobody reviewed · ${a.unsafe.map((r) => r.pool.id).join(" · ")}` : "None this week"}
              />
              <Stat
                icon="truck"
                tint="bg-ios-blue"
                text="text-ios-blue"
                value={String(extraStops)}
                label="Extra stops"
                sub={a.plans.map((p) => `${p.tech} ${p.stops.length}`).join(" · ")}
              />
              <Stat
                icon="dollar"
                tint="bg-ios-green"
                text="text-ios-green"
                value={`$${a.billing.total.toLocaleString("en-US")}`}
                label="Billable"
                sub={`$${a.billing.saltDollars} salt · $${a.billing.drainDollars} drain (needs OK)`}
              />
            </div>

            <Section title="Next actions" sub="Unsafe pools first. Tap a row for details.">
              <ul className={`${card} divide-y divide-sep overflow-hidden`}>
                {actions.map((x) => (
                  <li key={x.key}>
                    <button onClick={x.go} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-fill">
                      <Glyph name={x.icon} tint={x.tint} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-semibold">{x.title}</div>
                        <div className="truncate text-[13px] text-label2">{x.sub}</div>
                      </div>
                      <Icon name="chevron" className="size-4 shrink-0 text-label3" />
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          </>
        )}

        {/* ---------- Team ---------- */}
        {current.id === "team" && (
          <div className="mt-5">
            <div role="tablist" aria-label="Techs" className="grid rounded-[10px] bg-fill p-0.5" style={{ gridTemplateColumns: `repeat(${a.plans.length}, minmax(0, 1fr))` }}>
              {a.plans.map((p) => {
                const on = p.tech === activeTech?.tech;
                return (
                  <button
                    key={p.tech}
                    role="tab"
                    aria-selected={on}
                    onClick={() => setTechTab(p.tech)}
                    className={`h-8 truncate rounded-[8px] px-2 text-[13px] font-semibold transition-[background-color,box-shadow] duration-200 ease-out ${
                      on ? "bg-card shadow-sm" : "text-label2"
                    }`}
                  >
                    {p.tech} <span className="tabular-nums text-label2">{p.stops.length}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 px-1 text-[13px] text-label2">
              Max {RULES.maxExtraStops} extra stops per tech. Chemicals travel with the stop.
            </p>
            {activeTech && (
              <div className="mt-3">
                <TechCard
                  plan={activeTech}
                  max={RULES.maxExtraStops}
                  tint={TECH_TINT[Math.max(0, a.plans.indexOf(activeTech)) % TECH_TINT.length]}
                />
              </div>
            )}
          </div>
        )}

        {/* ---------- Tomás ---------- */}
        {current.id === "tomas" && (
          <>
            <Section title="Approvals" sub="Customer text drafted asking for OK. Wait for YES.">
              <ul className={`${card} divide-y divide-sep overflow-hidden`}>
                {a.tomas.cya.map((c) => (
                  <Row key={c.poolId}>
                    <Glyph name="dollar" tint="bg-ios-green" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[15px] font-semibold">{c.customer}</span>
                        <span className="shrink-0 rounded-full bg-ios-orange/15 px-2 py-0.5 text-[11px] font-semibold text-ios-orange">
                          Awaiting OK
                        </span>
                      </div>
                      <div className="text-[13px] leading-snug text-label2">
                        <span className="font-mono">{c.poolId}</span> · CYA {c.cya} &gt; 100 · ${c.cost} drain/refill
                      </div>
                    </div>
                  </Row>
                ))}
                {a.tomas.cya.length === 0 && (
                  <Row>
                    <span className="text-[15px] text-label2">No approvals needed.</span>
                  </Row>
                )}
              </ul>
            </Section>
            <Section title="Repair calls" sub="Quote the repair. Never give a price by text.">
              <ul className={`${card} divide-y divide-sep overflow-hidden`}>
                {a.tomas.equipment.map((e) => (
                  <Row key={e.poolId}>
                    <Glyph name="wrench" tint="bg-ios-orange" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[15px] font-semibold">{e.customer}</span>
                        <span className="shrink-0 text-[12px] text-label2">
                          {e.tech} · {shortDate(e.date)}
                        </span>
                      </div>
                      <div className="text-[13px] leading-snug text-label2">
                        <span className="font-mono">{e.poolId}</span> · &ldquo;{e.note}&rdquo;
                      </div>
                    </div>
                  </Row>
                ))}
                {a.tomas.equipment.length === 0 && (
                  <Row>
                    <span className="text-[15px] text-label2">No repair calls.</span>
                  </Row>
                )}
              </ul>
            </Section>
          </>
        )}

        {/* ---------- All Pools ---------- */}
        {current.id === "pools" && (
          <div className="mt-5">
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {(["All", ...STATUS_ORDER] as const).map((s) => {
                const n = s === "All" ? a.pools.length : counts.find(([k]) => k === s)![1];
                const on = filter === s;
                return (
                  <button
                    key={s}
                    onClick={() => setFilter(s)}
                    aria-pressed={on}
                    className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold ${press} ${
                      on ? "bg-label text-bg" : "bg-card text-label"
                    }`}
                  >
                    {s}
                    <span className={`tabular-nums ${on ? "opacity-70" : "text-label2"}`}>{n}</span>
                  </button>
                );
              })}
            </div>
            <ul className={`${card} mt-3 divide-y divide-sep overflow-hidden`}>
              {sorted.map((r) => (
                <PoolRow key={r.pool.id} r={r} next={nextAction(r, a)} noteSource={r.reading?.note && !r.makeup ? noteSource(r.reading.note) : null} />
              ))}
              {sorted.length === 0 && (
                <Row>
                  <span className="text-[15px] text-label2">No pools with this status.</span>
                </Row>
              )}
            </ul>
          </div>
        )}

        {/* ---------- Customer Texts ---------- */}
        {current.id === "texts" && (
          <div className="mt-5">
            <div className={`${card} flex items-center gap-3 p-4`}>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold">
                  {a.textJobs.length - pendingTexts.length} of {a.textJobs.length} sent or sending
                </div>
                <div className="text-[12px] leading-snug text-label2">
                  Nothing sends until Tomás taps. Approved texts go to the Customer Outbox group.
                </div>
              </div>
              <button
                onClick={approveAll}
                disabled={!textsReady || pendingTexts.length === 0}
                className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-ios-blue px-4 text-[14px] font-semibold text-white disabled:opacity-50 ${press}`}
              >
                <Icon name="check" className="size-4" />
                {!textsReady ? "Drafting…" : pendingTexts.length === 0 ? "All sent" : `Approve all (${pendingTexts.length})`}
              </button>
            </div>
            {a.textJobs.length === 0 ? (
              <p className={`${card} mt-3 px-4 py-3 text-[15px] text-label2`}>No texts needed.</p>
            ) : (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {a.textJobs.map((j) => (
                  <TextCard
                    key={j.id}
                    job={j}
                    draft={draftFor(j)}
                    status={outbox[j.id]}
                    ready={textsReady}
                    onSend={() => approveAndSend([j])}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---------- GroupMe ---------- */}
        {current.id === "groupme" && (
          <div className="mt-5">
            <div className="flex items-center justify-between gap-3 px-1">
              <p className="text-[13px] text-label2">Team gets the overview first, then each person gets their own.</p>
              <button
                onClick={gm.send}
                disabled={gm.state.kind === "sending"}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-ios-blue px-3.5 text-[13px] font-semibold text-white disabled:opacity-60 ${press}`}
              >
                <Icon name="send" className="size-4" />
                {gm.state.kind === "sending" ? "Sending…" : "Send all"}
              </button>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {groupMe.map((b) => {
                const st = sendStatus(b.target);
                return (
                  <div key={b.target} className={`${card} p-4`}>
                    <div className="flex items-center gap-3">
                      <Glyph name="send" tint={b.target === "team" ? "bg-ios-blue" : b.target === "tomas" ? "bg-ios-orange" : "bg-ios-indigo"} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-semibold">{b.label}</div>
                        <div className="text-[12px] text-label2">
                          {b.messages.length === 1 ? "1 message" : `${b.messages.length} messages`}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.tint}`}>{st.text}</span>
                    </div>
                    {b.messages.map((m, i) => (
                      <div key={i} className="mt-3">
                        <pre className="whitespace-pre-wrap break-words rounded-[14px] bg-fill px-3 py-2.5 font-sans text-[13px] leading-relaxed">{m}</pre>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-label2">
                          <span>
                            {b.messages.length > 1 ? `Part ${i + 1} of ${b.messages.length} · ` : ""}
                            {m.length}/{GROUPME_LIMIT}
                          </span>
                          <CopyButton text={m} />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ---------- Data Files ---------- */}
        {current.id === "files" && (
          <>
            <Section title="Files" sub="Live from Google Sheets every 60 seconds. Uploading a CSV pauses live sync; Pull latest resumes it.">
              <ul className={`${card} divide-y divide-sep overflow-hidden`}>
                <FileRow
                  label="pools.csv"
                  name={poolsFile.name}
                  detail={`${fileWhen(poolsFile)} · ${pools.pools.length} pools`}
                  onFile={(text, name) => setPoolsFile({ text, name, loadedAt: Date.now(), source: "upload" })}
                />
                <FileRow
                  label="readings.csv"
                  name={readingsFile.name}
                  detail={`${fileWhen(readingsFile)} · ${readings.readings.length} readings`}
                  onFile={(text, name) => setReadingsFile({ text, name, loadedAt: Date.now(), source: "upload" })}
                />
                <li className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1 text-[12px] text-label2">
                    {lastRunAt
                      ? `Last rerun ${new Date(lastRunAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                      : "Analyzed when the page opened"}
                  </div>
                  <button onClick={resetFiles} className={`rounded-full px-3 py-1.5 text-[13px] font-semibold text-ios-blue ${press}`}>
                    Use /data files
                  </button>
                  <button onClick={rerun} className={`rounded-full bg-ios-blue px-3.5 py-1.5 text-[13px] font-semibold text-white ${press}`}>
                    Rerun
                  </button>
                </li>
              </ul>
            </Section>

            <Section title="Data flags" sub="Retest or check at the next regular visit. No doses given.">
              <ul className={`${card} divide-y divide-sep overflow-hidden`}>
                {flagged.map((r) => (
                  <Row key={r.pool.id}>
                    <Glyph name="flask" tint="bg-ios-gray" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[15px] font-semibold">{r.pool.customer}</span>
                        <span className="shrink-0 text-[12px] text-label2">
                          {r.pool.tech} · {r.pool.serviceDay === a.todayAbbr ? "today" : r.pool.serviceDay}
                        </span>
                      </div>
                      {r.findings
                        .filter((f) => f.kind === "data")
                        .map((f, i) => (
                          <div key={i} className="text-[13px] leading-snug text-label2">
                            <span className="font-mono">{r.pool.id}</span> · {f.text}
                          </div>
                        ))}
                    </div>
                  </Row>
                ))}
                {flagged.length === 0 && (
                  <Row>
                    <span className="text-[15px] text-label2">No data flags.</span>
                  </Row>
                )}
              </ul>
            </Section>
          </>
        )}
      </main>

      {/* AI mode */}
      <div
        role="status"
        className="fixed right-[max(12px,env(safe-area-inset-right))] bottom-[max(12px,env(safe-area-inset-bottom))] z-30 rounded-full border border-sep bg-card/90 px-3 py-1.5 text-[12px] font-medium text-label2 shadow-sm backdrop-blur-xl"
      >
        {aiMode}
      </div>
    </div>
  );
}

// ---------- Shell: keeps files and tab across reruns ----------

export default function Desk({ defaultPools, defaultReadings }: { defaultPools: string; defaultReadings: string }) {
  const [poolsFile, setPoolsFile] = useState<FileState>({ text: defaultPools, name: "data/royalpalm_pools.csv", loadedAt: null });
  const [readingsFile, setReadingsFile] = useState<FileState>({ text: defaultReadings, name: "data/royalpalm_readings.csv", loadedAt: null });
  const [tab, setTabState] = useState<TabId>("today");
  const [run, setRun] = useState<{ id: number; at: number | null }>({ id: 0, at: null });
  // Kept here so a Rerun never makes a sent text look unsent.
  const [outbox, setOutbox] = useState<Outbox>({});
  const [liveOn, setLiveOn] = useState(true);
  const [sync, setSync] = useState<{ syncing: boolean; lastSyncAt: number | null; error: string }>({
    syncing: false,
    lastSyncAt: null,
    error: "",
  });
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const pull = useCallback(async () => {
    setSync((s) => ({ ...s, syncing: true }));
    try {
      const res = await fetch("/api/sync", { method: "POST", cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      const at: number = data.syncedAt;
      // Only replace the data when it changed, so the rules rerun on real changes.
      setPoolsFile((f) =>
        f.text === data.pools && f.source === "sheet" ? f : { text: data.pools, name: "Google Sheet · pools tab", loadedAt: at, source: "sheet" }
      );
      setReadingsFile((f) =>
        f.text === data.readings && f.source === "sheet"
          ? f
          : { text: data.readings, name: "Google Sheet · readings tab", loadedAt: at, source: "sheet" }
      );
      setSync({ syncing: false, lastSyncAt: at, error: "" });
      const fresh: LiveAlert[] = data.alerts ?? [];
      if (fresh.length) {
        const made = fresh.map((alert, i) => ({ id: at + i, alert }));
        setToasts((t) => [...made, ...t].slice(0, 4));
        made.forEach((m) => setTimeout(() => dismiss(m.id), 9000));
      }
    } catch (e) {
      setSync((s) => ({ ...s, syncing: false, error: e instanceof Error ? e.message : "Sync failed" }));
    }
  }, [dismiss]);

  // Poll every 60 seconds while live.
  useEffect(() => {
    if (!liveOn) return;
    const first = setTimeout(pull, 0);
    const every = setInterval(pull, 60000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [liveOn, pull]);

  const live: LiveInfo = {
    on: liveOn,
    syncing: sync.syncing,
    lastSyncAt: sync.lastSyncAt,
    error: sync.error,
    pull: () => {
      setLiveOn(true);
      pull();
    },
  };
  // Uploading or resetting files pauses live sync until Pull latest.
  const manualPools = (f: FileState) => {
    setLiveOn(false);
    setPoolsFile(f);
  };
  const manualReadings = (f: FileState) => {
    setLiveOn(false);
    setReadingsFile(f);
  };

  const setTab = (t: TabId) => {
    setTabState(t);
    window.scrollTo({ top: 0 });
  };

  // Rerun remounts the view: re-parses the files, reruns the rules, and re-asks Gemini.
  return (
    <>
    <ToastStack toasts={toasts} dismiss={dismiss} />
    <DeskView
      key={run.id}
      defaultPools={defaultPools}
      defaultReadings={defaultReadings}
      poolsFile={poolsFile}
      setPoolsFile={manualPools}
      readingsFile={readingsFile}
      setReadingsFile={manualReadings}
      tab={tab}
      setTab={setTab}
      rerun={() => setRun((r) => ({ id: r.id + 1, at: Date.now() }))}
      lastRunAt={run.at}
      outbox={outbox}
      setOutbox={setOutbox}
      live={live}
    />
    </>
  );
}
