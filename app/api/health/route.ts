import { json } from "@/lib/http";
import { getStore } from "@/lib/store";

/** Uptime/deploy check. Touches the database; reveals nothing else. */
export async function GET(): Promise<Response> {
  try {
    await getStore().getStudio();
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 503);
  }
}
