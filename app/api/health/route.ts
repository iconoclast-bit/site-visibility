import { connection } from "next/server";
import { json } from "@/lib/http";
import { getStore } from "@/lib/store";

/** Uptime/deploy check. Touches the database; reveals nothing else. */
export async function GET(): Promise<Response> {
  await connection(); // always run at request time, never during `next build` (no build-time database access)
  try {
    await getStore().getStudio();
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 503);
  }
}
