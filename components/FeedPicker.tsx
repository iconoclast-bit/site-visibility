"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorText, sendJson } from "@/lib/clientApi";

export interface PickPhoto { fileName: string; url: string; alt: string }

/** Choose which photos of an update appear on the inspiration feed (controlled; used while approving). */
export function FeedPicker({ photos, selected, onSelected, caption, onCaption, idPrefix }: { photos: PickPhoto[]; selected: string[]; onSelected: (s: string[]) => void; caption: string; onCaption: (c: string) => void; idPrefix: string }) {
  const toggle = (f: string) => onSelected(selected.includes(f) ? selected.filter((x) => x !== f) : [...selected, f]);
  return (
    <fieldset className="feedpick" data-testid="feed-picker">
      <legend className="field-label" style={{ marginTop: 0 }}>Share on the inspiration feed (optional)</legend>
      <p className="note" style={{ margin: "0 0 6px" }}>Tick the photos other clients may see. Check that nothing personal is visible (people, nameplates, valuables).</p>
      <div className="pickgrid">
        {photos.map((p, i) => (
          <label key={p.fileName} className={`pick ${selected.includes(p.fileName) ? "on" : ""}`}>
            <img src={p.url} alt={p.alt} />
            <span className="pickrow"><input type="checkbox" checked={selected.includes(p.fileName)} onChange={() => toggle(p.fileName)} data-testid={`${idPrefix}-pick-${i}`} /> Share</span>
          </label>
        ))}
      </div>
      <label className="field-label" htmlFor={`${idPrefix}-cap`}>Caption (optional, shown with the photos)</label>
      <input id={`${idPrefix}-cap`} className="input" value={caption} maxLength={200} onChange={(e) => onCaption(e.target.value)} placeholder="e.g. Warm wood tones with a matte finish" data-testid={`${idPrefix}-caption`} />
    </fieldset>
  );
}

/** Same picker for an already-published update, with its own Save. */
export function PublishedFeedEditor({ token, checkinId, photos, initialSelected, initialCaption }: { token: string; checkinId: string; photos: PickPhoto[]; initialSelected: string[]; initialCaption: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState(initialSelected);
  const [caption, setCaption] = useState(initialCaption);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true); setMsg(null);
    const r = await sendJson(`/api/checkins/${encodeURIComponent(checkinId)}/showcase`, "POST", { token, fileNames: selected, caption });
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: selected.length ? `${selected.length} on the feed ✓` : "Removed from the feed ✓" } : { ok: false, text: errorText(r.data) });
    if (r.ok) router.refresh();
  }

  return (
    <details style={{ marginTop: 8 }} data-testid="published-feed-editor">
      <summary className="small strong" style={{ minHeight: 44, display: "flex", alignItems: "center", cursor: "pointer" }}>Inspiration feed · {initialSelected.length} shared</summary>
      <FeedPicker photos={photos} selected={selected} onSelected={setSelected} caption={caption} onCaption={setCaption} idPrefix={`pub-${checkinId}`} />
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="btn small" onClick={save} disabled={busy} data-testid="feed-save">{busy ? "Saving…" : "Save feed selection"}</button>
        {msg && <span className={msg.ok ? "small" : "err"} role="status">{msg.text}</span>}
      </div>
    </details>
  );
}
