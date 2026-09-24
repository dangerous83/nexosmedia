import { fail, handle, json, requireAccess } from "@/server/http";
import { getMedia, getRow, setThumbKey } from "@/server/media";
import { persistMedia, syncMediaMetadata } from "@/server/blob-meta";
import { savePoster } from "@/server/upload";

export const runtime = "nodejs";

/** Receives a poster frame captured in the uploading browser for a video. */
export const PUT = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  await requireAccess(req);
  await syncMediaMetadata();
  const { id } = await params;
  if (getRow(id).kind !== "video") return fail(400, "Posters can only be set for videos.");
  setThumbKey(id, await savePoster(id, await req.arrayBuffer()));
  await persistMedia(id);
  return json({ media: getMedia(id) });
});
