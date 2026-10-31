import { addDays, diffDays, fmtShort } from "@/lib/dates";
import type { TimelineRow } from "@/lib/schedule";

const STATE_LABEL = { not_started: "Not started", working: "In progress", blocked: "On hold", done: "Done" } as const;

/** Planned vs expected bars on one date axis, with a Today marker. Pure CSS positioning (no aspect-ratio/inset). */
export function Timeline({ rows, axisStart, axisEnd, today }: { rows: TimelineRow[]; axisStart: string; axisEnd: string; today: string }) {
  const total = diffDays(axisEnd, axisStart) + 1;
  const pos = (d: string) => (diffDays(d, axisStart) / total) * 100;
  const width = (a: string, b: string) => ((diffDays(b, a) + 1) / total) * 100;
  const step = Math.max(7, Math.ceil(total / 6 / 7) * 7);
  const ticks: string[] = [];
  for (let d = axisStart; diffDays(d, axisEnd) <= 0; d = addDays(d, step)) ticks.push(d);
  const todayPos = pos(today);

  return (
    <div className="tl" data-testid="timeline">
      <div className="tl-axis" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} style={{ left: `${pos(t) + 100 / total / 2}%` }}>{fmtShort(t)}</span>
        ))}
        <span className="today" style={{ left: `${todayPos + 100 / total / 2}%`, top: 11 }}>Today</span>
      </div>
      {rows.map((r) => (
        <div className="tl-row" key={r.id}>
          <div>
            <div className="tl-name">{r.name} <span className="muted small">· {STATE_LABEL[r.state]}{r.state === "working" || r.state === "blocked" ? ` ${r.percent}%` : ""}</span></div>
            <div className="tl-dates">Planned {fmtShort(r.planned.start)}–{fmtShort(r.planned.end)} · Expected {fmtShort(r.expected.start)}–{fmtShort(r.expected.end)}</div>
          </div>
          <div className="tl-track" role="img" aria-label={`${r.name}: planned ${fmtShort(r.planned.start)} to ${fmtShort(r.planned.end)}, expected ${fmtShort(r.expected.start)} to ${fmtShort(r.expected.end)}`}>
            <div className="tl-planned" style={{ left: `${pos(r.planned.start)}%`, width: `${width(r.planned.start, r.planned.end)}%` }} />
            <div className={`tl-exp ${r.state}`} style={{ left: `${pos(r.expected.start)}%`, width: `${width(r.expected.start, r.expected.end)}%` }} />
            <div className="tl-today" style={{ left: `${todayPos + 100 / total / 2}%` }} />
          </div>
        </div>
      ))}
      <div className="legend" aria-hidden="true">
        <span><i style={{ background: "#c9c4b8" }} />Planned</span>
        <span><i style={{ background: "var(--ok)" }} />Done</span>
        <span><i style={{ background: "var(--info)" }} />In progress</span>
        <span><i style={{ background: "var(--bad)" }} />On hold</span>
        <span><i style={{ border: "2px dashed var(--idle)" }} />Expected</span>
        <span><i style={{ width: 0, height: 12, borderRadius: 0, borderLeft: "2px solid #d64533" }} />Today</span>
      </div>
    </div>
  );
}
