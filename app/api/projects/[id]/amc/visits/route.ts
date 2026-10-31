import { validateVisit } from "@/lib/adminValidation";
import { resolveToken, tokenFromRequest } from "@/lib/auth";
import { todayIST } from "@/lib/dates";
import { forbidden, json, notFound, readJson, unauthorized } from "@/lib/http";
import { errorCode, getStore } from "@/lib/store";

/** Owner only: log a completed AMC service visit (shown to the client). */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/amc/visits">): Promise<Response> {
  const store = getStore();
  const body = await readJson(req);
  if (!body) return json({ errors: ["Send JSON"] }, 400);
  const who = await resolveToken(store, tokenFromRequest(req, body.token));
  if (!who) return unauthorized();
  if (who.role !== "owner") return forbidden();
  const { id } = await ctx.params;
  const project = await store.getProject(id);
  if (!project) return notFound();
  if (!project.amc) return json({ errors: ["This project has no AMC yet. Add the AMC first."] }, 409);
  const v = validateVisit(body, todayIST());
  if (!v.ok) return json({ errors: v.errors }, 400);
  try {
    const p = await store.updateProject(id, (proj) => {
      if (!proj.amc) return;
      proj.amc.visitLog = [...proj.amc.visitLog, v.value].sort((a, b) => a.date.localeCompare(b.date));
    });
    return json({ visits: p.amc?.visitLog.length ?? 0 }, 201);
  } catch (e) {
    if (errorCode(e) === "NOT_FOUND") return notFound();
    throw e;
  }
}
