import { handle, json, readJson, requireAccess } from "@/server/http";
import { createFolder, listFolders } from "@/server/media";
import { workspaceFrom } from "@/server/workspace";

export const GET = handle(async (req) => {
  await requireAccess(req);
  return json({ folders: listFolders(workspaceFrom(req)) });
});

export const POST = handle(async (req) => {
  await requireAccess(req);
  const { name } = await readJson<{ name?: unknown }>(req);
  return json({ folder: createFolder(workspaceFrom(req), name) }, 201);
});
