/** Server-side validation of an incoming check-in. Pure; no I/O. */
import { istDateOf } from "./dates";
import { STAGE_STATES, type GeoLocation, type PhotoMeta, type Project, type StageState, type StageUpdate } from "./types";

export const LIMITS = {
  maxPhotos: 8,
  maxPhotoBytes: 6 * 1024 * 1024,
  maxNoteChars: 1000,
  maxReasonChars: 200,
  minReasonChars: 3,
  maxMessageChars: 1500,
  maxDimension: 4096,
  maxTotalBytes: 40 * 1024 * 1024,
  /** a queued (offline) check-in may be sent up to this long after it was made */
  maxBackdateMs: 72 * 3600_000,
  futureSkewMs: 5 * 60_000,
};

export interface CheckinInput {
  id?: unknown;
  updates: unknown;
  note: unknown;
  photoMeta: unknown;
  location: unknown;
  submittedAt?: unknown;
  fileCount: number;
}

export interface ValidCheckin {
  id: string | null;
  date: string; // IST date
  createdAt: string; // ISO
  updates: StageUpdate[];
  note: string;
  photoMeta: Omit<PhotoMeta, "fileName">[];
  location: GeoLocation | null;
}

export type Validation = { ok: true; value: ValidCheckin } | { ok: false; errors: string[] };

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function validateCheckin(input: CheckinInput, project: Project, now: Date): Validation {
  const errors: string[] = [];
  const stageIds = new Set(project.stages.map((s) => s.id));

  // id
  let id: string | null = null;
  if (input.id !== undefined && input.id !== null && input.id !== "") {
    if (typeof input.id === "string" && ID_RE.test(input.id)) id = input.id;
    else errors.push("id must be 8-64 letters, digits, - or _");
  }

  // updates
  const updates: StageUpdate[] = [];
  if (!Array.isArray(input.updates)) {
    errors.push("updates must be a list");
  } else {
    const seen = new Set<string>();
    input.updates.forEach((raw, i) => {
      const where = `updates[${i}]`;
      if (!isObj(raw)) return void errors.push(`${where} must be an object`);
      const stageId = raw.stageId;
      if (typeof stageId !== "string" || !stageIds.has(stageId)) return void errors.push(`${where}: unknown stage`);
      if (seen.has(stageId)) return void errors.push(`${where}: stage "${stageId}" appears twice`);
      seen.add(stageId);
      const state = raw.state;
      if (typeof state !== "string" || !STAGE_STATES.includes(state as StageState)) {
        return void errors.push(`${where}: invalid state`);
      }
      const u: StageUpdate = { stageId, state: state as StageState };
      if (raw.percent !== undefined && raw.percent !== null) {
        const p = raw.percent;
        if (typeof p !== "number" || !Number.isFinite(p) || !Number.isInteger(p) || p < 0 || p > 100) {
          return void errors.push(`${where}: percent must be a whole number from 0 to 100`);
        }
        if (state === "working" || state === "blocked") u.percent = p;
      }
      if (state === "blocked") {
        const r = typeof raw.blockedReason === "string" ? raw.blockedReason.trim() : "";
        if (r.length < LIMITS.minReasonChars) return void errors.push(`${where}: a reason is required when a stage is blocked`);
        if (r.length > LIMITS.maxReasonChars) return void errors.push(`${where}: reason is too long`);
        u.blockedReason = r;
      }
      updates.push(u);
    });
  }

  // note
  let note = "";
  if (input.note !== undefined && input.note !== null) {
    if (typeof input.note !== "string") errors.push("note must be text");
    else if (input.note.length > LIMITS.maxNoteChars) errors.push(`note is too long (max ${LIMITS.maxNoteChars} characters)`);
    else note = input.note.trim();
  }

  // photos
  const photoMeta: ValidCheckin["photoMeta"] = [];
  if (input.fileCount > LIMITS.maxPhotos) errors.push(`at most ${LIMITS.maxPhotos} photos per check-in`);
  if (!Array.isArray(input.photoMeta)) {
    errors.push("photoMeta must be a list");
  } else if (input.photoMeta.length !== input.fileCount) {
    errors.push("photoMeta must have one entry per photo");
  } else {
    input.photoMeta.forEach((raw, i) => {
      const where = `photoMeta[${i}]`;
      if (!isObj(raw)) return void errors.push(`${where} must be an object`);
      if (typeof raw.stageId !== "string" || !stageIds.has(raw.stageId)) return void errors.push(`${where}: unknown stage`);
      const w = Number(raw.width), h = Number(raw.height);
      if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > LIMITS.maxDimension || h > LIMITS.maxDimension) {
        return void errors.push(`${where}: invalid size`);
      }
      const takenAt = typeof raw.takenAt === "string" && Number.isFinite(Date.parse(raw.takenAt)) ? new Date(raw.takenAt).toISOString() : now.toISOString();
      photoMeta.push({ stageId: raw.stageId, takenAt, width: w, height: h });
    });
  }

  // location
  let location: GeoLocation | null = null;
  if (input.location !== undefined && input.location !== null) {
    const l = input.location;
    if (!isObj(l) || typeof l.lat !== "number" || typeof l.lng !== "number" || !Number.isFinite(l.lat) || !Number.isFinite(l.lng) || l.lat < -90 || l.lat > 90 || l.lng < -180 || l.lng > 180) {
      errors.push("location is invalid");
    } else {
      location = { lat: l.lat, lng: l.lng };
      if (typeof l.accuracy === "number" && Number.isFinite(l.accuracy) && l.accuracy >= 0) location.accuracy = Math.round(l.accuracy);
    }
  }

  // not empty
  if (!errors.length && !updates.length && !note && !photoMeta.length) {
    errors.push("nothing to send: add a stage update, a photo or a note");
  }

  // time (offline queue may deliver late; never trust the future)
  let created = now;
  if (input.submittedAt !== undefined && input.submittedAt !== null && input.submittedAt !== "") {
    const t = typeof input.submittedAt === "string" ? Date.parse(input.submittedAt) : NaN;
    if (Number.isFinite(t) && t >= now.getTime() - LIMITS.maxBackdateMs && t <= now.getTime() + LIMITS.futureSkewMs) {
      created = new Date(Math.min(t, now.getTime()));
    }
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { id, date: istDateOf(created.toISOString()), createdAt: created.toISOString(), updates, note, photoMeta, location },
  };
}

export function validateMessage(message: unknown): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof message !== "string" || !message.trim()) return { ok: false, error: "message cannot be empty" };
  if (message.length > LIMITS.maxMessageChars) return { ok: false, error: `message is too long (max ${LIMITS.maxMessageChars} characters)` };
  return { ok: true, text: message.trim() };
}
