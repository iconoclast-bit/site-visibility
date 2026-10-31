export type ISODate = string; // YYYY-MM-DD

export type StageState = "not_started" | "working" | "blocked" | "done";
export const STAGE_STATES: StageState[] = ["not_started", "working", "blocked", "done"];

export interface Stage {
  id: string;
  name: string;
  short: string;
  trade: string;
  plannedDays: number;
  dependsOn: string[];
}

/** Annual Maintenance Contract bought by the client. Everything here is shown to the client. */
export interface Amc {
  plan: string; // "Gold AMC"
  startsOn: "handover" | ISODate; // "handover" = the day after the last stage is done
  months: number; // length of the term
  visits: number; // service visits included in the term
  coverage: string[]; // what is covered, one line each
  purchasedOn?: ISODate;
  visitLog: { date: ISODate; note: string }[]; // completed service visits
}

export interface Project {
  id: string;
  slug: string;
  name: string; // "Sharma 3BHK"
  clientName: string; // "Priya Sharma"
  clientPhone?: string; // digits with country code, optional (wa.me)
  address: string; // INTERNAL
  locality: string; // INTERNAL
  homeType: string; // "3BHK" (shown, anonymised, on the inspiration feed)
  style?: string; // "Modern minimal" (shown on the feed)
  showcase: boolean; // owner has the client's consent to feature approved photos on the inspiration feed
  amc?: Amc;
  startDate: ISODate;
  clientToken: string;
  supervisorId: string;
  stages: Stage[];
}

export interface Supervisor {
  id: string;
  name: string; // INTERNAL
  token: string;
  projectIds: string[];
}

export interface Studio {
  name: string;
  ownerToken: string;
  phone?: string; // WhatsApp number (digits with country code) used for client renewal / enquiry links
}

export interface StageUpdate {
  stageId: string;
  state: StageState;
  percent?: number;
  blockedReason?: string;
}

export interface PhotoMeta {
  fileName: string;
  stageId: string;
  takenAt: string;
  width: number;
  height: number;
}

export interface GeoLocation {
  lat: number;
  lng: number;
  accuracy?: number;
}

export type ReviewState = "pending" | "approved";

/** A photo the owner chose to feature on the inspiration feed. `id` is opaque: it is the only handle clients ever see. */
export interface ShowcasePhoto {
  id: string;
  fileName: string;
  stageId: string;
}

export interface Interest {
  id: string;
  projectId: string; // the client who asked
  showcaseId: string;
  createdAt: string;
}

export interface Checkin {
  id: string;
  projectId: string;
  supervisorId: string;
  date: ISODate; // IST calendar date of the visit
  createdAt: string; // ISO timestamp
  updates: StageUpdate[];
  note: string; // INTERNAL
  photos: PhotoMeta[];
  location: GeoLocation | null; // INTERNAL
  review: ReviewState;
  draftMessage?: string; // template draft made at submission (for "Reset draft")
  clientMessage?: string;
  approvedAt?: string;
  showcase?: ShowcasePhoto[]; // owner-selected photos for the inspiration feed (only used when project.showcase)
  showcaseCaption?: string; // owner-written, shown with the feed post
}

export interface DB {
  version: 1;
  studio: Studio;
  supervisors: Supervisor[];
  projects: Project[];
  checkins: Checkin[];
  interests: Interest[];
}

export interface StageStatus {
  state: StageState;
  percent: number;
  blockedReason?: string;
  startedDate?: ISODate;
  doneDate?: ISODate;
  lastUpdate?: ISODate;
}
export type StatusMap = Record<string, StageStatus>;
export type DateRange = { start: ISODate; end: ISODate };
export type PlanMap = Record<string, DateRange>;
