import { handle, json, requireAccess } from "@/server/http";
import { summary } from "@/server/media";
import { syncMediaMetadata } from "@/server/blob-meta";
import { workspaceFrom } from "@/server/workspace";

export const GET = handle(async (req) => {
  await requireAccess(req);
  await syncMediaMetadata();
  return json(summary(workspaceFrom(req)));
});
