/**
 * JSON-file store. LOCAL DEV / DEMO ONLY.
 * - Single process: writes are serialised through an in-process lock
 *   (read-modify-write), and each write is atomic (temp file + rename).
 * - Needs a persistent disk. Serverless platforms (Vercel, Lambda) have
 *   ephemeral disks, so data would vanish. Set DATABASE_URL to use PgStore there.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { initialData } from "../bootstrap";
import type { Checkin, DB, Interest, Project, Studio, Supervisor } from "../types";
import { ConflictError, NotFoundError, type PhotoBlob, type ShowcaseSelection, type Store } from "./types";

type G = typeof globalThis & { __svLocks?: Map<string, Promise<unknown>>; __svInit?: Map<string, Promise<void>> };
const g = globalThis as G;
g.__svLocks ??= new Map();
g.__svInit ??= new Map();

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

export class JsonStore implements Store {
  private file: string;
  private photosDir: string;

  constructor(private dir: string) {
    this.file = path.join(dir, "db.json");
    this.photosDir = path.join(dir, "photos");
  }

  // ----- infrastructure ------------------------------------------------------

  private lock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = g.__svLocks!.get(this.dir) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    g.__svLocks!.set(this.dir, run.catch(() => undefined));
    return run;
  }

  private async ensure(): Promise<void> {
    let p = g.__svInit!.get(this.dir);
    if (!p) {
      p = this.lock(async () => {
        try {
          await fs.access(this.file);
          return;
        } catch {}
        await fs.mkdir(this.photosDir, { recursive: true });
        const { db, photos } = initialData();
        for (const [rel, svg] of Object.entries(photos)) {
          const target = path.join(this.photosDir, rel);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, svg);
        }
        await this.writeDb(db);
      });
      g.__svInit!.set(this.dir, p);
      p.catch(() => g.__svInit!.delete(this.dir));
    }
    return p;
  }

  private normalise(db: DB): DB {
    db.interests ??= [];
    for (const p of db.projects) {
      p.showcase ??= false;
      p.homeType ??= "";
    }
    return db;
  }

  private async readDb(): Promise<DB> {
    await this.ensure();
    return this.normalise(JSON.parse(await fs.readFile(this.file, "utf8")) as DB);
  }

  private async writeDb(db: DB): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db, null, 2));
    await fs.rename(tmp, this.file);
  }

  /** Serialised read-modify-write. */
  private async mutate<T>(fn: (db: DB) => Promise<T> | T): Promise<T> {
    await this.ensure();
    return this.lock(async () => {
      const db = this.normalise(JSON.parse(await fs.readFile(this.file, "utf8")) as DB);
      const result = await fn(db);
      await this.writeDb(db);
      return result;
    });
  }

  // ----- reads ---------------------------------------------------------------

  async getStudio(): Promise<Studio> {
    return (await this.readDb()).studio;
  }
  async listProjects(): Promise<Project[]> {
    return (await this.readDb()).projects;
  }
  async getProject(id: string): Promise<Project | null> {
    return (await this.readDb()).projects.find((p) => p.id === id) ?? null;
  }
  async getProjectByClientToken(token: string): Promise<Project | null> {
    return (await this.readDb()).projects.find((p) => p.clientToken === token) ?? null;
  }
  async listSupervisors(): Promise<Supervisor[]> {
    return (await this.readDb()).supervisors;
  }
  async getSupervisor(id: string): Promise<Supervisor | null> {
    return (await this.readDb()).supervisors.find((s) => s.id === id) ?? null;
  }
  async getSupervisorByToken(token: string): Promise<Supervisor | null> {
    return (await this.readDb()).supervisors.find((s) => s.token === token) ?? null;
  }
  async listCheckins(projectId?: string): Promise<Checkin[]> {
    const all = (await this.readDb()).checkins;
    return projectId ? all.filter((c) => c.projectId === projectId) : all;
  }
  async getCheckin(id: string): Promise<Checkin | null> {
    return (await this.readDb()).checkins.find((c) => c.id === id) ?? null;
  }
  async findCheckinByShowcaseId(showcaseId: string): Promise<Checkin | null> {
    return (await this.readDb()).checkins.find((c) => c.showcase?.some((s) => s.id === showcaseId)) ?? null;
  }
  async listInterests(): Promise<Interest[]> {
    return (await this.readDb()).interests;
  }

  // ----- writes --------------------------------------------------------------

  async createSupervisor(s: Supervisor): Promise<Supervisor> {
    return this.mutate((db) => {
      if (db.supervisors.some((x) => x.id === s.id || x.token === s.token)) throw new ConflictError("supervisor exists");
      db.supervisors.push(s);
      return s;
    });
  }

  async createProject(p: Project): Promise<Project> {
    return this.mutate((db) => {
      const sup = db.supervisors.find((x) => x.id === p.supervisorId);
      if (!sup) throw new NotFoundError("supervisor not found");
      if (db.projects.some((x) => x.id === p.id || x.clientToken === p.clientToken)) throw new ConflictError("project exists");
      db.projects.push(p);
      sup.projectIds.push(p.id);
      return p;
    });
  }

  async updateProject(id: string, mutate: (p: Project) => void): Promise<Project> {
    return this.mutate((db) => {
      const p = db.projects.find((x) => x.id === id);
      if (!p) throw new NotFoundError("project not found");
      mutate(p);
      return p;
    });
  }

  async addCheckin(checkin: Checkin, photos: PhotoBlob[]): Promise<{ checkin: Checkin; created: boolean }> {
    return this.mutate(async (db) => {
      const existing = db.checkins.find((c) => c.id === checkin.id);
      if (existing) return { checkin: existing, created: false };
      const dir = path.join(this.photosDir, checkin.projectId);
      await fs.mkdir(dir, { recursive: true });
      for (const p of photos) {
        if (!SAFE_NAME.test(p.fileName)) throw new Error("unsafe photo name");
        await fs.writeFile(path.join(dir, p.fileName), p.bytes);
      }
      db.checkins.push(checkin);
      return { checkin, created: true };
    });
  }

  async approveCheckin(id: string, message: string, approvedAt: string, showcase?: ShowcaseSelection): Promise<Checkin> {
    return this.mutate((db) => {
      const c = db.checkins.find((x) => x.id === id);
      if (!c) throw new NotFoundError("check-in not found");
      if (c.review === "approved") throw new ConflictError("already published");
      c.review = "approved";
      c.clientMessage = message;
      c.approvedAt = approvedAt;
      if (showcase) {
        c.showcase = showcase.photos;
        c.showcaseCaption = showcase.caption;
      }
      return c;
    });
  }

  async setShowcase(id: string, selection: ShowcaseSelection): Promise<Checkin> {
    return this.mutate((db) => {
      const c = db.checkins.find((x) => x.id === id);
      if (!c) throw new NotFoundError("check-in not found");
      if (c.review !== "approved") throw new ConflictError("publish the update first");
      c.showcase = selection.photos;
      c.showcaseCaption = selection.caption;
      return c;
    });
  }

  async addInterest(i: Interest): Promise<{ interest: Interest; created: boolean }> {
    return this.mutate((db) => {
      const existing = db.interests.find((x) => x.projectId === i.projectId && x.showcaseId === i.showcaseId);
      if (existing) return { interest: existing, created: false };
      db.interests.push(i);
      return { interest: i, created: true };
    });
  }

  async readPhoto(projectId: string, fileName: string): Promise<Uint8Array | null> {
    if (!SAFE_NAME.test(projectId) || !SAFE_NAME.test(fileName) || fileName.includes("..")) return null;
    try {
      return await fs.readFile(path.join(this.photosDir, projectId, fileName));
    } catch {
      return null;
    }
  }
}
