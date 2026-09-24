import { head } from "@vercel/blob";
import { config } from "@/server/config";
import { persistMediaRow } from "@/server/blob-meta";
import { clean, folderExists, getMedia, insertMedia, type MediaRow } from "@/server/media";
import { fail, handle, json, readJson, requireAccess } from "@/server/http";
import type { MediaKind } from "@/lib/types";

type Body = {
  id?: unknown; pathname?: unknown; name?: unknown; folderId?: unknown;
  width?: unknown; height?: unknown; duration?: unknown;
};

const finite = (v: unknown, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= max ? n : null;
};

export const POST = handle(async (req) => {
  await requireAccess(req);
  if (config.storageDriver !== "vercel-blob") return fail(404, "Direct uploads are not enabled.");
  const body = await readJson<Body>(req);
  const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : "";
  const pathname = typeof body.pathname === "string" ? body.pathname : "";
  if (!id || !pathname.startsWith(`media/${id}/original.`)) return fail(400, "Invalid uploaded file.");
  const blob = await head(pathname);
  const mime = blob.contentType;
  const video = mime === "video/mp4" || mime === "video/webm" || mime === "video/x-m4v";
  const image = mime === "image/jpeg" || mime === "image/png" || mime === "image/webp";
  if (!video && !image) return fail(415, "This file type isn't supported.");
  const kind: MediaKind = video ? "video" : "image";
  const limit = video ? config.maxVideoBytes : config.maxImageBytes;
  if (blob.size > limit) return fail(413, `This ${kind} exceeds the upload limit.`);
  const ext = pathname.split(".").pop()!.toLowerCase().replace("jpeg", "jpg").replace("m4v", "mp4");
  const wantedFolder = clean(body.folderId, 64) || null;
  const row: Omit<MediaRow, "trashed_at"> = {
    id, kind, mime: mime === "video/x-m4v" ? "video/mp4" : mime, ext,
    original_name: clean(body.name, 255) || `upload.${ext}`, size: blob.size,
    width: finite(body.width, 16384), height: finite(body.height, 16384),
    duration: finite(body.duration, 60 * 60 * 24), storage_key: pathname,
    thumb_key: null, created_at: Date.now(), folder_id: wantedFolder && folderExists(wantedFolder) ? wantedFolder : null,
  };
  insertMedia(row);
  await persistMediaRow({ ...row, trashed_at: null });
  return json({ media: getMedia(id), folderMissing: !!wantedFolder && row.folder_id == null }, 201);
});
