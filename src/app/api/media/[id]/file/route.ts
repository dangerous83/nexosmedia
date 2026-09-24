import { handle, requireAccess } from "@/server/http";
import { getRow } from "@/server/media";
import { serveObject } from "@/server/serve";
import { syncMediaMetadata } from "@/server/blob-meta";

export const runtime = "nodejs";

/** Streams the original file (Range-capable). `?download=1` sends it as an attachment. */
export const GET = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  await requireAccess(req);
  await syncMediaMetadata();
  const row = getRow((await params).id);
  const download = new URL(req.url).searchParams.get("download") === "1";
  return serveObject(req, row.storage_key, {
    contentType: row.mime,
    etag: `${row.id}-o`,
    immutable: true,
    download: download ? ensureExt(row.original_name, row.ext) : undefined,
  });
});

function ensureExt(name: string, ext: string) {
  return /\.[a-z0-9]{2,5}$/i.test(name) ? name : `${name}.${ext}`;
}
