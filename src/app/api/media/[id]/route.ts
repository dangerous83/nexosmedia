import { fail, handle, json, readJson, requireAccess } from "@/server/http";
import { getMedia, getRow, purgeMedia, renameMedia } from "@/server/media";
import { deleteMediaMetadata, persistMedia } from "@/server/blob-meta";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  await requireAccess(req);
  return json({ media: getMedia((await params).id) });
});

/** Rename the display filename (the stored file and its format are unchanged). */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  await requireAccess(req);
  const { name } = await readJson<{ name?: unknown }>(req);
  const media = renameMedia((await params).id, name);
  await persistMedia(media.id);
  return json({ media });
});

/** Permanent delete. Only items already in Trash can be deleted permanently. */
export const DELETE = handle<Ctx>(async (req, { params }) => {
  await requireAccess(req);
  const { id } = await params;
  if (getRow(id).trashed_at == null) return fail(409, "Move this file to Trash before deleting it permanently.");
  await purgeMedia([id]);
  await deleteMediaMetadata([id]);
  return json({ deleted: id });
});
