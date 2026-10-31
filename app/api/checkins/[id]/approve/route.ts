import { validateShowcase } from "@/lib/adminValidation";
import { resolveToken, tokenFromRequest } from "@/lib/auth";
import { forbidden, json, notFound, readJson, unauthorized } from "@/lib/http";
import { errorCode, getStore } from "@/lib/store";
import { validateMessage } from "@/lib/validation";

/**
 * Owner only. Publishes a pending check-in to the client. Optionally records which photos
 * go on the inspiration feed: { showcase: { fileNames: [...], caption } } (ignored unless the
 * project has feed consent switched on).
 */
export async function POST(req: Request, ctx: RouteContext<"/api/checkins/[id]/approve">): Promise<Response> {
  const store = getStore();
  const body = await readJson(req);
  if (!body) return json({ error: "Send JSON: { message }" }, 400);
  const principal = await resolveToken(store, tokenFromRequest(req, body.token));
  if (!principal) return unauthorized();
  if (principal.role !== "owner") return forbidden();

  const { id } = await ctx.params;
  const msg = validateMessage(body.message);
  if (!msg.ok) return json({ error: msg.error }, 400);

  const checkin = await store.getCheckin(id);
  if (!checkin) return notFound();
  const project = await store.getProject(checkin.projectId);
  let selection;
  if (body.showcase !== undefined && project?.showcase) {
    const v = validateShowcase(body.showcase, checkin);
    if (!v.ok) return json({ error: v.errors.join(" ") }, 400);
    selection = v.value;
  }
  try {
    const c = await store.approveCheckin(id, msg.text, new Date().toISOString(), selection);
    return json({ id: c.id, status: c.review, approvedAt: c.approvedAt });
  } catch (e) {
    if (errorCode(e) === "NOT_FOUND") return notFound();
    if (errorCode(e) === "CONFLICT") return json({ error: "This update has already been published" }, 409);
    throw e;
  }
}
