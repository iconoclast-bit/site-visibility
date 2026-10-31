"use client";

import Link from "next/link";
import { useState } from "react";
import { errorText, sendJson } from "@/lib/clientApi";
import { CopyField } from "./CopyField";

const HOME_TYPES = ["1BHK", "2BHK", "3BHK", "4BHK", "Villa", "Office"];
const STYLES = ["Modern minimal", "Contemporary", "Scandinavian", "Classic warm", "Industrial", "Boho"];

export function NewProjectForm({ token, supervisors, today }: { token: string; supervisors: { id: string; name: string }[]; today: string }) {
  const [f, setF] = useState({ name: "", clientName: "", clientPhone: "", address: "", locality: "", homeType: "", style: "", startDate: today, showcase: false });
  const [sup, setSup] = useState<string>(supervisors[0]?.id ?? "new");
  const [newSup, setNewSup] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ id: string; clientToken: string; supervisorToken?: string } | null>(null);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const body = { token, ...f, ...(sup === "new" ? { newSupervisorName: newSup } : { supervisorId: sup }) };
    const r = await sendJson("/api/projects", "POST", body);
    setBusy(false);
    if (!r.ok) return setError(errorText(r.data));
    setDone(r.data as { id: string; clientToken: string; supervisorToken?: string });
  }

  if (done) {
    return (
      <div className="card stack" data-testid="project-created">
        <div className="banner ok" role="status"><strong>Project created ✓</strong> Share these links. The links are secrets: whoever has one can use it.</div>
        <CopyField label="Client link (read-only)" path={`/c/${done.clientToken}`} testId="created-client-link" />
        {done.supervisorToken && <CopyField label="New supervisor link" path={`/s/${done.supervisorToken}`} testId="created-supervisor-link" />}
        <div className="row"><Link className="btn primary" href={`/a/${token}/${done.id}`} data-testid="open-new-project">Open project</Link><Link className="btn" href={`/a/${token}`}>All projects</Link></div>
      </div>
    );
  }

  return (
    <form className="card stack" onSubmit={submit} data-testid="new-project-form">
      <div>
        <label className="field-label" htmlFor="np-name" style={{ marginTop: 0 }}>Project name</label>
        <input id="np-name" className="input" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Rao 3BHK" maxLength={60} required data-testid="np-name" />
      </div>
      <div>
        <label className="field-label" htmlFor="np-client" style={{ marginTop: 0 }}>Client name</label>
        <input id="np-client" className="input" value={f.clientName} onChange={(e) => set("clientName", e.target.value)} maxLength={60} required data-testid="np-client" />
      </div>
      <div>
        <label className="field-label" htmlFor="np-phone" style={{ marginTop: 0 }}>Client WhatsApp number (optional)</label>
        <input id="np-phone" className="input" inputMode="tel" value={f.clientPhone} onChange={(e) => set("clientPhone", e.target.value)} placeholder="919876543210" />
      </div>
      <div>
        <label className="field-label" htmlFor="np-address" style={{ marginTop: 0 }}>Site address (only you and the supervisor see it)</label>
        <input id="np-address" className="input" value={f.address} onChange={(e) => set("address", e.target.value)} maxLength={200} required data-testid="np-address" />
      </div>
      <div>
        <label className="field-label" htmlFor="np-locality" style={{ marginTop: 0 }}>Locality (optional)</label>
        <input id="np-locality" className="input" value={f.locality} onChange={(e) => set("locality", e.target.value)} maxLength={100} />
      </div>
      <div className="grid cols-2">
        <div>
          <label className="field-label" htmlFor="np-type" style={{ marginTop: 0 }}>Home type</label>
          <input id="np-type" className="input" list="home-types" value={f.homeType} onChange={(e) => set("homeType", e.target.value)} placeholder="3BHK" maxLength={20} />
          <datalist id="home-types">{HOME_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
        </div>
        <div>
          <label className="field-label" htmlFor="np-style" style={{ marginTop: 0 }}>Design style</label>
          <input id="np-style" className="input" list="styles" value={f.style} onChange={(e) => set("style", e.target.value)} placeholder="Modern minimal" maxLength={40} />
          <datalist id="styles">{STYLES.map((t) => <option key={t} value={t} />)}</datalist>
        </div>
      </div>
      <div>
        <label className="field-label" htmlFor="np-start" style={{ marginTop: 0 }}>Start date</label>
        <input id="np-start" type="date" className="input" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} required data-testid="np-start" />
      </div>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label" style={{ marginTop: 0 }}>Site supervisor</legend>
        {supervisors.map((s) => (
          <label key={s.id} className="radio"><input type="radio" name="sup" checked={sup === s.id} onChange={() => setSup(s.id)} /> {s.name}</label>
        ))}
        <label className="radio"><input type="radio" name="sup" checked={sup === "new"} onChange={() => setSup("new")} data-testid="np-sup-new" /> Add a new supervisor</label>
        {sup === "new" && <input className="input" style={{ marginTop: 6 }} value={newSup} onChange={(e) => setNewSup(e.target.value)} placeholder="Supervisor name" maxLength={60} aria-label="New supervisor name" data-testid="np-sup-name" />}
      </fieldset>

      <label className="radio consent">
        <input type="checkbox" checked={f.showcase} onChange={(e) => set("showcase", e.target.checked)} data-testid="np-showcase" />
        <span><strong>The client agrees to show progress photos of their home to other clients</strong> on the inspiration feed. No name or address is shown, and you choose which photos. You can change this later.</span>
      </label>

      {error && <p className="err" role="alert" data-testid="np-error">{error}</p>}
      <button type="submit" className="btn primary block" disabled={busy} data-testid="np-submit">{busy ? "Creating…" : "Create project"}</button>
    </form>
  );
}
