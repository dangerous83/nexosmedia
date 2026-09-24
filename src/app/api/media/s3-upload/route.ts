import { config } from "@/server/config";
import { fail, handle, json, readJson, requireAccess } from "@/server/http";
import { presignS3Put } from "@/server/storage/s3";

export const runtime = "nodejs";

type Body = { pathname?: unknown; contentType?: unknown; size?: unknown };

const allowed = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "video/x-m4v"]);

export const POST = handle(async (req) => {
  if (config.storageDriver !== "s3") return fail(404, "Direct S3 uploads are not enabled.");
  await requireAccess(req);
  const body = await readJson<Body>(req);
  const pathname = typeof body.pathname === "string" ? body.pathname : "";
  const contentType = typeof body.contentType === "string" ? body.contentType : "";
  const size = Number(body.size);
  if (!/^media\/[0-9a-f-]{36}\/original\.(?:jpe?g|png|webp|mp4|m4v|webm)$/i.test(pathname))
    return fail(400, "Invalid upload path.");
  if (!allowed.has(contentType)) return fail(415, "This file type isn't supported.");
  if (!Number.isFinite(size) || size <= 0 || size > Math.max(config.maxImageBytes, config.maxVideoBytes))
    return fail(413, "This file exceeds the upload limit.");
  return json({ url: await presignS3Put(pathname, contentType), pathname });
});
