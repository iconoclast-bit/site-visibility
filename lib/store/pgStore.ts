/**
 * Postgres store: any Postgres reachable through DATABASE_URL (Neon, Supabase, RDS, local).
 * Documents live in jsonb columns; tokens, ids and review state are real columns/indexes.
 * Photos are bytea rows (fine at pilot scale: ~300 KB each; move to object storage later).
 * Schema is created on first use, under an advisory lock so concurrent cold starts are safe.
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { initialData } from "../bootstrap";
import type { Checkin, Interest, Project, Studio, Supervisor } from "../types";
import { ConflictError, NotFoundError, type PhotoBlob, type ShowcaseSelection, type Store } from "./types";

export interface Sql {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
export interface Db extends Sql {
  tx<T>(fn: (q: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Production driver: node-postgres pool. Keep the pool small: serverless instances multiply. */
export function pgDb(connectionString: string, max = Number(process.env.PG_POOL_MAX) || 3): Db {
  const pool = new pg.Pool({ connectionString, max, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });
  return {
    query: (text, params) => pool.query(text, params as unknown[]),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn({ query: (t, p) => client.query(t, p as unknown[]) });
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS studio (id int PRIMARY KEY, data jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS supervisors (seq bigserial, id text PRIMARY KEY, token text UNIQUE NOT NULL, data jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS projects (seq bigserial, id text PRIMARY KEY, client_token text UNIQUE NOT NULL, data jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS checkins (seq bigserial, id text PRIMARY KEY, project_id text NOT NULL, data jsonb NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS checkins_project_idx ON checkins (project_id)`,
  `CREATE TABLE IF NOT EXISTS photos (project_id text NOT NULL, file_name text NOT NULL, bytes bytea NOT NULL, PRIMARY KEY (project_id, file_name))`,
  `CREATE TABLE IF NOT EXISTS interests (seq bigserial, id text PRIMARY KEY, project_id text NOT NULL, showcase_id text NOT NULL, data jsonb NOT NULL, UNIQUE (project_id, showcase_id))`,
];

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const isUnique = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
const rowsOf = <T>(r: { rows: Record<string, unknown>[] }, col = "data") => r.rows.map((x) => x[col] as T);
const json = (v: unknown) => JSON.stringify(v);

type G = typeof globalThis & { __svPgInit?: Map<string, Promise<void>> };
const g = globalThis as G;
g.__svPgInit ??= new Map();

export class PgStore implements Store {
  constructor(private db: Db, private key = "default") {}

  private ensure(): Promise<void> {
    let p = g.__svPgInit!.get(this.key);
    if (!p) {
      p = this.init();
      g.__svPgInit!.set(this.key, p);
      p.catch(() => g.__svPgInit!.delete(this.key)); // retry on the next request if the first attempt failed
    }
    return p;
  }

  private async init(): Promise<void> {
    await this.db.tx(async (q) => {
      await q.query("SELECT pg_advisory_xact_lock(727001)");
      for (const stmt of DDL) await q.query(stmt);
      const has = await q.query("SELECT 1 FROM studio WHERE id = 1");
      if (has.rows.length) return;
      const { db, photos } = initialData();
      await q.query("INSERT INTO studio (id, data) VALUES (1, $1::jsonb)", [json(db.studio)]);
      for (const s of db.supervisors) await q.query("INSERT INTO supervisors (id, token, data) VALUES ($1, $2, $3::jsonb)", [s.id, s.token, json(s)]);
      for (const p of db.projects) await q.query("INSERT INTO projects (id, client_token, data) VALUES ($1, $2, $3::jsonb)", [p.id, p.clientToken, json(p)]);
      for (const c of db.checkins) await q.query("INSERT INTO checkins (id, project_id, data) VALUES ($1, $2, $3::jsonb)", [c.id, c.projectId, json(c)]);
      for (const [rel, svg] of Object.entries(photos)) {
        const [projectId, fileName] = rel.split("/");
        await q.query("INSERT INTO photos (project_id, file_name, bytes) VALUES ($1, $2, $3)", [projectId, fileName, Buffer.from(svg)]);
      }
    });
  }

  private async q(): Promise<Db> {
    await this.ensure();
    return this.db;
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  // ----- reads -----------------------------------------------------------------

  async getStudio(): Promise<Studio> {
    const r = await (await this.q()).query("SELECT data FROM studio WHERE id = 1");
    return r.rows[0].data as Studio;
  }
  async listProjects(): Promise<Project[]> {
    return rowsOf<Project>(await (await this.q()).query("SELECT data FROM projects ORDER BY seq"));
  }
  async getProject(id: string): Promise<Project | null> {
    return rowsOf<Project>(await (await this.q()).query("SELECT data FROM projects WHERE id = $1", [id]))[0] ?? null;
  }
  async getProjectByClientToken(token: string): Promise<Project | null> {
    return rowsOf<Project>(await (await this.q()).query("SELECT data FROM projects WHERE client_token = $1", [token]))[0] ?? null;
  }
  async listSupervisors(): Promise<Supervisor[]> {
    return rowsOf<Supervisor>(await (await this.q()).query("SELECT data FROM supervisors ORDER BY seq"));
  }
  async getSupervisor(id: string): Promise<Supervisor | null> {
    return rowsOf<Supervisor>(await (await this.q()).query("SELECT data FROM supervisors WHERE id = $1", [id]))[0] ?? null;
  }
  async getSupervisorByToken(token: string): Promise<Supervisor | null> {
    return rowsOf<Supervisor>(await (await this.q()).query("SELECT data FROM supervisors WHERE token = $1", [token]))[0] ?? null;
  }
  async listCheckins(projectId?: string): Promise<Checkin[]> {
    const db = await this.q();
    const r = projectId
      ? await db.query("SELECT data FROM checkins WHERE project_id = $1 ORDER BY seq", [projectId])
      : await db.query("SELECT data FROM checkins ORDER BY seq");
    return rowsOf<Checkin>(r);
  }
  async getCheckin(id: string): Promise<Checkin | null> {
    return rowsOf<Checkin>(await (await this.q()).query("SELECT data FROM checkins WHERE id = $1", [id]))[0] ?? null;
  }
  async findCheckinByShowcaseId(showcaseId: string): Promise<Checkin | null> {
    const r = await (await this.q()).query("SELECT data FROM checkins WHERE data->'showcase' @> $1::jsonb LIMIT 1", [json([{ id: showcaseId }])]);
    return rowsOf<Checkin>(r)[0] ?? null;
  }
  async listInterests(): Promise<Interest[]> {
    return rowsOf<Interest>(await (await this.q()).query("SELECT data FROM interests ORDER BY seq"));
  }
  async readPhoto(projectId: string, fileName: string): Promise<Uint8Array | null> {
    if (!SAFE_NAME.test(projectId) || !SAFE_NAME.test(fileName) || fileName.includes("..")) return null;
    const r = await (await this.q()).query("SELECT bytes FROM photos WHERE project_id = $1 AND file_name = $2", [projectId, fileName]);
    const b = r.rows[0]?.bytes as Uint8Array | undefined;
    return b ? new Uint8Array(b) : null;
  }

  // ----- writes ----------------------------------------------------------------

  async createSupervisor(s: Supervisor): Promise<Supervisor> {
    const db = await this.q();
    try {
      await db.query("INSERT INTO supervisors (id, token, data) VALUES ($1, $2, $3::jsonb)", [s.id, s.token, json(s)]);
    } catch (e) {
      if (isUnique(e)) throw new ConflictError("supervisor exists");
      throw e;
    }
    return s;
  }

  async createProject(p: Project): Promise<Project> {
    const db = await this.q();
    try {
      return await db.tx(async (q) => {
        const sup = rowsOf<Supervisor>(await q.query("SELECT data FROM supervisors WHERE id = $1 FOR UPDATE", [p.supervisorId]))[0];
        if (!sup) throw new NotFoundError("supervisor not found");
        await q.query("INSERT INTO projects (id, client_token, data) VALUES ($1, $2, $3::jsonb)", [p.id, p.clientToken, json(p)]);
        sup.projectIds.push(p.id);
        await q.query("UPDATE supervisors SET data = $2::jsonb WHERE id = $1", [sup.id, json(sup)]);
        return p;
      });
    } catch (e) {
      if (isUnique(e)) throw new ConflictError("project exists");
      throw e;
    }
  }

  async updateProject(id: string, mutate: (p: Project) => void): Promise<Project> {
    const db = await this.q();
    return db.tx(async (q) => {
      const p = rowsOf<Project>(await q.query("SELECT data FROM projects WHERE id = $1 FOR UPDATE", [id]))[0];
      if (!p) throw new NotFoundError("project not found");
      mutate(p);
      await q.query("UPDATE projects SET data = $2::jsonb, client_token = $3 WHERE id = $1", [id, json(p), p.clientToken]);
      return p;
    });
  }

  async addCheckin(checkin: Checkin, photos: PhotoBlob[]): Promise<{ checkin: Checkin; created: boolean }> {
    const db = await this.q();
    return db.tx(async (q) => {
      const ins = await q.query("INSERT INTO checkins (id, project_id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id", [checkin.id, checkin.projectId, json(checkin)]);
      if (!ins.rows.length) {
        const existing = rowsOf<Checkin>(await q.query("SELECT data FROM checkins WHERE id = $1", [checkin.id]))[0];
        return { checkin: existing, created: false };
      }
      for (const p of photos) {
        if (!SAFE_NAME.test(p.fileName)) throw new Error("unsafe photo name");
        await q.query("INSERT INTO photos (project_id, file_name, bytes) VALUES ($1, $2, $3)", [checkin.projectId, p.fileName, Buffer.from(p.bytes)]);
      }
      return { checkin, created: true };
    });
  }

  private async withCheckin(id: string, fn: (c: Checkin) => void): Promise<Checkin> {
    const db = await this.q();
    return db.tx(async (q) => {
      const c = rowsOf<Checkin>(await q.query("SELECT data FROM checkins WHERE id = $1 FOR UPDATE", [id]))[0];
      if (!c) throw new NotFoundError("check-in not found");
      fn(c);
      await q.query("UPDATE checkins SET data = $2::jsonb WHERE id = $1", [id, json(c)]);
      return c;
    });
  }

  approveCheckin(id: string, message: string, approvedAt: string, showcase?: ShowcaseSelection): Promise<Checkin> {
    return this.withCheckin(id, (c) => {
      if (c.review === "approved") throw new ConflictError("already published");
      c.review = "approved";
      c.clientMessage = message;
      c.approvedAt = approvedAt;
      if (showcase) {
        c.showcase = showcase.photos;
        c.showcaseCaption = showcase.caption;
      }
    });
  }

  setShowcase(id: string, selection: ShowcaseSelection): Promise<Checkin> {
    return this.withCheckin(id, (c) => {
      if (c.review !== "approved") throw new ConflictError("publish the update first");
      c.showcase = selection.photos;
      c.showcaseCaption = selection.caption;
    });
  }

  async addInterest(i: Interest): Promise<{ interest: Interest; created: boolean }> {
    const db = await this.q();
    const ins = await db.query("INSERT INTO interests (id, project_id, showcase_id, data) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (project_id, showcase_id) DO NOTHING RETURNING id", [i.id, i.projectId, i.showcaseId, json(i)]);
    if (ins.rows.length) return { interest: i, created: true };
    const r = await db.query("SELECT data FROM interests WHERE project_id = $1 AND showcase_id = $2", [i.projectId, i.showcaseId]);
    return { interest: rowsOf<Interest>(r)[0], created: false };
  }
}

export function newId(prefix = ""): string {
  return prefix + randomBytes(9).toString("base64url");
}
