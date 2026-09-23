import "server-only";
import { createWriteStream } from "node:fs";
import { open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { storage } from "./storage";
import { config } from "./config";
import { HttpError } from "./http";
import { sniff } from "./sniff";
import { getMedia, getRow, insertMedia, clean, folderExists } from "./media";
import { UPLOAD_RULES } from "@/lib/types";
import type { Media } from "@/lib/types";

// libvips keeps file handles open when caching; on Windows that blocks moving/deleting temp files.
sharp.cache(false);

const num = (v: string | null, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= max ? n : null;
};

const mbLabel = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/**
 * Streams a raw request body (the file itself) to a temp file, then validates it by content,
 * generates a thumbnail for images, moves it into storage and records it. The response is only
 * sent after the file and its metadata are both saved.
 */
export async function receiveUpload(req: Request): Promise<{ media: Media; folderMissing: boolean }> {
  if (!req.body) throw new HttpError(400, "No file was received.");
  const fileName = clean(safeDecode(req.headers.get("x-file-name") ?? "upload"), 255) || "upload";
  const declared = req.headers.get("content-type") ?? "";
  const declaredKind = declared.startsWith("video/") ? "video" : "image";
  const hardLimit = Math.max(config.maxImageBytes, config.maxVideoBytes);
  const declaredLimit = declaredKind === "video" ? config.maxVideoBytes : config.maxImageBytes;
  const length = Number(req.headers.get("content-length"));
  if (Number.isFinite(length) && length > declaredLimit)
    throw new HttpError(413, `This file is larger than the ${mbLabel(declaredLimit)} limit for ${declaredKind}s.`);

  // Optional destination folder. If it was deleted mid-upload the file is saved unfiled instead.
  const wantedFolder = clean(req.headers.get("x-folder-id") ?? "", 64) || null;

  const id = randomUUID();
  const temp = path.join(storage().tempDir(), `${id}.part`);
  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      if (received > hardLimit) cb(new HttpError(413, `This file is larger than the ${mbLabel(hardLimit)} upload limit.`));
      else cb(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(req.body as import("node:stream/web").ReadableStream), counter, createWriteStream(temp), { signal: req.signal });
  } catch (e) {
    await rm(temp, { force: true });
    if (e instanceof HttpError) throw e;
    if ((e as Error)?.name !== "AbortError") console.error("[upload] stream failed:", e);
    throw new HttpError(499, "The upload was interrupted before it finished.");
  }

  try {
    // A body shorter than its declared length means the client went away mid-upload: never keep a partial file.
    if (Number.isFinite(length) && length > 0 && received !== length)
      throw new HttpError(499, "The upload was interrupted before it finished.");
    if (received === 0) throw new HttpError(400, "This file is empty.");
    const head = Buffer.alloc(64);
    const fh = await open(temp, "r");
    await fh.read(head, 0, 64, 0);
    await fh.close();
    const type = sniff(head);
    if (type && "unsupported" in type) throw new HttpError(415, type.unsupported);
    if (!type) throw new HttpError(415, `This file type isn't supported. Upload ${UPLOAD_RULES.image.label} images or ${UPLOAD_RULES.video.label} videos.`);
    const limit = type.kind === "video" ? config.maxVideoBytes : config.maxImageBytes;
    if (received > limit) throw new HttpError(413, `This ${type.kind} is larger than the ${mbLabel(limit)} limit.`);

    const base = `media/${id}`;
    const key = `${base}/original.${type.ext}`;
    let width: number | null = null, height: number | null = null, duration: number | null = null;
    let thumbKey: string | null = null;

    if (type.kind === "image") {
      // Decode from memory so no handle to the temp file stays open (images are size-capped).
      const input = await readFile(temp);
      let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
      try {
        meta = await sharp(input).metadata();
      } catch {
        throw new HttpError(422, "This image couldn't be read. It may be damaged — try exporting it again.");
      }
      const rotated = (meta.orientation ?? 1) >= 5;
      width = (rotated ? meta.height : meta.width) ?? null;
      height = (rotated ? meta.width : meta.height) ?? null;
      const thumb = await sharp(input)
        .rotate()
        .resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer()
        .catch(() => { throw new HttpError(422, "This image couldn't be decoded. It may be damaged — try exporting it again."); });
      thumbKey = `${base}/thumb.webp`;
      await storage().putBuffer(thumbKey, thumb, "image/webp");
    } else {
      // No server-side video decoder is bundled; dimensions/duration are read by the uploading browser.
      width = num(req.headers.get("x-media-width"), 16384);
      height = num(req.headers.get("x-media-height"), 16384);
      duration = num(req.headers.get("x-media-duration"), 60 * 60 * 24);
    }

    await storage().putFile(key, temp, type.mime);
    const folderId = wantedFolder && folderExists(wantedFolder) ? wantedFolder : null;
    insertMedia({
      id, kind: type.kind, mime: type.mime, ext: type.ext, original_name: fileName, size: received,
      width, height, duration, storage_key: key, thumb_key: thumbKey, created_at: Date.now(), folder_id: folderId,
    });
    return { media: getMedia(id), folderMissing: !!wantedFolder && !folderId };
  } finally {
    await rm(temp, { force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
  }
}

/** Stores a browser-captured poster frame for a video. */
export async function savePoster(mediaId: string, body: ArrayBuffer) {
  const buf = Buffer.from(body);
  if (buf.length === 0 || buf.length > 8 * 1024 * 1024) throw new HttpError(400, "Invalid poster image.");
  const sniffed = sniff(buf);
  if (!sniffed || "unsupported" in sniffed || sniffed.kind !== "image") throw new HttpError(415, "The poster must be a JPEG, PNG or WebP image.");
  const out = await sharp(buf).resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
    .catch(() => { throw new HttpError(422, "The poster image couldn't be read."); });
  // Stored next to the original (older items keep their original folder layout).
  const original = getRow(mediaId).storage_key;
  const key = `${original.slice(0, original.lastIndexOf("/"))}/thumb.webp`;
  await storage().putBuffer(key, out, "image/webp");
  return key;
}

function safeDecode(s: string) {
  try { return decodeURIComponent(s); } catch { return s; }
}
