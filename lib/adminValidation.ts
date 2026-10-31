/** Validation + construction for owner-managed data. Pure; no I/O. */
import { randomBytes } from "node:crypto";
import { addDays, isISODate } from "./dates";
import { DEFAULT_STAGES } from "./stages";
import type { Amc, Checkin, ISODate, Project, ShowcasePhoto, Supervisor } from "./types";

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const fail = <T>(errors: string[]): Result<T> => ({ ok: false, errors });
const obj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export const newToken = () => randomBytes(18).toString("base64url"); // 24 URL-safe chars, 144 bits
export const newId = (prefix = "") => prefix + randomBytes(9).toString("base64url");

function text(errors: string[], label: string, v: unknown, min: number, max: number, optional = false): string {
  const s = str(v);
  if (!s && optional) return "";
  if (s.length < min) errors.push(`${label} is required`);
  else if (s.length > max) errors.push(`${label} is too long (max ${max})`);
  return s;
}
function phone(errors: string[], v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const digits = s.replace(/[\s()+-]/g, "");
  if (!/^\d{8,15}$/.test(digits)) errors.push("Phone must be 8-15 digits with country code, e.g. 919876543210");
  return digits;
}

// ---------- supervisors -------------------------------------------------------

export function validateSupervisor(body: unknown): Result<Supervisor> {
  if (!obj(body)) return fail(["Send JSON"]);
  const errors: string[] = [];
  const name = text(errors, "Name", body.name, 2, 60);
  if (errors.length) return fail(errors);
  return { ok: true, value: { id: newId("sup-"), name, token: newToken(), projectIds: [] } };
}

// ---------- projects ------------------------------------------------------------

export interface NewProjectInput { project: Omit<Project, "supervisorId">; supervisorId?: string; newSupervisorName?: string }

export function validateNewProject(body: unknown, knownSupervisorIds: string[]): Result<NewProjectInput> {
  if (!obj(body)) return fail(["Send JSON"]);
  const errors: string[] = [];
  const name = text(errors, "Project name", body.name, 2, 60);
  const clientName = text(errors, "Client name", body.clientName, 2, 60);
  const address = text(errors, "Address", body.address, 2, 200);
  const locality = text(errors, "Locality", body.locality, 0, 100, true);
  const homeType = text(errors, "Home type", body.homeType, 0, 20, true);
  const style = text(errors, "Style", body.style, 0, 40, true);
  const clientPhone = phone(errors, body.clientPhone);
  if (!isISODate(body.startDate)) errors.push("Start date must be a valid date (YYYY-MM-DD)");
  let supervisorId: string | undefined;
  let newSupervisorName: string | undefined;
  if (typeof body.supervisorId === "string" && body.supervisorId) {
    if (!knownSupervisorIds.includes(body.supervisorId)) errors.push("Choose an existing supervisor");
    else supervisorId = body.supervisorId;
  } else {
    newSupervisorName = text(errors, "Supervisor name", body.newSupervisorName, 2, 60);
  }
  if (errors.length) return fail(errors);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "project";
  const project: Omit<Project, "supervisorId"> = {
    id: `p-${slug}-${randomBytes(3).toString("hex")}`,
    slug,
    name,
    clientName,
    clientPhone,
    address,
    locality,
    homeType,
    style: style || undefined,
    showcase: body.showcase === true,
    startDate: body.startDate as ISODate,
    clientToken: newToken(),
    stages: DEFAULT_STAGES,
  };
  return { ok: true, value: { project, supervisorId, newSupervisorName } };
}

