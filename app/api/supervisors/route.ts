import { validateSupervisor } from "@/lib/adminValidation";
import { resolveToken, tokenFromRequest } from "@/lib/auth";
import { forbidden, json, readJson, unauthorized } from "@/lib/http";
import { getStore } from "@/lib/store";

/** Owner only: add a site supervisor. Returns their secret link token (shown once to the owner). */
export async function POST(req: Request): Promise<Response> {
  const store = getStore();
  const body = await readJson(req);
  if (!body) return json({ errors: ["Send JSON"] }, 400);
  const who = await resolveToken(store, tokenFromRequest(req, body.token));
  if (!who) return unauthorized();
  if (who.role !== "owner") return forbidden();
  const v = validateSupervisor(body);
  if (!v.ok) return json({ errors: v.errors }, 400);
  const s = await store.createSupervisor(v.value);
  return json({ id: s.id, name: s.name, token: s.token }, 201);
}
