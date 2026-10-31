import { validateShowcase } from "@/lib/adminValidation";
import { resolveToken, tokenFromRequest } from "@/lib/auth";
import { forbidden, json, notFound, readJson, unauthorized } from "@/lib/http";
import { errorCode, getStore } from "@/lib/store";

/** Owner only: change which photos of a PUBLISHED update appear on the inspiration feed. */
export async function POST(req: Request, ctx: RouteContext<"/api/checkins/[id]/showcase">): Promise<Response> {
  const store = getStore();
  const body = await readJson(req);
  if (!body) return json({ errors: ["Send JSON"] }, 400);
  const who = await resolveToken(store, tokenFromRequest(req, body.token));
  if (!who) return unauthorized();
  if (who.role !== "owner") return forbidden();
  const { id } = await ctx.params;
  const checkin = await store.getCheckin(id);
  if (!checkin) return notFound();
  const project = await store.getProject(checkin.projectId);
  if (!project?.showcase) return json({ errors: ["Turn on the inspiration feed for this project first."] }, 409);
  const v = validateShowcase(body, checkin);
  if (!v.ok) return json({ errors: v.errors }, 400);
  try {
    const c = await store.setShowcase(id, v.value);
    return json({ id: c.id, shared: c.showcase?.length ?? 0 });
  } catch (e) {
    if (errorCode(e) === "NOT_FOUND") return notFound();
    if (errorCode(e) === "CONFLICT") return json({ errors: ["Publish this update first."] }, 409);
    throw e;
  }
}
