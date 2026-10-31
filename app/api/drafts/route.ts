import { aiConfigured, rewriteDraft } from "@/lib/ai";
import { resolveToken, tokenFromRequest } from "@/lib/auth";
import { todayIST } from "@/lib/dates";
import { allowedDates, allowedDayCounts, stateAfter, templateDraft } from "@/lib/draft";
import { forbidden, json, notFound, readJson, unauthorized } from "@/lib/http";
import { getStore } from "@/lib/store";

/** Owner only. The ONE optional LLM call: rewrite a pending check-in's template draft. */
export async function POST(req: Request): Promise<Response> {
  const store = getStore();
  const body = await readJson(req);
  if (!body) return json({ error: "Send JSON: { checkinId }" }, 400);
  const principal = await resolveToken(store, tokenFromRequest(req, body.token));
  if (!principal) return unauthorized();
  if (principal.role !== "owner") return forbidden();

  if (!aiConfigured()) return json({ error: "AI rewrite is not configured (set ANTHROPIC_API_KEY)" }, 501);

  const checkin = typeof body.checkinId === "string" ? await store.getCheckin(body.checkinId) : null;
  if (!checkin) return notFound();
  if (checkin.review === "approved") return json({ error: "This update has already been published" }, 409);
  const project = await store.getProject(checkin.projectId);
  if (!project) return notFound();

  const today = todayIST();
  const ctx = { project, checkin, allCheckins: await store.listCheckins(project.id), today };
  const template = templateDraft(ctx);
  const { schedule } = stateAfter(ctx);
  const result = await rewriteDraft(
    template,
    { allowedDates: allowedDates(project, schedule, [checkin.date, today]), allowedDayCounts: allowedDayCounts(schedule) },
    { apiKey: process.env.ANTHROPIC_API_KEY!.trim(), model: process.env.ANTHROPIC_MODEL?.trim() || undefined },
  );
  return json(result);
}
