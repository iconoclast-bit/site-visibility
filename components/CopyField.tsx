"use client";

import { useState, useSyncExternalStore } from "react";
import { copyText } from "@/lib/clipboard";

/** A read-only link with a Copy button (execCommand fallback built in). `path` is resolved against the current origin. */
export function CopyField({ label, path, testId }: { label: string; path: string; testId?: string }) {
  const origin = useSyncExternalStore(() => () => {}, () => window.location.origin, () => "");
  const [state, setState] = useState<"" | "ok" | "failed">("");
  const url = origin + path;
  return (
    <div>
      <label className="field-label" style={{ marginTop: 8 }}>{label}</label>
      <div className="copyrow">
        <input className="input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} data-testid={testId} aria-label={label} />
        <button type="button" className="btn" onClick={async () => { setState((await copyText(url)) ? "ok" : "failed"); window.setTimeout(() => setState(""), 2500); }}>{state === "ok" ? "Copied ✓" : "Copy"}</button>
      </div>
      {state === "failed" && <p className="err" role="alert">Could not copy automatically. Select the link and copy it manually.</p>}
    </div>
  );
}
