/**
 * Photo upload safety: sniff the real type from bytes (never trust the name or
 * mime header), reject SVG, and strip metadata (EXIF/GPS/XMP) server-side as a
 * second line of defence. The browser already re-encodes via canvas.
 */
export type ImageKind = "jpeg" | "png" | "webp";

export const EXT: Record<ImageKind, string> = { jpeg: "jpg", png: "png", webp: "webp" };
export const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  svg: "image/svg+xml", // seed demo photos only
};

export function sniffImage(b: Uint8Array): ImageKind | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length > 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  return null;
}

function ascii(b: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...b.slice(from, to));
}

/** Drop APP1..APP15 and COM segments (EXIF, XMP, ICC extras, comments) but keep APP0 and image data. */
export function stripJpeg(b: Uint8Array): Uint8Array {
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) break;
    const marker = b[i + 1];
    if (marker === 0xda) break; // start of scan: copy the rest as-is
    if (marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
      if (marker === 0xff) { i += 1; continue; }
      out.push(0xff, marker);
      i += 2;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    const end = i + 2 + len;
    if (end > b.length) break;
    const drop = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!drop) for (let k = i; k < end; k++) out.push(b[k]);
    i = end;
  }
  const head = Uint8Array.from(out);
  const tail = b.slice(i);
  const res = new Uint8Array(head.length + tail.length);
  res.set(head, 0);
  res.set(tail, head.length);
  return res;
}

/** Drop text/EXIF chunks from a PNG. */
export function stripPng(b: Uint8Array): Uint8Array {
  const DROP = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);
  const parts: Uint8Array[] = [b.slice(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const type = ascii(b, i + 4, i + 8);
    const end = i + 12 + len;
    if (end > b.length) { parts.push(b.slice(i)); i = b.length; break; }
    if (!DROP.has(type)) parts.push(b.slice(i, end));
    i = end;
  }
  return concat(parts);
}

/** Drop EXIF and XMP chunks from a WebP (RIFF) and fix the container size / VP8X flags. */
export function stripWebp(b: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, i + 4);
    const len = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24);
    const padded = len + (len % 2);
    const end = Math.min(i + 8 + padded, b.length);
    if (type !== "EXIF" && type !== "XMP ") {
      const chunk = b.slice(i, end);
      if (type === "VP8X" && chunk.length > 8) chunk[8] &= ~(0x08 | 0x04); // clear EXIF + XMP flags
      chunks.push(chunk);
    }
    i = end;
  }
  const body = concat(chunks);
  const out = new Uint8Array(12 + body.length);
  out.set(b.slice(0, 12), 0);
  const size = 4 + body.length;
  out[4] = size & 0xff; out[5] = (size >> 8) & 0xff; out[6] = (size >> 16) & 0xff; out[7] = (size >> 24) & 0xff;
  out.set(body, 12);
  return out;
}

export function stripMetadata(b: Uint8Array, kind: ImageKind): Uint8Array {
  return kind === "jpeg" ? stripJpeg(b) : kind === "png" ? stripPng(b) : stripWebp(b);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Has EXIF/XMP/comment segments? (used by tests and the E2E assertions) */
export function jpegHasMetadata(b: Uint8Array): boolean {
  let i = 2;
  while (i + 3 < b.length && b[i] === 0xff) {
    const m = b[i + 1];
    if (m === 0xda) return false;
    if ((m >= 0xe1 && m <= 0xef) || m === 0xfe) return true;
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return false;
}
