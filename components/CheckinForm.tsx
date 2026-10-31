"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BudgetError, fitToBudget, preparePhoto } from "@/lib/imageCompress";
import { newId, putOutbox, removeOutbox, sendQueued, type QueuedCheckin } from "@/lib/outbox";
import type { StageState } from "@/lib/types";
import { AutoTextarea } from "./AutoTextarea";

export interface FormStage { id: string; name: string; state: StageState; percent: number; blockedReason?: string }

const STATES: { value: StageState; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "working", label: "Working" },
  { value: "done", label: "Done" },
  { value: "blocked", label: "Blocked" },
];
const PERCENTS = [10, 25, 50, 75, 90];
const REASONS = ["Material not arrived", "Workers not available", "Waiting for client decision", "Previous stage not finished"];
const MAX_PHOTOS = 8;

interface Row { state: StageState; percent: number; chip: string; text: string }
interface Photo { key: string; stageId: string; status: "preparing" | "ready" | "error"; file?: File; blob?: Blob; width: number; height: number; preview?: string; takenAt: string; error?: string }
type Geo = { lat: number; lng: number; accuracy?: number } | null;

function splitReason(raw?: string): { chip: string; text: string } {
  if (!raw) return { chip: "", text: "" };
  const chip = REASONS.find((r) => raw === r || raw.startsWith(r + " — "));
  if (chip) return { chip, text: raw.slice(chip.length).replace(/^\s—\s/, "") };
  return { chip: "", text: raw };
}
function joinReason(r: Row): string {
  const text = r.text.trim();
  return r.chip && text ? `${r.chip} — ${text}` : r.chip || text;
}
const stateLabel = (s: StageState) => STATES.find((x) => x.value === s)!.label;

