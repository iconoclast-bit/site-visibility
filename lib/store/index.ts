import path from "node:path";
import { databaseUrl } from "../bootstrap";
import { JsonStore } from "./jsonStore";
import { PgStore, pgDb } from "./pgStore";
import type { Store } from "./types";

type G = typeof globalThis & { __svStore?: Store };

/**
 * One store per process.
 *  - DATABASE_URL (or POSTGRES_URL) set -> PgStore (Postgres). Use this for any real deployment.
 *  - otherwise         -> JsonStore in DATA_DIR (local dev/demo only; needs a persistent disk).
 */
export function getStore(): Store {
  const g = globalThis as G;
  if (!g.__svStore) {
    const url = databaseUrl();
    g.__svStore = url ? new PgStore(pgDb(url)) : new JsonStore(path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || ".data"));
  }
  return g.__svStore;
}

export { demoEnabled as demoHubEnabled } from "../bootstrap";
export * from "./types";
