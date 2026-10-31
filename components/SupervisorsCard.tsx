"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorText, sendJson } from "@/lib/clientApi";
import { CopyField } from "./CopyField";

export interface SupervisorRow { id: string; name: string; token: string; projects: number }

export function SupervisorsCard({ token, supervisors }: { token: string; supervisors: SupervisorRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const r = await sendJson("/api/supervisors", "POST", { token, name });
    setBusy(false);
    if (!r.ok) return setError(errorText(r.data));
    setCreated({ name: String(r.data.name), token: String(r.data.token) });
    setName("");
    router.refresh();
  }

  return (
    <section className="card" aria-labelledby="sup-h" data-testid="supervisors-card">
      <h2 id="sup-h">Site supervisors</h2>
      {supervisors.length === 0 && <p className="muted">No supervisors yet. Add one, then create a project for them.</p>}
      {supervisors.map((s) => (
        <details key={s.id} className="update" data-testid="supervisor-row">
          <summary className="strong" style={{ minHeight: 44, display: "flex", alignItems: "center", cursor: "pointer" }}>{s.name} <span className="muted small" style={{ marginLeft: 8 }}>{s.projects} {s.projects === 1 ? "site" : "sites"}</span></summary>
          <CopyField label={`${s.name}'s link`} path={`/s/${s.token}`} />
        </details>
      ))}
      <form onSubmit={add} className="row" style={{ marginTop: 10 }}>
        <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="New supervisor name" maxLength={60} aria-label="New supervisor name" data-testid="sup-name" style={{ width: "auto", flex: "1 1 180px" }} />
        <button type="submit" className="btn primary" disabled={busy || name.trim().length < 2} data-testid="sup-add">{busy ? "Adding…" : "Add supervisor"}</button>
      </form>
      {error && <p className="err" role="alert">{error}</p>}
      {created && <div className="banner ok" style={{ marginTop: 10 }} role="status" data-testid="sup-created"><strong>{created.name} added.</strong><CopyField label="Their link" path={`/s/${created.token}`} testId="sup-created-link" /></div>}
    </section>
  );
}