export function CheckinForm({ token, projectId, projectName, dateLabel, stages, sentToday }: { token: string; projectId: string; projectName: string; dateLabel: string; stages: FormStage[]; sentToday: boolean }) {
  const initial = useMemo(() => Object.fromEntries(stages.map((s) => [s.id, { state: s.state, percent: s.percent }])), [stages]);
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(stages.map((s) => [s.id, { state: s.state, percent: s.percent, ...splitReason(s.blockedReason) }])),
  );
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [note, setNote] = useState("");
  const [geo, setGeo] = useState<Geo>(null);
  const [geoState, setGeoState] = useState<"waiting" | "ok" | "unavailable">(() => (typeof navigator !== "undefined" && !navigator.geolocation ? "unavailable" : "waiting"));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [queued, setQueued] = useState<QueuedCheckin | null>(null);
  const [done, setDone] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const topError = useRef<HTMLDivElement>(null);

  // Location is captured silently (internal proof of the site visit). Absent API or denied permission is fine.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    let cancelled = false;
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => { if (!cancelled) { setGeo({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); setGeoState("ok"); } },
        () => { if (!cancelled) setGeoState("unavailable"); },
        { enableHighAccuracy: false, timeout: 12_000, maximumAge: 120_000 },
      );
    } catch { Promise.resolve().then(() => { if (!cancelled) setGeoState("unavailable"); }); }
    return () => { cancelled = true; };
  }, []);

  // Release object URLs when the screen closes.
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const setRow = (id: string, patch: Partial<Row>) => {
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
    setErrors((e) => { if (!e[id]) return e; const n = { ...e }; delete n[id]; return n; });
  };

  const addPhotos = useCallback(async (stageId: string, files: FileList | null) => {
    if (!files) return;
    const list = Array.from(files);
    const room = MAX_PHOTOS - photos.length;
    if (list.length > room) setErrors((e) => ({ ...e, [`photo-${stageId}`]: `Up to ${MAX_PHOTOS} photos per update. ${room > 0 ? `Only the first ${room} were added.` : "Remove one to add another."}` }));
    // Process one at a time: gentle on memory for cheap phones.
    for (const file of list.slice(0, Math.max(0, room))) {
      const key = newId();
      const takenAt = new Date().toISOString();
      setPhotos((p) => [...p, { key, stageId, status: "preparing", width: 0, height: 0, takenAt }]);
      try {
        const prepared = await preparePhoto(file);
        const preview = URL.createObjectURL(prepared.blob);
        previews.current.push(preview);
        setPhotos((p) => p.map((x) => (x.key === key ? { ...x, status: "ready", file, blob: prepared.blob, width: prepared.width, height: prepared.height, preview } : x)));
      } catch {
        setPhotos((p) => p.map((x) => (x.key === key ? { ...x, status: "error", error: "This photo could not be read" } : x)));
      }
    }
  }, [photos.length]);

  const removePhoto = (key: string) => setPhotos((p) => p.filter((x) => x.key !== key));

  // What will be sent: stages the supervisor changed, plus anything already working/blocked (daily confirmation).
  const updates = useMemo(() => {
    const out: { stageId: string; state: StageState; percent?: number; blockedReason?: string }[] = [];
    for (const s of stages) {
      const r = rows[s.id];
      const init = initial[s.id];
      // Changed stages, plus anything working/blocked (the daily "still working / still blocked" confirmation).
      if (r.state === init.state && r.state !== "working" && r.state !== "blocked") continue;
      const u: { stageId: string; state: StageState; percent?: number; blockedReason?: string } = { stageId: s.id, state: r.state };
      if (r.state === "working" || r.state === "blocked") u.percent = r.percent;
      if (r.state === "blocked") u.blockedReason = joinReason(r);
      out.push(u);
    }
    return out;
  }, [rows, stages, initial]);

  const ready = photos.filter((p) => p.status === "ready");
  const preparing = photos.some((p) => p.status === "preparing");
  const lines = useMemo(() => {
    const l: string[] = [];
    for (const u of updates) {
      const name = stages.find((s) => s.id === u.stageId)!.name;
      l.push(`${name}: ${stateLabel(u.state)}${u.percent !== undefined && u.state !== "not_started" ? ` ${u.percent}%` : ""}${u.blockedReason ? ` (${u.blockedReason})` : ""}`);
    }
    if (ready.length) l.push(`${ready.length} photo${ready.length === 1 ? "" : "s"}`);
    if (note.trim()) l.push(`Note: ${note.trim().slice(0, 80)}${note.trim().length > 80 ? "…" : ""}`);
    l.push(geoState === "ok" ? "Site location: captured" : geoState === "waiting" ? "Site location: getting it…" : "Site location: not available");
    return l;
  }, [updates, ready.length, note, geoState, stages]);

  const summary = [
    `${updates.length} stage${updates.length === 1 ? "" : "s"}`,
    `${ready.length} photo${ready.length === 1 ? "" : "s"}`,
    note.trim() ? "note" : null,
    geoState === "ok" ? "location" : null,
  ].filter(Boolean).join(" · ");

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    for (const s of stages) {
      const r = rows[s.id];
      if (r.state === "working" && r.percent < 10) e[s.id] = "Tap how much is done (10% to 90%).";
      if (r.state === "blocked" && joinReason(r).length < 3) e[s.id] = "Tell us why it is blocked: tap a reason or type one.";
    }
    return e;
  }

  async function attempt(item: QueuedCheckin) {
    setSending(true); setSendError("");
    const r = await sendQueued(item);
    setSending(false);
    if (r.ok) { await removeOutbox(item.id); setQueued(null); setDone(true); window.scrollTo(0, 0); return; }
    setSendError(r.message);
    if (r.retry) setQueued(item);
    else { await removeOutbox(item.id); setQueued(null); }
  }

  async function send() {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      const firstId = stages.find((s) => e[s.id])?.id;
      const el = firstId ? document.getElementById(`stage-${firstId}`) : null;
      if (el) el.scrollIntoView({ block: "center" });
      return;
    }
    if (!updates.length && !ready.length && !note.trim()) { setSendError("Add at least one stage update, photo or note first."); return; }
    // Keep the whole upload under the host's request-size limit (re-encodes smaller only when needed).
    setSending(true); setSendError("");
    let fitted;
    try {
      fitted = await fitToBudget(ready.map((p) => ({ source: p.file ?? p.blob!, blob: p.blob!, width: p.width, height: p.height })), preparePhoto);
    } catch (err) {
      setSending(false);
      setSendError(err instanceof BudgetError ? "These photos are too large to send together. Remove a few and try again." : "Could not prepare the photos. Please try again.");
      return;
    }
    const item: QueuedCheckin = {
      id: newId(),
      token,
      projectId,
      projectName,
      submittedAt: new Date().toISOString(),
      updates,
      note: note.trim(),
      location: geo,
      photos: ready.map((p, i) => ({ blob: fitted[i].blob, stageId: p.stageId, takenAt: p.takenAt, width: fitted[i].width, height: fitted[i].height })),
      summary,
    };
    await putOutbox(item); // saved on the phone BEFORE the first attempt
    await attempt(item);
  }

  if (done) {
    return (
      <main className="wrap stack">
        <div className="banner ok" role="status" data-testid="sent-ok"><strong>Sent ✓</strong> The studio will review it and publish it to the client.</div>
        <Link className="btn primary block" href={`/s/${token}`}>Back to sites</Link>
      </main>
    );
  }

  return (
    <>
      <main className="wrap has-bar stack" data-testid="checkin-form">
        <div>
          <Link href={`/s/${token}`} className="backlink">← All sites</Link>
          <h1 style={{ marginTop: 6 }}>{projectName}</h1>
          <p className="muted">{dateLabel} · daily check-in</p>
        </div>
        {sentToday && <div className="banner warn">You already sent an update today. You can send another if something changed.</div>}

        {stages.map((s) => {
          const r = rows[s.id];
          const sp = photos.filter((p) => p.stageId === s.id);
          return (
            <section key={s.id} id={`stage-${s.id}`} className="card stage" aria-label={s.name} data-testid={`stage-${s.id}`}>
              <div className="stage-head">
                <h2 style={{ margin: 0 }}>{s.name}</h2>
              </div>
              <div className="seg" role="group" aria-label={`${s.name} status`}>
                {STATES.map((o) => (
                  <button key={o.value} type="button" className={`s-${o.value}`} aria-pressed={r.state === o.value} onClick={() => setRow(s.id, o.value === "done" ? { state: o.value, percent: 100 } : o.value === "not_started" ? { state: o.value, percent: 0 } : { state: o.value })} data-testid={`state-${s.id}-${o.value}`}>
                    {o.label}
                  </button>
                ))}
              </div>

              {(r.state === "working" || r.state === "blocked") && (
                <div>
                  <span className="field-label">How much is done?{r.percent > 0 && !PERCENTS.includes(r.percent) ? ` (last report: ${r.percent}%)` : ""}</span>
                  <div className="chips" role="group" aria-label="Percent done">
                    {PERCENTS.map((p) => (
                      <button key={p} type="button" className="chip" aria-pressed={r.percent === p} onClick={() => setRow(s.id, { percent: p })} data-testid={`pct-${s.id}-${p}`}>{p}%</button>
                    ))}
                  </div>
                </div>
              )}

              {r.state === "blocked" && (
                <div>
                  <span className="field-label">Why is it blocked? (required)</span>
                  <div className="chips" role="group" aria-label="Reason">
                    {REASONS.map((x) => (
                      <button key={x} type="button" className="chip reason" aria-pressed={r.chip === x} onClick={() => setRow(s.id, { chip: r.chip === x ? "" : x })} data-testid={`reason-${s.id}-${REASONS.indexOf(x)}`}>{x}</button>
                    ))}
                  </div>
                  <label className="field-label" htmlFor={`rt-${s.id}`}>Other details (optional)</label>
                  <input id={`rt-${s.id}`} className="input" value={r.text} maxLength={150} onChange={(e) => setRow(s.id, { text: e.target.value })} placeholder="e.g. plywood coming Monday" />
                </div>
              )}
              {errors[s.id] && <p className="err" role="alert" data-testid={`error-${s.id}`}>{errors[s.id]}</p>}

              <div className="thumbs">
                {sp.map((p) => (
                  <div className="thumbcol" key={p.key} data-testid="photo-thumb-form">
                    <div className="thumb">
                      {p.preview ? <img src={p.preview} alt={`Photo for ${s.name}`} /> : <span className="tiny muted" style={{ padding: 6, display: "block" }}>{p.status === "error" ? "Failed" : "Preparing…"}</span>}
                    </div>
                    <button type="button" className="rm" aria-label={`Remove photo for ${s.name}`} onClick={() => removePhoto(p.key)}>Remove</button>
                  </div>
                ))}
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <label className="btn small filebtn" data-testid={`add-photo-${s.id}`}>
                  📷 Add photo
                  <input type="file" accept="image/*" multiple data-testid={`photo-input-${s.id}`} onChange={(e) => { void addPhotos(s.id, e.target.files); e.target.value = ""; }} />
                </label>
              </div>
              {errors[`photo-${s.id}`] && <p className="err" role="alert">{errors[`photo-${s.id}`]}</p>}
            </section>
          );
        })}

        <section className="card">
          <label className="field-label" htmlFor="note" style={{ marginTop: 0 }}>Note for the studio (optional)</label>
          <AutoTextarea id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Type or use your keyboard's mic. Hindi / Hinglish is fine." data-testid="note" />
          <p className="note">This note stays with the studio. The client does not see it.</p>
        </section>
        <div ref={topError} />
      </main>

      <div className="sendbar" data-testid="sendbar">
        <div className="sendbar-inner">
          {sendError && <div className={`banner ${queued ? "warn" : "bad"}`} role="alert" data-testid="send-error" style={{ marginBottom: 8 }}>{sendError}</div>}
          <div className="summary" data-testid="send-summary">
            Sending: <strong>{summary}</strong>{" "}
            <button type="button" onClick={() => setShowDetail((v) => !v)} aria-expanded={showDetail}>{showDetail ? "Hide details" : "See exactly what is sent"}</button>
          </div>
          {showDetail && <ul data-testid="send-detail">{lines.map((l) => <li key={l}>{l}</li>)}</ul>}
          {queued ? (
            <div className="row">
              <button type="button" className="btn primary grow" onClick={() => attempt(queued)} disabled={sending} data-testid="retry">{sending ? "Sending…" : "Retry sending"}</button>
            </div>
          ) : (
            <button type="button" className="btn primary block" onClick={send} disabled={sending || preparing} data-testid="send">
              {sending ? "Sending…" : preparing ? "Preparing photos…" : "Send update"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
