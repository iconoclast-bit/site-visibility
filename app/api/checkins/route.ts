import { randomUUID } from "node:crypto";
import { resolveToken, tokenFromRequest } from "@/lib/auth";
import { todayIST } from "@/lib/dates";
import { templateDraft } from "@/lib/draft";
import { forbidden, json, unauthorized } from "@/lib/http";
import { EXT, sniffImage, stripMetadata } from "@/lib/photos";
import { getStore } from "@/lib/store";
import type { Checkin } from "@/lib/types";
import { LIMITS, validateCheckin } from "@/lib/validation";

function field(form: FormData, name: string): string | undefined {
  const v = form.get(name);
  return typeof v === "string" ? v : undefined;
}

function parseJsonField(raw: string | undefined, fallback: unknown): { ok: true; value: unknown } | { ok: false } {
  if (raw === undefined || raw === "") return { ok: true, value: fallback };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

export async function POST(req: Request): Promise<Response> {
  const store = getStore();
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > LIMITS.maxTotalBytes) return json({ errors: ["Upload is too large"] }, 413);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ errors: ["Send the check-in as multipart form data"] }, 400);
  }

  const principal = await resolveToken(store, tokenFromRequest(req, field(form, "token")));
  if (!principal) return unauthorized();
  if (principal.role !== "supervisor") return forbidden();

  const projectId = field(form, "projectId") ?? "";
  const project = await store.getProject(projectId);
  if (!project || !principal.supervisor.projectIds.includes(project.id)) return forbidden();

  const updates = parseJsonField(field(form, "updates"), []);
  const photoMeta = parseJsonField(field(form, "photoMeta"), []);
  const location = parseJsonField(field(form, "location"), null);
  if (!updates.ok || !photoMeta.ok || !location.ok) return json({ errors: ["updates, photoMeta and location must be valid JSON"] }, 400);

  const files = form.getAll("photos").filter((v): v is File => typeof v !== "string");
  const now = new Date();
  const checked = validateCheckin(
    {
      id: field(form, "id"),
      updates: updates.value,
      note: field(form, "note") ?? "",
      photoMeta: photoMeta.value,
      location: location.value,
      submittedAt: field(form, "submittedAt"),
      fileCount: files.length,
    },
    project,
    now,
  );
  if (!checked.ok) return json({ errors: checked.errors }, 400);
  const v = checked.value;
  const id = v.id ?? randomUUID();

  // Idempotent retry: the same id from the same supervisor/project is a duplicate, not a second check-in.
  const existing = await store.getCheckin(id);
  if (existing) {
    if (existing.projectId !== project.id || existing.supervisorId !== principal.supervisor.id) return json({ errors: ["id already used"] }, 409);
    return json({ id, status: existing.review, duplicate: true }, 200);
  }

  const blobs: { fileName: string; bytes: Uint8Array }[] = [];
  const photos: Checkin["photos"] = [];
  for (const [i, file] of files.entries()) {
    if (file.size > LIMITS.maxPhotoBytes) return json({ errors: [`Photo ${i + 1} is too large (max ${LIMITS.maxPhotoBytes / 1024 / 1024} MB)`] }, 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniffImage(bytes);
    if (!kind) return json({ errors: [`Photo ${i + 1}: only JPEG, PNG or WebP images are accepted (SVG and other formats are not allowed)`] }, 400);
    const fileName = `${id}-${i + 1}.${EXT[kind]}`;
    blobs.push({ fileName, bytes: stripMetadata(bytes, kind) });
    photos.push({ fileName, ...v.photoMeta[i] });
  }

  const checkin: Checkin = {
    id,
    projectId: project.id,
    supervisorId: principal.supervisor.id,
    date: v.date,
    createdAt: v.createdAt,
    updates: v.updates,
    note: v.note,
    photos,
    location: v.location,
    review: "pending",
  };
  const all = await store.listCheckins(project.id);
  checkin.draftMessage = templateDraft({ project, checkin, allCheckins: [...all, checkin], today: todayIST(now) });

  const saved = await store.addCheckin(checkin, blobs);
  return json({ id: saved.checkin.id, status: saved.checkin.review, duplicate: !saved.created }, saved.created ? 201 : 200);
}
