"use client";
/**
 * Client-side photo prep: decode -> scale to max 1600px -> re-encode as JPEG via a
 * canvas. Re-encoding drops EXIF/GPS (the server strips metadata again as a second
 * line of defence). Every browser API is feature-checked because cheap Android
 * WebViews lack some: createImageBitmap, canvas.toBlob.
 */
export const MAX_SIDE = 1600;
export const JPEG_QUALITY = 0.8;

/**
 * Total photo bytes per check-in. Serverless hosts cap request bodies (Vercel: 4.5 MB), and a
 * check-in can carry 8 photos, so photos are re-encoded smaller when the total would not fit.
 */
export const UPLOAD_BUDGET = 3_400_000;
export const TIERS: { maxSide: number; quality: number }[] = [
  { maxSide: 1600, quality: 0.8 },
  { maxSide: 1400, quality: 0.65 },
  { maxSide: 1200, quality: 0.55 },
  { maxSide: 1000, quality: 0.5 },
  { maxSide: 800, quality: 0.45 },
];

export interface PreparedPhoto { blob: Blob; width: number; height: number }

interface Decoded { source: CanvasImageSource; width: number; height: number; release: () => void }

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    for (const opts of [{ imageOrientation: "from-image" }, undefined] as const) {
      try {
        const bmp = await (opts ? createImageBitmap(file, opts as ImageBitmapOptions) : createImageBitmap(file));
        return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close?.() };
      } catch {
        /* try the next strategy */
      }
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  if (typeof canvas.toBlob === "function") {
    const blob = await new Promise<Blob | null>((resolve) => {
      try { canvas.toBlob(resolve, "image/jpeg", quality); } catch { resolve(null); }
    });
    if (blob && blob.size > 0) return blob;
  }
  return dataUrlToBlob(canvas.toDataURL("image/jpeg", quality));
}

export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function preparePhoto(file: Blob, opts: { maxSide?: number; quality?: number } = {}): Promise<PreparedPhoto> {
  const d = await decode(file);
  try {
    if (!d.width || !d.height) throw new Error("empty image");
    const size = fitWithin(d.width, d.height, opts.maxSide ?? MAX_SIDE);
    const canvas = document.createElement("canvas");
    const ctx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    if (!ctx) {
      // No canvas at all: send the original; the server strips metadata. Only for allowed types.
      if (/^image\/(jpeg|png|webp)$/.test(file.type)) return { blob: file, width: d.width, height: d.height };
      throw new Error("This phone cannot prepare this photo type");
    }
    canvas.width = size.width;
    canvas.height = size.height;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(d.source, 0, 0, size.width, size.height);
    const blob = await canvasToJpeg(canvas, opts.quality ?? JPEG_QUALITY);
    return { blob, ...size };
  } finally {
    d.release();
  }
}

export interface BudgetItem { source: Blob; blob: Blob; width: number; height: number }
export class BudgetError extends Error {}

/**
 * Shrink photos tier by tier until their total fits the budget. Pure apart from `prepare`
 * (injected so it can be tested without a browser). Throws BudgetError if even the smallest tier is too big.
 */
export async function fitToBudget(
  items: BudgetItem[],
  prepare: (source: Blob, opts: { maxSide: number; quality: number }) => Promise<PreparedPhoto>,
  budget = UPLOAD_BUDGET,
): Promise<PreparedPhoto[]> {
  let current: PreparedPhoto[] = items.map(({ blob, width, height }) => ({ blob, width, height }));
  const total = (xs: PreparedPhoto[]) => xs.reduce((n, p) => n + p.blob.size, 0);
  if (total(current) <= budget) return current;
  for (const tier of TIERS.slice(1)) {
    current = [];
    for (const it of items) current.push(await prepare(it.source, tier)); // one at a time: gentle on cheap phones
    if (total(current) <= budget) return current;
  }
  throw new BudgetError("These photos are too large to send together");
}
