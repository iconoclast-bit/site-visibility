import { newId, newToken, validateNewProject } from "@/lib/adminValidation";
import { resolveToken, tokenFromRequest } from "@/lib/auth";
import { forbidden, json, readJson, unauthorized } from "@/lib/http";
import { getStore } from "@/lib/store";

/** Owner only: create a project (default stage template), optionally creating its supervisor too. */
export async function POST(req: Request): Promise<Response> {
  const store = getStore();
  const body = await readJson(req);
  if (!body) return json({ errors: ["Send JSON"] }, 400);
  const who = await resolveToken(store, tokenFromRequest(req, body.token));
  if (!who) return unauthorized();
  if (who.role !== "owner") return forbidden();

  const supervisors = await store.listSupervisors();
  const v = validateNewProject(body, supervisors.map((s) => s.id));
  if (!v.ok) return json({ errors: v.errors }, 400);

  let supervisorId = v.value.supervisorId;
  let supervisorToken: string | undefined;
  if (!supervisorId) {
    const s = await store.createSupervisor({ id: newId("sup-"), name: v.value.newSupervisorName!, token: newToken(), projectIds: [] });
    supervisorId = s.id;
    supervisorToken = s.token;
  }
  const project = await store.createProject({ ...v.value.project, supervisorId });
  return json({ id: project.id, clientToken: project.clientToken, supervisorId, supervisorToken }, 201);
}
