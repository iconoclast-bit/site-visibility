"use client";
/**
 * Offline-safe outbox. A check-in is saved here BEFORE the first send attempt and
 * removed only after the server confirms, so a dropped 4G connection never loses
 * work. IndexedDB holds the photo blobs; if IndexedDB is unavailable (private mode,
 * old WebView) an in-memory map keeps retry working until the tab closes.
 * The check-in id is the idempotency key: re-sending can never create a duplicate.
 */
export interface QueuedPhoto { blob: Blob; stageId: string; takenAt: string; width: number; height: number }
export interface QueuedCheckin {
  id: string;
  token: string;
  projectId: string;
  projectName: string;
  submittedAt: string;
  updates: unknown[];
  note: string;
  location: { lat: number; lng: number; accuracy?: number } | null;
  photos: QueuedPhoto[];
  summary: string;
}

const DB_NAME = "site-visibility";
const STORE = "outbox";
const memory = new Map<string, QueuedCheckin>();

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putOutbox(item: QueuedCheckin): Promise<void> {
  memory.set(item.id, item);
  const db = await openDb();
  if (!db) return;
  try { await tx(db, "readwrite", (s) => s.put(item)); } catch { /* memory copy still exists */ } finally { db.close(); }
}

export async function removeOutbox(id: string): Promise<void> {
  memory.delete(id);
  const db = await openDb();
  if (!db) return;
  try { await tx(db, "readwrite", (s) => s.delete(id)); } catch { /* ignore */ } finally { db.close(); }
}

export async function listOutbox(token?: string): Promise<QueuedCheckin[]> {
  const found = new Map<string, QueuedCheckin>(memory);
  const db = await openDb();
  if (db) {
    try {
      const all = (await tx(db, "readonly", (s) => s.getAll() as IDBRequest<QueuedCheckin[]>)) ?? [];
      for (const it of all) found.set(it.id, it);
    } catch { /* ignore */ } finally { db.close(); }
  }
  return [...found.values()].filter((i) => !token || i.token === token).sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

export type SendResult = { ok: true } | { ok: false; retry: boolean; message: string };

export function toFormData(item: QueuedCheckin): FormData {
  const fd = new FormData();
  fd.set("token", item.token);
  fd.set("projectId", item.projectId);
  fd.set("id", item.id);
  fd.set("submittedAt", item.submittedAt);
  fd.set("updates", JSON.stringify(item.updates));
  fd.set("note", item.note);
  fd.set("location", JSON.stringify(item.location));
  fd.set("photoMeta", JSON.stringify(item.photos.map((p) => ({ stageId: p.stageId, takenAt: p.takenAt, width: p.width, height: p.height }))));
  item.photos.forEach((p, i) => fd.append("photos", p.blob, `photo-${i + 1}.jpg`));
  return fd;
}

export async function sendQueued(item: QueuedCheckin, timeoutMs = 90_000): Promise<SendResult> {
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? window.setTimeout(() => ctrl.abort(), timeoutMs) : 0;
  try {
    const res = await fetch("/api/checkins", { method: "POST", body: toFormData(item), signal: ctrl?.signal });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    const detail = Array.isArray(body.errors) ? body.errors.join(" ") : body.error;
    if (res.status === 401 || res.status === 403) return { ok: false, retry: false, message: "This link no longer works. Please ask the studio for a new one." };
    if (res.status === 413) return { ok: false, retry: false, message: "The photos are too large to send together. Remove a few and send again." };
    if (res.status >= 500 || res.status === 408 || res.status === 429) return { ok: false, retry: true, message: "The server is busy. Your update is saved on this phone. Tap Retry in a moment." };
    return { ok: false, retry: false, message: detail || `The update was not accepted (error ${res.status}).` };
  } catch {
    return { ok: false, retry: true, message: "No internet right now. Your update is saved on this phone. Tap Retry when you have signal." };
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

export function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const b = new Uint8Array(16);
      crypto.getRandomValues(b);
      return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    }
  } catch { /* fall through */ }
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
