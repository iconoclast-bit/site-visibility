/**
 * The inspiration feed: progress photos from the studio's OTHER sites.
 *
 * Privacy by construction. A photo appears only if ALL of these hold:
 *  - its project has showcase consent switched on by the owner,
 *  - its check-in is approved (published),
 *  - the owner explicitly selected that photo for the feed,
 *  - it is not the viewing client's own project.
 * Posts carry no names, addresses, ids, notes, supervisor or GPS: only a generic
 * home label ("3BHK · Modern minimal"), the stage shown, a date, an owner-written
 * caption, and an opaque photo handle.
 */
import { fmtDate } from "./dates";
import { computeSchedule } from "./schedule";
import type { Checkin, ISODate, Project } from "./types";

export interface FeedPhoto { id: string; url: string; alt: string }
export interface FeedPost {
  id: string; // opaque: the first photo's handle
  label: string; // "3BHK · Modern minimal"
  stageNames: string[]; // "False ceiling", "Carpentry"
  progress: string; // "Completed" | "In progress · 60% done"
  dateLabel: string;
  caption: string;
  photos: FeedPhoto[];
}

export const FEED_LIMIT = 20;
/** At most this many posts per site, newest first, so one busy site cannot crowd out the others. */
export const PER_SITE_LIMIT = 5;

export function homeLabel(p: Pick<Project, "homeType" | "style">): string {
  return [p.homeType, p.style].filter((x) => x && x.trim()).join(" · ") || "Home renovation";
}

export function feedPhotoUrl(id: string, clientToken: string): string {
  return `/api/feed/${id}?t=${encodeURIComponent(clientToken)}`;
}

export function buildFeed(viewer: Project, projects: Project[], checkins: Checkin[], today: ISODate, limit = FEED_LIMIT): FeedPost[] {
  const posts: (FeedPost & { sort: string; pid: string })[] = [];
  for (const p of projects) {
    if (p.id === viewer.id || !p.showcase) continue;
    const mine = checkins.filter((c) => c.projectId === p.id);
    const approved = mine.filter((c) => c.review === "approved");
    for (const c of approved) {
      const shown = (c.showcase ?? []).filter((s) => c.photos.some((x) => x.fileName === s.fileName));
      if (!shown.length) continue;
      // Progress "as of" that post: only the approved check-ins up to and including it.
      const upTo = approved.filter((x) => x.date < c.date || (x.date === c.date && x.createdAt <= c.createdAt));
      const sched = computeSchedule(p, upTo, c.date);
      const stageNames = [...new Set(shown.map((s) => p.stages.find((st) => st.id === s.stageId)?.name).filter((n): n is string => Boolean(n)))];
      const label = homeLabel(p);
      posts.push({
        pid: p.id,
        sort: `${c.date}T${c.createdAt}`,
        id: shown[0].id,
        label,
        stageNames,
        progress: sched.complete ? "Completed" : `In progress · ${sched.percent}% done`,
        dateLabel: fmtDate(c.date),
        caption: c.showcaseCaption ?? "",
        photos: shown.map((s) => ({
          id: s.id,
          url: feedPhotoUrl(s.id, viewer.clientToken),
          alt: `${label}: ${p.stages.find((st) => st.id === s.stageId)?.name ?? "site"}`,
        })),
      });
    }
  }
  void today;
  const perSite = new Map<string, number>();
  const capped = posts
    .sort((a, b) => b.sort.localeCompare(a.sort))
    .filter((p) => {
      const n = (perSite.get(p.pid) ?? 0) + 1;
      perSite.set(p.pid, n);
      return n <= PER_SITE_LIMIT;
    });
  return capped.slice(0, limit).map((p) => ({
    id: p.id, label: p.label, stageNames: p.stageNames, progress: p.progress, dateLabel: p.dateLabel, caption: p.caption, photos: p.photos,
  }));
}

/** Is this showcase photo currently allowed to be shown to clients? Used by the photo route and the interest API. */
export function findShowcase(showcaseId: string, projects: Project[], checkins: Checkin[]): { project: Project; checkin: Checkin; fileName: string } | null {
  for (const c of checkins) {
    if (c.review !== "approved") continue;
    const hit = c.showcase?.find((s) => s.id === showcaseId);
    if (!hit) continue;
    const project = projects.find((p) => p.id === c.projectId);
    if (project?.showcase && c.photos.some((x) => x.fileName === hit.fileName)) return { project, checkin: c, fileName: hit.fileName };
  }
  return null;
}
