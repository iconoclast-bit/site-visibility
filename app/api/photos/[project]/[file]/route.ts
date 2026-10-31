import { resolveToken } from "@/lib/auth";
import { MIME } from "@/lib/photos";
import { getStore } from "@/lib/store";

const gone = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

/**
 * owner: any photo. supervisor: photos of their projects.
 * client: only photos that belong to an APPROVED check-in of their own project.
 * Everything else is a plain 404 so nothing is revealed.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/photos/[project]/[file]">): Promise<Response> {
  const store = getStore();
  const { project: projectId, file } = await ctx.params;
  const principal = await resolveToken(store, new URL(req.url).searchParams.get("t"));
  if (!principal) return gone();

  if (principal.role === "supervisor" && !principal.supervisor.projectIds.includes(projectId)) return gone();
  if (principal.role === "client") {
    if (principal.project.id !== projectId) return gone();
    const checkins = await store.listCheckins(projectId);
    const visible = checkins.some((c) => c.review === "approved" && c.photos.some((p) => p.fileName === file));
    if (!visible) return gone();
  }

  const bytes = await store.readPhoto(projectId, file);
  if (!bytes) return gone();
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  const type = MIME[ext];
  if (!type) return gone();
  const headers: Record<string, string> = {
    "content-type": type,
    "cache-control": "private, max-age=300",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex",
  };
  if (ext === "svg") headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  return new Response(bytes as BodyInit, { status: 200, headers });
}
