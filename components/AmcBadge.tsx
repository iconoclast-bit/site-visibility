import type { AmcBadge as Badge } from "@/lib/feed";

/** Shows whether a featured home has an AMC. Anonymous: plan name and status only, never who or how much. */
export function AmcBadge({ amc }: { amc: Badge }) {
  if (!amc.has) return <span className="badge idle" data-testid="amc-badge" title="This home does not have an Annual Maintenance Contract">No AMC</span>;
  return (
    <span className="badge ok" data-testid="amc-badge" title="This home has an Annual Maintenance Contract">
      🛡 Has an AMC{amc.plan ? ` · ${amc.plan}` : ""}{amc.status ? ` · ${amc.status}` : ""}
    </span>
  );
}
