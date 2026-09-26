import { fail, handle, json, readJson, requireAccess } from "@/server/http";
import { moveMedia, purgeMedia, restoreMedia, trashMedia } from "@/server/media";
import { deleteMediaMetadata, persistMediaMany } from "@/server/blob-meta";

type Body = { action?: string; ids?: unknown; folderId?: unknown; all?: unknown };

/** Bulk operations on the shared workspace: move, trash, restore, and permanent delete (Trash only). */
export const POST = handle(async (req) => {
  await requireAccess(req);
  const { action, ids, folderId, all } = await readJson<Body>(req);
  const list = Array.isArray(ids) ? ids.filter((i): i is string => typeof i === "string") : [];
  if (action === "purge" && all === true) {
    const purged = await purgeMedia("all");
    await deleteMediaMetadata(purged);
    return json({ ids: purged });
  }
  if (!list.length) return fail(400, "Select at least one file.");
  if (list.length > 1000) return fail(400, "Select at most 1,000 files at a time.");
  switch (action) {
    case "move": {
      if (folderId !== null && typeof folderId !== "string") return fail(400, "Choose a folder.");
      const moved = moveMedia(list, folderId);
      await persistMediaMany(list);
      return json({ moved });
    }
    case "trash": {
      const done = trashMedia(list);
      await persistMediaMany(done);
      return json({ ids: done });
    }
    case "restore": {
      const done = restoreMedia(list);
      await persistMediaMany(done);
      return json({ ids: done });
    }
    case "purge": {
      const purged = await purgeMedia(list);
      await deleteMediaMetadata(purged);
      return json({ ids: purged });
    }
    default: return fail(400, "Unknown action.");
  }
});
