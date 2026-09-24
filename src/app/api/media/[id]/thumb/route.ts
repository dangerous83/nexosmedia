import { fail, handle, requireAccess } from "@/server/http";
import { getRow } from "@/server/media";
import { serveObject } from "@/server/serve";
import { syncMediaMetadata } from "@/server/blob-meta";

export const runtime = "nodejs";

export const GET = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  await requireAccess(req);
  await syncMediaMetadata();
  const row = getRow((await params).id);
  if (!row.thumb_key) return fail(404, "No preview image is available for this file.");
  return serveObject(req, row.thumb_key, { contentType: "image/webp", etag: `${row.id}-t` });
});
