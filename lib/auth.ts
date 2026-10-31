/**
 * PILOT-GRADE AUTH: a role is identified by a secret token in the link. Anyone
 * holding the link has that role. Replace with real sign-in (per-user sessions,
 * expiring/rotatable links, audit log) before scaling beyond a pilot.
 */
import type { Project, Supervisor } from "./types";
import type { Store } from "./store/types";

export type Principal =
  | { role: "owner" }
  | { role: "supervisor"; supervisor: Supervisor }
  | { role: "client"; project: Project };

export async function resolveToken(store: Store, token: string | null | undefined): Promise<Principal | null> {
  if (!token || token.length > 200) return null;
  const studio = await store.getStudio();
  if (token === studio.ownerToken) return { role: "owner" };
  const supervisor = await store.getSupervisorByToken(token);
  if (supervisor) return { role: "supervisor", supervisor };
  const project = await store.getProjectByClientToken(token);
  if (project) return { role: "client", project };
  return null;
}

export function ownerOrNull(p: Principal | null): p is { role: "owner" } {
  return p?.role === "owner";
}

export function tokenFromRequest(req: Request, bodyToken?: unknown): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  if (typeof bodyToken === "string" && bodyToken) return bodyToken;
  return new URL(req.url).searchParams.get("t");
}
