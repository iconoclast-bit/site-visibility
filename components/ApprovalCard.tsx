"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AutoTextarea } from "./AutoTextarea";
import { FeedPicker, type PickPhoto } from "./FeedPicker";
import { PhotoGrid, type GridPhoto } from "./PhotoGrid";

export interface ReportedStage { name: string; label: string; detail?: string }
export interface ApprovalItem {
  id: string;
  dateLabel: string;
  supervisor: string;
  stages: ReportedStage[];
  note: string;
  photos: GridPhoto[];
  location: { text: string; mapUrl: string } | null;
  draft: string;
  feed?: { photos: PickPhoto[] }; // present only when the project has inspiration-feed consent
}

export function ApprovalCard({ item, token, aiEnabled }: { item: ApprovalItem; token: string; aiEnabled: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState(item.draft);
  const [busy, setBusy] = useState<"" | "publish" | "ai">("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [published, setPublished] = useState(false);
  const [shared, setShared] = useState<string[]>(() => item.feed?.photos.map((p) => p.fileName) ?? []);
  const [caption, setCaption] = useState("");

  async function publish() {
    setBusy("publish"); setError(""); setInfo("");
    try {
      const res = await fetch(`/api/checkins/${encodeURIComponent(item.id)}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, message, ...(item.feed ? { showcase: { fileNames: shared, caption } } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { setPublished(true); router.refresh(); return; }
      if (res.status === 409) { setPublished(true); setInfo("This update was already published."); router.refresh(); return; }
      setError(body.error || `Could not publish (error ${res.status}). Please try again.`);
    } catch {
      setError("No connection. Your edits are still here: check the network and tap Approve & publish again.");
    } finally {
      setBusy("");
    }
  }

  async function rewrite() {
    setBusy("ai"); setError(""); setInfo("");
    try {
      const res = await fetch("/api/drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, checkinId: item.id }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || "AI rewrite is not available right now."); return; }
      setMessage(body.message);
      setInfo(body.warning || "Rewritten with AI. Please read it before publishing.");
    } catch {
      setError("Could not reach the AI rewrite service. The standard draft is unchanged.");
    } finally {
      setBusy("");
    }
  }

  if (published) {
    return <div className="card pq-card"><div className="banner ok" role="status" data-testid="published-banner">Published to the client ✓ {info}</div></div>;
  }

  return (
    <article className="card pq-card" data-testid="approval-card" aria-label={`Update from ${item.dateLabel} waiting for approval`}>
      <div className="row between">
        <h3>{item.dateLabel}</h3>
        <span className="badge warn">Waiting for approval</span>
      </div>
      <p className="muted small">Reported by {item.supervisor}</p>

      <ul className="statelist" data-testid="reported">
        {item.stages.map((s) => (
          <li key={s.name}><span className="strong">{s.name}</span>: {s.label}{s.detail ? <span className="muted"> · {s.detail}</span> : null}</li>
        ))}
      </ul>
      {item.note && <p className="small break" data-testid="supervisor-note"><span className="strong">Supervisor note:</span> {item.note}</p>}
      <p className="small muted" data-testid="location-proof">
        {item.location ? <>📍 Visit proof: <a href={item.location.mapUrl} target="_blank" rel="noopener noreferrer">{item.location.text}</a></> : "📍 No location was captured for this visit"}
      </p>
      <PhotoGrid photos={item.photos} />

      {item.feed && <FeedPicker photos={item.feed.photos} selected={shared} onSelected={setShared} caption={caption} onCaption={setCaption} idPrefix={`appr-${item.id}`} />}

      <label className="field-label" htmlFor={`msg-${item.id}`}>Message to the client (you can edit it)</label>
      <AutoTextarea id={`msg-${item.id}`} value={message} onChange={(e) => setMessage(e.target.value)} data-testid="client-message" />
      {error && <p className="err" role="alert">{error}</p>}
      {info && <p className="note" role="status">{info}</p>}
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="btn primary" onClick={publish} disabled={busy !== "" || !message.trim()} data-testid="approve">{busy === "publish" ? "Publishing…" : "Approve & publish"}</button>
        <button type="button" className="btn" onClick={() => { setMessage(item.draft); setInfo("Draft reset."); setError(""); }} disabled={busy !== ""} data-testid="reset-draft">Reset draft</button>
        {aiEnabled && <button type="button" className="btn" onClick={rewrite} disabled={busy !== ""} data-testid="rewrite-ai">{busy === "ai" ? "Rewriting…" : "Rewrite with AI"}</button>}
      </div>
    </article>
  );
}
