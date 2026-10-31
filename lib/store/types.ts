import type { Checkin, Interest, Project, ShowcasePhoto, Studio, Supervisor } from "../types";

/**
 * Store errors carry a string `code` and callers must check it with errorCode(),
 * NOT `instanceof`: the store singleton lives on globalThis and is shared by route
 * bundles that each get their own copy of these classes, so instanceof can fail in
 * production builds.
 */
export class NotFoundError extends Error { readonly code = "NOT_FOUND"; }
export class ConflictError extends Error { readonly code = "CONFLICT"; }
export function errorCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined;
}

export interface PhotoBlob {
  fileName: string;
  bytes: Uint8Array;
}

export interface ShowcaseSelection {
  photos: ShowcasePhoto[];
  caption: string;
}

/**
 * Persistence boundary. Two implementations: JsonStore (local dev/demo) and PgStore
 * (any Postgres via DATABASE_URL: Neon, Supabase, RDS...). Routes and pages only see this.
 */
export interface Store {
  getStudio(): Promise<Studio>;

  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  getProjectByClientToken(token: string): Promise<Project | null>;
  /** Also adds the project to its supervisor's projectIds. NOT_FOUND if the supervisor does not exist. */
  createProject(project: Project): Promise<Project>;
  /** Read-modify-write under a lock. NOT_FOUND if missing. */
  updateProject(id: string, mutate: (p: Project) => void): Promise<Project>;

  listSupervisors(): Promise<Supervisor[]>;
  getSupervisor(id: string): Promise<Supervisor | null>;
  getSupervisorByToken(token: string): Promise<Supervisor | null>;
  createSupervisor(supervisor: Supervisor): Promise<Supervisor>;

  listCheckins(projectId?: string): Promise<Checkin[]>;
  getCheckin(id: string): Promise<Checkin | null>;
  /** The check-in whose showcase selection contains this opaque photo handle, if any. */
  findCheckinByShowcaseId(showcaseId: string): Promise<Checkin | null>;
  /** Idempotent on checkin.id: a second call with the same id returns the stored one with created=false. */
  addCheckin(checkin: Checkin, photos: PhotoBlob[]): Promise<{ checkin: Checkin; created: boolean }>;
  /** NOT_FOUND, or CONFLICT when already published. Atomic: exactly one concurrent caller wins. */
  approveCheckin(id: string, message: string, approvedAt: string, showcase?: ShowcaseSelection): Promise<Checkin>;
  /** Replace the inspiration-feed selection of a PUBLISHED check-in. NOT_FOUND, or CONFLICT if still pending. */
  setShowcase(id: string, selection: ShowcaseSelection): Promise<Checkin>;
  readPhoto(projectId: string, fileName: string): Promise<Uint8Array | null>;

  /** One interest per (client project, showcase photo); repeats return created=false. */
  addInterest(interest: Interest): Promise<{ interest: Interest; created: boolean }>;
  listInterests(): Promise<Interest[]>;
}
