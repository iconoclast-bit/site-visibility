"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { listOutbox, removeOutbox, sendQueued, type QueuedCheckin } from "@/lib/outbox";

/** Shows updates saved on this phone that have not reached the studio yet, and re-sends them. */
export function OutboxBanner({ token }: { token: string }) {
  const router = useRouter();
  const [items, setItems] = useState<QueuedCheckin[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => setItems(await listOutbox(token)), [token]);
  const flush = useCallback(async () => {
    setBusy(true); setMsg("");
    let sent = 0;
    for (const it of await listOutbox(token)) {
      const r = await sendQueued(it);
      if (r.ok) { await removeOutbox(it.id); sent += 1; }
      else { setMsg(r.message); if (!r.retry) await removeOutbox(it.id); break; }
    }
    setBusy(false);
    await refresh();
    if (sent) router.refresh();
  }, [token, refresh, router]);

  useEffect(() => {
    let alive = true;
    listOutbox(token).then((list) => { if (alive) setItems(list); });
    const online = () => { void flush(); };
    window.addEventListener("online", online);
    return () => { alive = false; window.removeEventListener("online", online); };
  }, [token, flush]);

  if (!items.length) return null;
  return (
    <div className="banner warn stack-sm" role="alert" data-testid="outbox-banner">
      <div><strong>{items.length} update{items.length === 1 ? "" : "s"} saved on this phone, not sent yet.</strong> {items.map((i) => i.projectName).join(", ")}</div>
      {msg && <div>{msg}</div>}
      <button type="button" className="btn primary small" onClick={flush} disabled={busy} data-testid="outbox-retry">{busy ? "Sending…" : "Send now"}</button>
    </div>
  );
}
