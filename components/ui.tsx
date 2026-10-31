import type { ReactNode } from "react";
import { HEALTH_LABEL, type Health } from "@/lib/schedule";

export function TopBar({ title, role }: { title: string; role: string }) {
  return (
    <header className="topbar">
      <span className="brand">{title}</span>
      <span className="role-pill">{role}</span>
    </header>
  );
}

export function HealthBadge({ health }: { health: Health }) {
  const icon = health === "ok" ? "✓" : health === "warn" ? "!" : "⚠";
  return <span className={`badge ${health}`} data-testid="health">{icon} {HEALTH_LABEL[health]}</span>;
}

export function ProgressBar({ percent, tone, label }: { percent: number; tone?: Health; label?: string }) {
  return (
    <div className={`bar ${tone ?? ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label ?? "Progress"}>
      <i style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </div>
  );
}

export function Kpi({ value, label, tone, testId }: { value: ReactNode; label: string; tone?: Health; testId?: string }) {
  return (
    <div className={`kpi ${tone ?? ""}`} data-testid={testId}>
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <main className="wrap">
      <div className="card muted" role="status">{label}</div>
    </main>
  );
}
