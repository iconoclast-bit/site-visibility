"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorText, sendJson } from "@/lib/clientApi";

export interface AmcForm { plan: string; startsOn: "handover" | "date"; startDate: string; months: number; visits: number; coverage: string; purchasedOn: string }
export interface AmcSummary { statusLabel: string; tone: "ok" | "warn" | "bad" | "info"; line: string; visits: string; next: string | null; log: { date: string; note: string }[] }

const BLANK: AmcForm = { plan: "Gold AMC", startsOn: "handover", startDate: "", months: 12, visits: 4, coverage: "4 scheduled service visits a year\nCarpentry and hinge adjustments\nPaint touch-ups for small marks\nPriority response within 48 hours", purchasedOn: "" };

export function AmcEditor({ token, projectId, today, form, summary }: { token: string; projectId: string; today: string; form: AmcForm | null; summary: AmcSummary | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState<AmcForm>(form ?? { ...BLANK, startDate: today });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [visit, setVisit] = useState({ date: today, note: "" });

  const url = `/api/projects/${encodeURIComponent(projectId)}/amc`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const amc = { plan: f.plan, startsOn: f.startsOn === "handover" ? "handover" : f.startDate, months: Number(f.months), visits: Number(f.visits), coverage: f.coverage, purchasedOn: f.purchasedOn || undefined };
    const r = await sendJson(url, "PUT", { token, amc });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: errorText(r.data) });
    setEditing(false); setMsg({ ok: true, text: "AMC saved ✓" });
    router.refresh();
  }

  async function remove() {
    if (!confirmRemove) { setConfirmRemove(true); return; }
    setBusy(true);
    const r = await sendJson(url, "PUT", { token, amc: null });
    setBusy(false); setConfirmRemove(false);
    if (!r.ok) return setMsg({ ok: false, text: errorText(r.data) });
    setEditing(false); router.refresh();
  }

  async function logVisit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await sendJson(`${url}/visits`, "POST", { token, ...visit });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: errorText(r.data) });
    setVisit({ date: today, note: "" }); setMsg({ ok: true, text: "Visit logged ✓ The client can see it." });
    router.refresh();
  }

  return (
    <section className="card" aria-labelledby="amc-h" data-testid="amc-editor">
      <div className="row between">
        <h2 id="amc-h" style={{ margin: 0 }}>AMC</h2>
        {summary && <span className={`badge ${summary.tone}`} data-testid="owner-amc-status">{summary.statusLabel}</span>}
      </div>

      {summary && !editing && (
        <div style={{ marginTop: 8 }}>
          <p className="small" style={{ margin: 0 }} data-testid="owner-amc-line">{summary.line}</p>
          <p className="small muted" style={{ margin: "2px 0 0" }}>{summary.visits}{summary.next ? ` · ${summary.next}` : ""}</p>
        </div>
      )}
      {!summary && !editing && <p className="muted small">This client has not bought an AMC. The AMC card only appears on the client&apos;s page once you add one.</p>}

      {!editing && <div className="row" style={{ marginTop: 10 }}><button type="button" className="btn small" onClick={() => setEditing(true)} data-testid="amc-edit">{summary ? "Edit AMC" : "Add AMC"}</button></div>}

      {editing && (
        <form onSubmit={save} className="stack-sm" style={{ marginTop: 10 }} data-testid="amc-form">
          <div><label className="field-label" htmlFor="amc-plan" style={{ marginTop: 0 }}>Plan name</label><input id="amc-plan" className="input" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} maxLength={60} required data-testid="amc-plan" /></div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label" style={{ marginTop: 0 }}>Starts</legend>
            <label className="radio"><input type="radio" name="amc-start" checked={f.startsOn === "handover"} onChange={() => setF({ ...f, startsOn: "handover" })} data-testid="amc-start-handover" /> At handover (the day after the last stage is done)</label>
            <label className="radio"><input type="radio" name="amc-start" checked={f.startsOn === "date"} onChange={() => setF({ ...f, startsOn: "date" })} data-testid="amc-start-date" /> On a date</label>
            {f.startsOn === "date" && <input type="date" className="input" style={{ marginTop: 6 }} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} aria-label="AMC start date" data-testid="amc-start-input" required />}
          </fieldset>
          <div className="grid cols-2">
            <div><label className="field-label" htmlFor="amc-months" style={{ marginTop: 0 }}>Term (months)</label><input id="amc-months" type="number" inputMode="numeric" min={1} max={60} className="input" value={f.months} onChange={(e) => setF({ ...f, months: Number(e.target.value) })} data-testid="amc-months" /></div>
            <div><label className="field-label" htmlFor="amc-visits" style={{ marginTop: 0 }}>Included visits</label><input id="amc-visits" type="number" inputMode="numeric" min={0} max={60} className="input" value={f.visits} onChange={(e) => setF({ ...f, visits: Number(e.target.value) })} data-testid="amc-visits-input" /></div>
          </div>
          <div><label className="field-label" htmlFor="amc-cov" style={{ marginTop: 0 }}>What is covered (one per line, shown to the client)</label><textarea id="amc-cov" className="textarea" style={{ minHeight: 110, resize: "vertical", overflow: "auto" }} value={f.coverage} onChange={(e) => setF({ ...f, coverage: e.target.value })} data-testid="amc-coverage" /></div>
          <div><label className="field-label" htmlFor="amc-bought" style={{ marginTop: 0 }}>Bought on (optional)</label><input id="amc-bought" type="date" className="input" value={f.purchasedOn} onChange={(e) => setF({ ...f, purchasedOn: e.target.value })} /></div>
          <div className="row">
            <button type="submit" className="btn primary small" disabled={busy} data-testid="amc-save">{busy ? "Saving…" : "Save AMC"}</button>
            <button type="button" className="btn small" onClick={() => { setEditing(false); setConfirmRemove(false); }}>Cancel</button>
            {summary && <button type="button" className="btn small danger" onClick={remove} disabled={busy} data-testid="amc-remove">{confirmRemove ? "Tap again to remove" : "Remove AMC"}</button>}
          </div>
        </form>
      )}

      {summary && !editing && (
        <>
          <h3 style={{ marginTop: 16 }}>Service visits</h3>
          {summary.log.length === 0 && <p className="muted small">No visits logged yet.</p>}
          {summary.log.map((x) => <div className="update" key={x.date + x.note}><div className="when">{x.date}</div><div className="small">{x.note}</div></div>)}
          <form onSubmit={logVisit} className="stack-sm" style={{ marginTop: 10 }} data-testid="visit-form">
            <label className="field-label" htmlFor="visit-date" style={{ marginTop: 0 }}>Log a completed visit</label>
            <input id="visit-date" type="date" className="input" value={visit.date} max={today} onChange={(e) => setVisit({ ...visit, date: e.target.value })} required data-testid="visit-date" />
            <input className="input" value={visit.note} onChange={(e) => setVisit({ ...visit, note: e.target.value })} placeholder="What was done (the client sees this)" maxLength={400} aria-label="What was done" data-testid="visit-note" />
            <div><button type="submit" className="btn small" disabled={busy || visit.note.trim().length < 3} data-testid="visit-add">Log visit</button></div>
          </form>
        </>
      )}
      {msg && <p className={msg.ok ? "small" : "err"} role="status" style={{ marginTop: 8 }} data-testid="amc-msg">{msg.text}</p>}
    </section>
  );
}
