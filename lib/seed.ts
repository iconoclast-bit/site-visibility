/**
 * Demo data, generated relative to "today" so it always looks current.
 * Messages are produced by the same template drafter the product uses, dated
 * to the day of each check-in, so every number in them is schedule-computed.
 */
import { addDays, fmtDate } from "./dates";
import { templateDraft } from "./draft";
import { DEFAULT_STAGES } from "./stages";
import type { Checkin, DB, ISODate, PhotoMeta, Project, StageUpdate } from "./types";

export const DEMO_TOKENS = {
  owner: "demo-owner",
  supervisor: "demo-supervisor",
  client: (slug: string) => `demo-client-${slug}`,
};

const SIGN_OFF = "\n– Team Design by Aarav";
const HUES: Record<string, number> = { civil: 28, elec: 48, ceiling: 200, carpentry: 22, paint: 340, fittings: 160, handover: 260 };

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function demoPhotoSvg(stageId: string, stageName: string, date: string, n: number): string {
  const hue = HUES[stageId] ?? 210;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 55% 78%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 45% 58%)"/></linearGradient></defs>
<rect width="1200" height="800" fill="url(#g)"/>
<g fill="none" stroke="rgba(255,255,255,.55)" stroke-width="6"><rect x="90" y="460" width="380" height="240"/><rect x="520" y="300" width="260" height="400"/><path d="M830 700V420h260v280M830 560h260"/></g>
<rect x="40" y="40" width="250" height="64" rx="12" fill="rgba(0,0,0,.55)"/>
<text x="165" y="84" font-family="sans-serif" font-size="34" font-weight="700" fill="#fff" text-anchor="middle">Demo photo</text>
<text x="600" y="190" font-family="sans-serif" font-size="56" font-weight="700" fill="rgba(0,0,0,.7)" text-anchor="middle">${esc(stageName)}</text>
<text x="600" y="250" font-family="sans-serif" font-size="30" fill="rgba(0,0,0,.6)" text-anchor="middle">${esc(date)} · picture ${n}</text>
</svg>`;
}

interface Spec {
  daysAgo: number;
  updates: StageUpdate[];
  photos?: string[]; // stage ids, one photo each
  note?: string;
  pending?: boolean;
  location?: boolean;
}

export function buildDemo(today: ISODate, now: Date): { db: DB; photos: Record<string, string> } {
  const photos: Record<string, string> = {};
  const checkins: Checkin[] = [];
  let photoCounter = 0;

  const projects: Project[] = [
    {
      id: "p-sharma", slug: "sharma", name: "Sharma 3BHK", clientName: "Priya Sharma",
      address: "B-42, Palm Residency, Sector 56", locality: "Sector 56, Gurgaon",
      homeType: "3BHK", style: "Contemporary", showcase: true,
      startDate: addDays(today, -27), clientToken: DEMO_TOKENS.client("sharma"), supervisorId: "sup-ravi", stages: DEFAULT_STAGES,
    },
    {
      id: "p-mehta", slug: "mehta", name: "Mehta 2BHK", clientName: "Rohan Mehta",
      address: "Flat 1104, Tower C, Greenview Heights", locality: "Golf Course Road, Gurgaon",
      homeType: "2BHK", style: "Scandinavian", showcase: false,
      amc: {
        plan: "Gold AMC", startsOn: "handover", months: 12, visits: 4, purchasedOn: addDays(today, -5), visitLog: [],
        coverage: ["4 scheduled service visits a year", "Carpentry and hinge adjustments", "Paint touch-ups for small marks", "Priority response within 48 hours"],
      },
      startDate: addDays(today, -6), clientToken: DEMO_TOKENS.client("mehta"), supervisorId: "sup-ravi", stages: DEFAULT_STAGES,
    },
    {
      id: "p-verma", slug: "verma", name: "Verma 2BHK", clientName: "Anita Verma",
      address: "C-9, Lotus Apartments, Sector 82", locality: "Sector 82, Gurgaon",
      homeType: "2BHK", style: "Modern minimal", showcase: true,
      startDate: addDays(today, -30), clientToken: DEMO_TOKENS.client("verma"), supervisorId: "sup-ravi", stages: DEFAULT_STAGES,
    },
    {
      id: "p-kapoor", slug: "kapoor", name: "Kapoor 3BHK", clientName: "Neha Kapoor",
      address: "D-12, Orchid Villas, Sector 49", locality: "Sector 49, Gurgaon",
      homeType: "3BHK", style: "Classic warm", showcase: true,
      amc: {
        plan: "Gold AMC", startsOn: "handover", months: 12, visits: 4, purchasedOn: addDays(today, -146),
        coverage: ["4 scheduled service visits a year", "Carpentry and hinge adjustments", "Paint touch-ups for small marks", "Priority response within 48 hours"],
        visitLog: [{ date: addDays(today, -50), note: "Checked all fittings, re-aligned two wardrobe doors and touched up paint near the balcony." }],
      },
      startDate: addDays(today, -200), clientToken: DEMO_TOKENS.client("kapoor"), supervisorId: "sup-ravi", stages: DEFAULT_STAGES,
    },
  ];

  const stageName = (id: string) => DEFAULT_STAGES.find((s) => s.id === id)!.name;
  const w = (stageId: string, percent: number): StageUpdate => ({ stageId, state: "working", percent });
  const done = (stageId: string): StageUpdate => ({ stageId, state: "done" });
  const blocked = (stageId: string, percent: number): StageUpdate => ({ stageId, state: "blocked", percent, blockedReason: "Material not arrived" });

  const specs: Record<string, Spec[]> = {
    "p-sharma": [
      { daysAgo: 24, updates: [w("civil", 40)], photos: ["civil", "civil"], location: true },
      { daysAgo: 20, updates: [done("civil"), w("elec", 30)], photos: ["civil", "elec"], location: true },
      { daysAgo: 14, updates: [done("elec"), w("ceiling", 10), w("carpentry", 10)], photos: ["elec", "ceiling", "carpentry"], location: true },
      { daysAgo: 8, updates: [w("ceiling", 40), w("carpentry", 20)], photos: ["ceiling", "carpentry"], location: true },
      { daysAgo: 4, updates: [blocked("ceiling", 40), w("carpentry", 30)], photos: ["ceiling", "carpentry"], note: "Gypsum board ka stock supplier ke paas nahi hai, supplier ne late kiya", location: true },
      { daysAgo: 1, updates: [blocked("ceiling", 40), w("carpentry", 40)], photos: ["carpentry"], location: true },
      { daysAgo: 0, updates: [blocked("ceiling", 40), w("carpentry", 45)], photos: ["ceiling", "carpentry", "carpentry"], note: "Supplier ne kaha Monday tak board aa jayega. Wardrobe shutters lag rahe hain.", pending: true, location: true },
    ],
    "p-mehta": [
      { daysAgo: 5, updates: [w("civil", 25)], photos: ["civil"], location: true },
      { daysAgo: 1, updates: [w("civil", 60)], photos: ["civil", "civil"], location: true },
      { daysAgo: 0, updates: [w("civil", 70)], photos: ["civil", "civil"], note: "Tile demolition almost done, debris uthana baki hai", pending: true, location: true },
    ],
    "p-verma": [
      { daysAgo: 27, updates: [w("civil", 40)], photos: ["civil"], location: true },
      { daysAgo: 23, updates: [done("civil"), w("elec", 30)], photos: ["civil", "elec"], location: true },
      { daysAgo: 18, updates: [done("elec"), w("ceiling", 20), w("carpentry", 10)], photos: ["elec", "ceiling"], location: true },
      { daysAgo: 12, updates: [w("ceiling", 80), w("carpentry", 35)], photos: ["ceiling", "carpentry"], location: true },
      { daysAgo: 7, updates: [done("ceiling"), w("carpentry", 50)], photos: ["ceiling", "carpentry"], location: true },
      { daysAgo: 4, updates: [w("carpentry", 65)], photos: ["carpentry"], location: true },
      { daysAgo: 1, updates: [w("carpentry", 75)], photos: ["carpentry", "carpentry"], location: true },
    ],
    "p-kapoor": [
      { daysAgo: 197, updates: [w("civil", 50)], photos: ["civil", "civil"] },
      { daysAgo: 192, updates: [done("civil"), w("elec", 40)], photos: ["civil", "elec"] },
      { daysAgo: 186, updates: [done("elec"), w("ceiling", 20), w("carpentry", 10)], photos: ["ceiling", "carpentry"] },
      { daysAgo: 176, updates: [w("ceiling", 80), w("carpentry", 35)], photos: ["ceiling", "carpentry"] },
      { daysAgo: 170, updates: [done("ceiling"), w("carpentry", 60)], photos: ["ceiling", "carpentry"] },
      { daysAgo: 158, updates: [done("carpentry"), w("paint", 40)], photos: ["carpentry", "paint"] },
      { daysAgo: 152, updates: [done("paint"), w("fittings", 50)], photos: ["paint", "fittings"] },
      { daysAgo: 147, updates: [done("fittings"), w("handover", 50)], photos: ["fittings", "handover"] },
      { daysAgo: 146, updates: [done("handover")], photos: ["handover", "handover", "handover"] },
    ],
  };

  let showcaseCounter = 0;
  for (const project of projects) {
    const mine: Checkin[] = [];
    for (const [i, spec] of specs[project.id].entries()) {
      const date = addDays(today, -spec.daysAgo);
      const id = `demo-${project.slug}-${i + 1}`;
      const createdAt = spec.daysAgo === 0 ? new Date(now.getTime() - 60_000 * (3 - i)).toISOString() : `${date}T08:${String(10 + i).padStart(2, "0")}:00.000Z`;
      const metas: PhotoMeta[] = (spec.photos ?? []).map((stageId, n) => {
        photoCounter += 1;
        const fileName = `demo-${photoCounter}.svg`;
        photos[`${project.id}/${fileName}`] = demoPhotoSvg(stageId, stageName(stageId), fmtDate(date), n + 1);
        return { fileName, stageId, takenAt: createdAt, width: 1200, height: 800 };
      });
      const c: Checkin = {
        id, projectId: project.id, supervisorId: project.supervisorId, date, createdAt,
        updates: spec.updates, note: spec.note ?? "", photos: metas,
        location: spec.location ? { lat: 28.4271 + i * 0.0002, lng: 77.0962 + i * 0.0001, accuracy: 18 } : null,
        review: spec.pending ? "pending" : "approved",
      };
      mine.push(c);
      // Draft against: everything up to and including this check-in, as of its own day (or today when pending).
      c.draftMessage = templateDraft({ project, checkin: c, allCheckins: mine, today: spec.pending ? today : date });
      if (!spec.pending) {
        c.clientMessage = c.draftMessage + SIGN_OFF;
        c.approvedAt = new Date(Date.parse(createdAt) + 3 * 3600_000).toISOString();
        if (project.showcase) {
          c.showcase = metas.map((m) => ({ id: `demo-sc-${(showcaseCounter += 1)}`, fileName: m.fileName, stageId: m.stageId }));
          if (i % 3 === 0) c.showcaseCaption = "Love how the colours came together here.";
        }
      }
    }
    checkins.push(...mine);
  }

  const db: DB = {
    version: 1,
    studio: { name: "Design by Aarav", ownerToken: DEMO_TOKENS.owner },
    supervisors: [{ id: "sup-ravi", name: "Ravi Kumar", token: DEMO_TOKENS.supervisor, projectIds: projects.map((p) => p.id) }],
    projects,
    checkins,
    interests: [],
  };
  return { db, photos };
}
