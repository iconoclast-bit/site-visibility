"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorText, sendJson } from "@/lib/clientApi";

export function ProjectSettings({ token, projectId, initial }: { token: string; projectId: string; initial: { showcase: boolean; homeType: string; style: string; clientPhone: string } }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await sendJson(`/api/projects/${encodeURIComponent(projectId)}`, "PATCH", { token, ...f });
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: "Saved ✓" } : { ok: false, text: errorText(r.data) });
    if (r.ok) router.refresh();
  }

  return (
    <section className="card" aria-labelledby="set-h" data-testid="project-settings">
      <h2 id="set-h">Settings</h2>
      <form onSubmit={save} className="stack-sm">
        <label className="radio consent">
          <input type="checkbox" checked={f.showcase} onChange={(e) => setF({ ...f, showcase: e.target.checked })} data-testid="set-showcase" />
          <span><strong>Feature this home on the inspiration feed.</strong> Only with the client&apos;s permission. Other clients see the photos you pick, labelled only with the home type and style, plus whether this home has an AMC (once finished it also appears in the finished-homes gallery). Turning it off removes everything at once.</span>
        </label>
        <div className="grid cols-2">
          <div><label className="field-label" htmlFor="set-type" style={{ marginTop: 0 }}>Home type</label><input id="set-type" className="input" value={f.homeType} maxLength={20} onChange={(e) => setF({ ...f, homeType: e.target.value })} placeholder="3BHK" /></div>
          <div><label className="field-label" htmlFor="set-style" style={{ marginTop: 0 }}>Design style</label><input id="set-style" className="input" value={f.style} maxLength={40} onChange={(e) => setF({ ...f, style: e.target.value })} placeholder="Modern minimal" /></div>
        </div>
        <div><label className="field-label" htmlFor="set-phone">Client WhatsApp number</label><input id="set-phone" className="input" inputMode="tel" value={f.clientPhone} onChange={(e) => setF({ ...f, clientPhone: e.target.value })} placeholder="919876543210" /></div>
        <div className="row"><button type="submit" className="btn primary small" disabled={busy} data-testid="set-save">{busy ? "Saving…" : "Save settings"}</button>{msg && <span className={msg.ok ? "small" : "err"} role="status">{msg.text}</span>}</div>
      </form>
    </section>
  );
}
