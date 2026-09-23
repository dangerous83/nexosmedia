import { fail, handle, json, readJson, requireAccess } from "@/server/http";
import { moveMedia, purgeMedia, restoreMedia, trashMedia } from "@/server/media";

type Body = { action?: string; ids?: unknown; folderId?: unknown; all?: unknown };

/** Bulk operations on the shared workspace: move, trash, restore, and permanent delete (Trash only). */
export const POST = handle(async (req) => {
  await requireAccess(req);
  const { action, ids, folderId, all } = await readJson<Body>(req);
  const list = Array.isArray(ids) ? ids.filter((i): i is string => typeof i === "string") : [];
  if (action === "purge" && all === true) return json({ ids: await purgeMedia("all") });
  if (!list.length) return fail(400, "Select at least one file.");
  if (list.length > 1000) return fail(400, "Select at most 1,000 files at a time.");
  switch (action) {
    case "move": {
      if (folderId !== null && typeof folderId !== "string") return fail(400, "Choose a folder.");
      return json({ moved: moveMedia(list, folderId) });
    }
    case "trash": return json({ ids: trashMedia(list) });
    case "restore": return json({ ids: restoreMedia(list) });
    case "purge": return json({ ids: await purgeMedia(list) });
    default: return fail(400, "Unknown action.");
  }
});
