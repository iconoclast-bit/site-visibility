"use client";

import { useState, useSyncExternalStore } from "react";
import { copyText } from "@/lib/clipboard";

export function ShareBox({ clientPath, supervisorPath, firstName, projectName, phone }: { clientPath: string; supervisorPath: string; firstName: string; projectName: string; phone?: string }) {
  const origin = useSyncExternalStore(() => () => {}, () => window.location.origin, () => "");
  const [copied, setCopied] = useState<"" | "client" | "supervisor" | "failed">("");

  const clientUrl = origin + clientPath;
  const supervisorUrl = origin + supervisorPath;
  const text = `Hi ${firstName}, here is the live progress page for your ${projectName} renovation. You can check the latest site updates anytime: ${clientUrl}`;
  const wa = `https://wa.me/${phone ? phone.replace(/\D/g, "") : ""}?text=${encodeURIComponent(text)}`;

  async function copy(which: "client" | "supervisor") {
    const ok = await copyText(which === "client" ? clientUrl : supervisorUrl);
    setCopied(ok ? which : "failed");
    window.setTimeout(() => setCopied(""), 2500);
  }

  return (
    <section className="card" aria-labelledby="share-h" data-testid="share-box">
      <h2 id="share-h">Share</h2>
      <label className="field-label" htmlFor="client-link" style={{ marginTop: 0 }}>Client link (read-only)</label>
      <div className="copyrow">
        <input id="client-link" className="input" readOnly value={clientUrl} onFocus={(e) => e.currentTarget.select()} data-testid="client-link" />
        <button type="button" className="btn" onClick={() => copy("client")} data-testid="copy-client">{copied === "client" ? "Copied ✓" : "Copy"}</button>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <a className="btn primary" href={wa} target="_blank" rel="noopener noreferrer" data-testid="whatsapp">Send on WhatsApp</a>
      </div>
      <label className="field-label" htmlFor="sup-link">Supervisor link (for the site supervisor only)</label>
      <div className="copyrow">
        <input id="sup-link" className="input" readOnly value={supervisorUrl} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn" onClick={() => copy("supervisor")} data-testid="copy-supervisor">{copied === "supervisor" ? "Copied ✓" : "Copy"}</button>
      </div>
      {copied === "failed" && <p className="err" role="alert">Could not copy automatically. Select the link above and copy it manually.</p>}
    </section>
  );
}
