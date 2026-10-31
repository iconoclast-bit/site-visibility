import { newId } from "@/lib/adminValidation";
import { resolveToken, tokenFromRequest } from "@/lib/auth";
import { forbidden, json, readJson, unauthorized } from "@/lib/http";
import { getStore } from "@/lib/store";

/** Client only: "I'd like something like this" on an inspiration-feed photo. One per client and photo. */
export async function POST(req: Request): Promise<Response> {
  const store = getStore();
  const body = await readJson(req);
  if (!body) return json({ error: "Send JSON: { showcaseId }" }, 400);
  const who = await resolveToken(store, tokenFromRequest(req, body.token));
  if (!who) return unauthorized();
  if (who.role !== "client") return forbidden();

  const showcaseId = typeof body.showcaseId === "string" ? body.showcaseId : "";
  const checkin = showcaseId ? await store.findCheckinByShowcaseId(showcaseId) : null;
  const source = checkin ? await store.getProject(checkin.projectId) : null;
  const hit = checkin?.showcase?.find((s) => s.id === showcaseId);
  // Same visibility rule as the feed itself; a client cannot "like" their own site.
  if (!checkin || !source || !hit || checkin.review !== "approved" || !source.showcase || source.id === who.project.id) {
    return json({ error: "That photo is not available" }, 404);
  }
  const r = await store.addInterest({ id: newId("i-"), projectId: who.project.id, showcaseId, createdAt: new Date().toISOString() });
  return json({ ok: true, repeated: !r.created }, r.created ? 201 : 200);
}
