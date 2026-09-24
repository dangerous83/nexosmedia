import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { config } from "@/server/config";
import { fail, handle, json, readJson, requireAccess } from "@/server/http";

export const runtime = "nodejs";

export const POST = handle(async (req) => {
  if (config.storageDriver !== "vercel-blob") return fail(404, "Direct uploads are not enabled.");
  await requireAccess(req);
  const body = await readJson<HandleUploadBody>(req);
  const result = await handleUpload({
    request: req,
    body,
    onBeforeGenerateToken: async (pathname) => {
      if (!/^media\/[0-9a-f-]{36}\/original\.(?:jpe?g|png|webp|mp4|m4v|webm)$/i.test(pathname))
        throw new Error("Invalid upload path.");
      return {
        allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "video/x-m4v"],
        maximumSizeInBytes: Math.max(config.maxImageBytes, config.maxVideoBytes),
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 60 * 60 * 24 * 30,
      };
    },
  });
  return json(result);
});
