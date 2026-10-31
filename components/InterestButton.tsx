"use client";

import { useState } from "react";

/** "I'd like something like this": one tap tells the studio which look the client likes. */
export function InterestButton({ token, postId, initiallySent, label }: { token: string; postId: string; initiallySent: boolean; label: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(initiallySent ? "sent" : "idle");

  async function send() {
    setState("sending");
    try {
      const res = await fetch("/api/interests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, showcaseId: postId }) });
      setState(res.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") {
    return <p className="banner ok small" role="status" data-testid="interest-sent" style={{ margin: "10px 0 0" }}>✓ Sent to the studio. They will get in touch about a design like “{label}”.</p>;
  }
  return (
    <div style={{ marginTop: 10 }}>
      <button type="button" className="btn small" onClick={send} disabled={state === "sending"} data-testid="interest-btn">
        {state === "sending" ? "Sending…" : "💡 I'd like something like this"}
      </button>
      {state === "error" && <p className="err" role="alert">Could not send. Please check your connection and try again.</p>}
    </div>
  );
}
