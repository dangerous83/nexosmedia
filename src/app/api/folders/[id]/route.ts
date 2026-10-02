import { handle, json, readJson, requireAccess } from "@/server/http";
import { deleteFolder, getFolderRow, renameFolder } from "@/server/media";
import { persistFolder, persistFolderDeletion, persistMediaMany, syncMediaMetadata } from "@/server/blob-meta";
import { workspaceFrom } from "@/server/workspace";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  await requireAccess(req);
  await syncMediaMetadata();
  const { name } = await readJson<{ name?: unknown }>(req);
  const workspace = workspaceFrom(req);
  const folder = renameFolder(workspace, (await params).id, name);
  await persistFolder(workspace, folder.id);
  return json({ folder });
});

/** Deletes the folder only; its files move back to the unfiled library. */
export const DELETE = handle<Ctx>(async (req, { params }) => {
  await requireAccess(req);
  await syncMediaMetadata();
  const workspace = workspaceFrom(req);
  const id = (await params).id;
  await persistFolderDeletion(getFolderRow(workspace, id));
  const unfiled = deleteFolder(workspace, id);
  await persistMediaMany(unfiled);
  return json({ unfiled: unfiled.length });
});
