import sharp from "sharp";
import { config } from "@/server/config";
import { persistMediaRow, syncMediaMetadata } from "@/server/blob-meta";
import { clean, folderExists, getMedia, getRow, upsertMedia, type MediaRow } from "@/server/media";
import { fail, handle, HttpError, json, readJson, requireAccess } from "@/server/http";
import { sniff } from "@/server/sniff";
import { storage } from "@/server/storage";
import type { MediaKind } from "@/lib/types";

type Body = {
  id?: unknown; pathname?: unknown; name?: unknown; folderId?: unknown;
  width?: unknown; height?: unknown; duration?: unknown;
};

const finite = (v: unknown, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= max ? n : null;
};

async function readStored(key: string, range?: { start: number; end: number }) {
  const chunks: Buffer[] = [];
  for await (const chunk of await storage().read(key, range))
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function fileName(input: unknown, ext: string) {
  const cleaned = clean(input, 255) || "upload";
  const base = cleaned.replace(/\.[a-z0-9]{1,8}$/i, "").trim().replace(/\.+$/, "") || "upload";
  return `${base}.${ext}`;
}

export const POST = handle(async (req) => {
  await requireAccess(req);
  if (!['vercel-blob', 's3'].includes(config.storageDriver)) return fail(404, "Direct uploads are not enabled.");
  const body = await readJson<Body>(req);
  const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : "";
  const pathname = typeof body.pathname === "string" ? body.pathname : "";
  if (!id || !pathname.startsWith(`media/${id}/original.`)) return fail(400, "Invalid uploaded file.");

  // Finalization is safe to retry after a lost response. Hydrate first because another serverless
  // instance may already have committed the durable metadata sidecar.
  await syncMediaMetadata();
  try {
    const existing = getRow(id);
    if (existing.storage_key !== pathname) return fail(409, "This upload id is already in use.");
    return json({ media: getMedia(id), folderMissing: false }, 200);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) throw error;
  }

  const blobSize = await storage().size(pathname);
  if (blobSize == null) throw new HttpError(404, "The uploaded file could not be found. Please try the upload again.");
  if (blobSize <= 0) throw new HttpError(400, "This file is empty.");

  // The browser-provided MIME type and extension are not trusted. Read the signature from the
  // durable object, just as the local upload path does.
  const detected = sniff(await readStored(pathname, { start: 0, end: Math.min(63, blobSize - 1) }));
  if (detected && "unsupported" in detected) throw new HttpError(415, detected.unsupported);
  if (!detected) throw new HttpError(415, "This file type isn't supported. Upload JPEG, PNG or WebP images, or MP4 and WebM videos.");
  const kind: MediaKind = detected.kind;
  const limit = kind === "video" ? config.maxVideoBytes : config.maxImageBytes;
  if (blobSize > limit) throw new HttpError(413, `This ${kind} exceeds the upload limit.`);

  let width = finite(body.width, 16384);
  let height = finite(body.height, 16384);
  const duration = kind === "video" ? finite(body.duration, 60 * 60 * 24) : null;
  let thumbKey: string | null = null;

  if (kind === "image") {
    const input = await readStored(pathname);
    let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
    try { meta = await sharp(input).metadata(); }
    catch { throw new HttpError(422, "This image couldn't be read. It may be damaged — try exporting it again."); }
    const rotated = (meta.orientation ?? 1) >= 5;
    width = (rotated ? meta.height : meta.width) ?? null;
    height = (rotated ? meta.width : meta.height) ?? null;
    const thumb = await sharp(input)
      .rotate()
      .resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer()
      .catch(() => { throw new HttpError(422, "This image couldn't be decoded. It may be damaged — try exporting it again."); });
    thumbKey = `media/${id}/thumb.webp`;
    await storage().putBuffer(thumbKey, thumb, "image/webp");
  }

  const wantedFolder = clean(body.folderId, 64) || null;
  const row: MediaRow = {
    id, kind, mime: detected.mime, ext: detected.ext,
    original_name: fileName(body.name, detected.ext), size: blobSize,
    width, height, duration, storage_key: pathname, thumb_key: thumbKey,
    created_at: Date.now(), folder_id: wantedFolder && folderExists(wantedFolder) ? wantedFolder : null,
    trashed_at: null,
  };

  // Persist the durable sidecar before updating this instance's disposable SQLite cache. If this
  // process disappears after the put, the next request reconstructs the row from Blob.
  await persistMediaRow(row);
  upsertMedia(row);
  return json({ media: getMedia(id), folderMissing: !!wantedFolder && row.folder_id == null }, 201);
});
