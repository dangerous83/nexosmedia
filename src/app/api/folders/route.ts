import { handle, json, readJson, requireAccess } from "@/server/http";
import { createFolder, listFolders } from "@/server/media";
import { workspaceFrom } from "@/server/workspace";
import { persistFolder, syncMediaMetadata } from "@/server/blob-meta";

export const GET = handle(async (req) => {
  await requireAccess(req);
  await syncMediaMetadata();
  return json({ folders: listFolders(workspaceFrom(req)) });
});

export const POST = handle(async (req) => {
  await requireAccess(req);
  await syncMediaMetadata();
  const { name } = await readJson<{ name?: unknown }>(req);
  const workspace = workspaceFrom(req);
  const folder = createFolder(workspace, name);
  await persistFolder(workspace, folder.id);
  return json({ folder }, 201);
});
