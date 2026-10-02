import { handle, json, requireAccess } from "@/server/http";
import { receiveUpload } from "@/server/upload";
import { syncMediaMetadata } from "@/server/blob-meta";

export const runtime = "nodejs";
// Vercel Hobby deployments reject values above 300 seconds.
export const maxDuration = 300;

// The request body is the raw file; metadata travels in X-* headers. This lets the browser report
// real byte-level progress and lets the server stream straight to disk without buffering.
export const POST = handle(async (req) => {
  await requireAccess(req);
  await syncMediaMetadata();
  return json(await receiveUpload(req), 201);
});
