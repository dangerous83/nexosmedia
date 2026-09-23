import { handle, json, requireAccess } from "@/server/http";
import { receiveUpload } from "@/server/upload";

export const runtime = "nodejs";
export const maxDuration = 3600;

// The request body is the raw file; metadata travels in X-* headers. This lets the browser report
// real byte-level progress and lets the server stream straight to disk without buffering.
export const POST = handle(async (req) => {
  await requireAccess(req);
  return json(await receiveUpload(req), 201);
});
