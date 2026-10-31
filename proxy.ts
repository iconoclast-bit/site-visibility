/**
 * Gives page routes a real HTTP 404 for bad links BEFORE any streaming starts
 * (Suspense-streamed pages would otherwise answer 200). Pages and API routes
 * still authorise on their own; this is an extra layer, not the only one.
 */
import type { NextRequest } from "next/server";
import { resolveToken } from "@/lib/auth";
import { demoHubEnabled, getStore } from "@/lib/store";

export const config = { matcher: ["/", "/s/:path*", "/a/:path*", "/c/:path*"] };

const NOT_FOUND = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Link not valid</title></head><body style="font-family:system-ui,sans-serif;padding:32px;max-width:520px;margin:auto"><h1>This link isn&#39;t valid</h1><p>Please ask the studio for the latest link.</p></body></html>`;

function notFound(): Response {
  return new Response(NOT_FOUND, {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex", "cache-control": "no-store" },
  });
}

export async function proxy(req: NextRequest): Promise<Response | undefined> {
  const [, area, token, projectId] = req.nextUrl.pathname.split("/");
  if (!area) return demoHubEnabled() ? undefined : notFound(); // the demo hub is switched off with DEMO_HUB=off
  const store = getStore();
  const who = await resolveToken(store, token ? decodeURIComponent(token) : null);
  if (!who) return notFound();
  if (area === "a" && who.role !== "owner") return notFound();
  if (area === "c" && who.role !== "client") return notFound();
  if (area === "s") {
    if (who.role !== "supervisor") return notFound();
    if (projectId && !who.supervisor.projectIds.includes(projectId)) return notFound();
  }
  if (area === "a" && projectId && projectId !== "new" && !(await store.getProject(projectId))) return notFound();
  if (area === "c" && projectId) return notFound(); // client has a single page
  return undefined;
}
