import { validateAmc } from "@/lib/adminValidation";
import { resolveToken, tokenFromRequest } from "@/lib/auth";
import { forbidden, json, notFound, readJson, unauthorized } from "@/lib/http";
import { errorCode, getStore } from "@/lib/store";

/** Owner only: set or replace the project's AMC (the visit log is preserved), or remove it with { amc: null }. */
export async function PUT(req: Request, ctx: RouteContext<"/api/projects/[id]/amc">): Promise<Response> {
  const store = getStore();
  const body = await readJson(req);
  if (!body) return json({ errors: ["Send JSON"] }, 400);
  const who = await resolveToken(store, tokenFromRequest(req, body.token));
  if (!who) return unauthorized();
  if (who.role !== "owner") return forbidden();
  const { id } = await ctx.params;
  const project = await store.getProject(id);
  if (!project) return notFound();

  let amc = null;
  if (body.amc !== null) {
    const v = validateAmc(body.amc, project.amc?.visitLog ?? []);
    if (!v.ok) return json({ errors: v.errors }, 400);
    amc = v.value;
  }
  try {
    await store.updateProject(id, (p) => {
      if (amc) p.amc = amc;
      else delete p.amc;
    });
  } catch (e) {
    if (errorCode(e) === "NOT_FOUND") return notFound();
    throw e;
  }
  return json({ id, amc });
}
