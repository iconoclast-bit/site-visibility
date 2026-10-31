import { resolveToken } from "@/lib/auth";
import { MIME } from "@/lib/photos";
import { getStore } from "@/lib/store";

const gone = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

/**
 * Inspiration-feed photo by OPAQUE handle (no project id or file name in the URL).
 * Visible to the studio owner and to clients only while: the owner selected it, its update is
 * published, and its project's feed consent is on. Everything else is a plain 404.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/feed/[id]">): Promise<Response> {
  const store = getStore();
  const { id } = await ctx.params;
  const who = await resolveToken(store, new URL(req.url).searchParams.get("t"));
  if (!who || (who.role !== "client" && who.role !== "owner")) return gone();

  const checkin = await store.findCheckinByShowcaseId(id);
  if (!checkin || checkin.review !== "approved") return gone();
  const project = await store.getProject(checkin.projectId);
  const hit = checkin.showcase?.find((s) => s.id === id);
  if (!project?.showcase || !hit || !checkin.photos.some((p) => p.fileName === hit.fileName)) return gone();

  const bytes = await store.readPhoto(project.id, hit.fileName);
  const type = MIME[hit.fileName.split(".").pop()?.toLowerCase() ?? ""];
  if (!bytes || !type) return gone();
  const headers: Record<string, string> = { "content-type": type, "cache-control": "private, max-age=300", "x-content-type-options": "nosniff", "x-robots-tag": "noindex" };
  if (type === "image/svg+xml") headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  return new Response(bytes as BodyInit, { status: 200, headers });
}
