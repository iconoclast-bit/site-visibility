"use client";

/** Tiny fetch helper for the owner screens: always JSON in/out, never throws. */
export async function sendJson(url: string, method: "POST" | "PUT" | "PATCH", body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { errors: ["No connection. Check your network and try again."] } };
  }
}

export function errorText(data: Record<string, unknown>, fallback = "Something went wrong. Please try again."): string {
  if (Array.isArray(data.errors)) return data.errors.join(" ");
  if (typeof data.error === "string") return data.error;
  return fallback;
}
