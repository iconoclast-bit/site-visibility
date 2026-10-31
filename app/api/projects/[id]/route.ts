import { validateProjectPatch } from "@/lib/adminValidation";
import { resolveToken, tokenFromRequest } from "@/lib/auth";
import { forbidden, json, notFound, readJson, unauthorized } from "@/lib/http";
import { errorCode, getStore } from "@/lib/store";

/** Owner only: project settings (feed consent, home label, client phone). */
export async function PATCH(req: Request, ctx: RouteContext<"/api/projects/[id]">): Promise<Response> {
  const store = getStore();
  const body = await readJson(req);
  if (!body) return json({ errors: ["Send JSON"] }, 400);
  const who = await resolveToken(store, tokenFromRequest(req, body.token));
  if (!who) return unauthorized();
  if (who.role !== "owner") return forbidden();
  const v = validateProjectPatch(body);
  if (!v.ok) return json({ errors: v.errors }, 400);
  const { id } = await ctx.params;
  try {
    const p = await store.updateProject(id, (proj) => {
      if (v.value.showcase !== undefined) proj.showcase = v.value.showcase;
      if (v.value.homeType !== undefined) proj.homeType = v.value.homeType;
      if (v.value.style !== undefined) proj.style = v.value.style || undefined;
      if (v.value.clientPhone !== undefined) proj.clientPhone = v.value.clientPhone ?? undefined;
    });
    return json({ id: p.id, showcase: p.showcase, homeType: p.homeType, style: p.style ?? "", clientPhone: p.clientPhone ?? "" });
  } catch (e) {
    if (errorCode(e) === "NOT_FOUND") return notFound();
    throw e;
  }
}
