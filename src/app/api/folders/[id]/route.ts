import { handle, json, readJson, requireAccess } from "@/server/http";
import { deleteFolder, renameFolder } from "@/server/media";
import { persistMediaMany } from "@/server/blob-meta";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  await requireAccess(req);
  const { name } = await readJson<{ name?: unknown }>(req);
  return json({ folder: renameFolder((await params).id, name) });
});

/** Deletes the folder only; its files move back to the unfiled library. */
export const DELETE = handle<Ctx>(async (req, { params }) => {
  await requireAccess(req);
  const unfiled = deleteFolder((await params).id);
  await persistMediaMany(unfiled);
  return json({ unfiled: unfiled.length });
});