export interface ProjectPatch { showcase?: boolean; homeType?: string; style?: string; clientPhone?: string | null }
export function validateProjectPatch(body: unknown): Result<ProjectPatch> {
  if (!obj(body)) return fail(["Send JSON"]);
  const errors: string[] = [];
  const out: ProjectPatch = {};
  if ("showcase" in body) {
    if (typeof body.showcase !== "boolean") errors.push("showcase must be true or false");
    else out.showcase = body.showcase;
  }
  if ("homeType" in body) out.homeType = text(errors, "Home type", body.homeType, 0, 20, true);
  if ("style" in body) out.style = text(errors, "Style", body.style, 0, 40, true);
  if ("clientPhone" in body) out.clientPhone = phone(errors, body.clientPhone) ?? null;
  if (!Object.keys(out).length && !errors.length) errors.push("Nothing to change");
  return errors.length ? fail(errors) : { ok: true, value: out };
}

// ---------- AMC -----------------------------------------------------------------

export function validateAmc(body: unknown, existingLog: Amc["visitLog"] = []): Result<Amc> {
  if (!obj(body)) return fail(["Send the AMC details"]);
  const errors: string[] = [];
  const plan = text(errors, "Plan name", body.plan, 2, 60);
  let startsOn: Amc["startsOn"] = "handover";
  if (body.startsOn !== "handover") {
    if (isISODate(body.startsOn)) startsOn = body.startsOn;
    else errors.push("Start must be 'at handover' or a valid date");
  }
  const months = Number(body.months);
  if (!Number.isInteger(months) || months < 1 || months > 60) errors.push("Term must be 1 to 60 months");
  const visits = Number(body.visits);
  if (!Number.isInteger(visits) || visits < 0 || visits > 60) errors.push("Included visits must be 0 to 60");
  const rawCoverage = Array.isArray(body.coverage) ? body.coverage : typeof body.coverage === "string" ? body.coverage.split("\n") : [];
  const coverage = rawCoverage.map(str).filter(Boolean);
  if (coverage.length > 12) errors.push("At most 12 coverage lines");
  if (coverage.some((c) => c.length > 120)) errors.push("Each coverage line is at most 120 characters");
  let purchasedOn: ISODate | undefined;
  if (body.purchasedOn !== undefined && body.purchasedOn !== null && body.purchasedOn !== "") {
    if (isISODate(body.purchasedOn)) purchasedOn = body.purchasedOn;
    else errors.push("Purchase date is not a valid date");
  }
  if (errors.length) return fail(errors);
  return { ok: true, value: { plan, startsOn, months, visits, coverage, purchasedOn, visitLog: existingLog } };
}

export function validateVisit(body: unknown, today: ISODate): Result<{ date: ISODate; note: string }> {
  if (!obj(body)) return fail(["Send JSON"]);
  const errors: string[] = [];
  if (!isISODate(body.date)) errors.push("Visit date must be a valid date");
  else if (body.date > addDays(today, 1)) errors.push("Visit date cannot be in the future");
  const note = text(errors, "What was done", body.note, 3, 400);
  return errors.length ? fail(errors) : { ok: true, value: { date: body.date as ISODate, note } };
}

// ---------- inspiration-feed selection --------------------------------------------

/**
 * Turn the owner's chosen file names into feed photos. Photos that stay selected keep their
 * existing opaque id (links and recorded interests keep working); new ones get a fresh id.
 */
export function validateShowcase(body: unknown, checkin: Pick<Checkin, "photos" | "showcase">): Result<{ photos: ShowcasePhoto[]; caption: string }> {
  if (!obj(body)) return fail(["Send JSON"]);
  const errors: string[] = [];
  const names = Array.isArray(body.fileNames) ? body.fileNames : [];
  if (!Array.isArray(body.fileNames)) errors.push("fileNames must be a list");
  const caption = text(errors, "Caption", body.caption, 0, 200, true);
  const photos: ShowcasePhoto[] = [];
  for (const n of names) {
    const meta = checkin.photos.find((p) => p.fileName === n);
    if (!meta) { errors.push("A selected photo does not belong to this update"); break; }
    if (photos.some((p) => p.fileName === n)) continue;
    const prev = checkin.showcase?.find((s) => s.fileName === n);
    photos.push({ id: prev?.id ?? newId("s"), fileName: n as string, stageId: meta.stageId });
  }
  return errors.length ? fail(errors) : { ok: true, value: { photos, caption } };
}
