import { PGlite } from "@electric-sql/pglite";
import type { Db } from "@/lib/store/pgStore";

/** Test-only adapter: real Postgres (WASM) behind the same Db interface the production pg pool implements. */
export async function makePgliteDb(): Promise<Db> {
  const db = await PGlite.create();
  return {
    query: (text, params) => db.query(text, params as unknown[]) as never,
    tx: (fn) => db.transaction((tx) => fn({ query: (t, p) => tx.query(t, p as unknown[]) as never })),
    close: () => db.close(),
  };
}
