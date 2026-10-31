/**
 * First-run data for a fresh store (JSON file or Postgres), and the safe-by-default demo switch.
 */
import { buildDemo } from "./seed";
import { todayIST } from "./dates";
import type { DB } from "./types";

/**
 * Demo data uses public, guessable links (demo-owner...). It must never appear on a real deployment:
 *  - DEMO_HUB=on  : always on     - DEMO_HUB=off : always off
 *  - unset        : on only for local JSON-file development, OFF whenever a database URL is configured.
 */
type Env = Record<string, string | undefined>;

/** DATABASE_URL, or POSTGRES_URL (what the Supabase and Neon Vercel integrations set). */
export function databaseUrl(env: Env = process.env): string | undefined {
  return env.DATABASE_URL?.trim() || env.POSTGRES_URL?.trim() || undefined;
}

export function demoEnabled(env: Env = process.env): boolean {
  if (env.DEMO_HUB === "on") return true;
  if (env.DEMO_HUB === "off") return false;
  return !databaseUrl(env);
}

export const MIN_OWNER_TOKEN = 20;

export class ConfigError extends Error {}

export function initialData(env: Env = process.env, now: Date = new Date()): { db: DB; photos: Record<string, string> } {
  const phone = env.STUDIO_PHONE?.replace(/\D/g, "") || undefined;
  if (demoEnabled(env)) {
    const { db, photos } = buildDemo(todayIST(now), now);
    if (phone) db.studio.phone = phone;
    return { db, photos };
  }
  const token = env.OWNER_TOKEN?.trim();
  if (!token || token.length < MIN_OWNER_TOKEN || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new ConfigError(
      `OWNER_TOKEN is required when the demo is off: set it to a secret of at least ${MIN_OWNER_TOKEN} letters, digits, - or _ ` +
        `(for example: openssl rand -base64 24 | tr '+/' '-_' | tr -d '='). Your owner link will be /a/<OWNER_TOKEN>.`,
    );
  }
  return {
    db: { version: 1, studio: { name: env.STUDIO_NAME?.trim() || "Design Studio", ownerToken: token, phone }, supervisors: [], projects: [], checkins: [], interests: [] },
    photos: {},
  };
}
