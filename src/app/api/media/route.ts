import { handle, json, requireAccess } from "@/server/http";
import { listMedia } from "@/server/media";
import { syncMediaMetadata } from "@/server/blob-meta";
import type { SortKey } from "@/lib/types";

const SORTS: SortKey[] = ["newest", "oldest", "name", "size"];

/**
 * Lists media. Scope: ?type=image|video, ?folder=<id>|none, ?trash=1 (Trash only; everything else
 * excludes trashed items). Search matches the display filename.
 */
export const GET = handle(async (req) => {
  await requireAccess(req);
  await syncMediaMetadata();
  const p = new URL(req.url).searchParams;
  const type = p.get("type");
  const sort = p.get("sort") as SortKey | null;
  return json(
    listMedia({
      type: type === "image" || type === "video" ? type : null,
      folder: p.get("folder"),
      trash: p.get("trash") === "1",
      q: p.get("q"),
      sort: sort && SORTS.includes(sort) ? sort : null,
      cursor: Number(p.get("cursor")) || 0,
      limit: Number(p.get("limit")) || 48,
    }),
  );
});
