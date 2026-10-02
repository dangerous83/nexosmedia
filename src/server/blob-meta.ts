import "server-only";
import { config } from "./config";
import { deleteFolder, folderExists, getFolderRow, getRow, upsertFolder, upsertMedia, type FolderRow, type MediaRow } from "./media";
import type { WorkspaceBrand } from "@/lib/types";
import { storage } from "./storage";

const prefix = "nexosphere-meta/media/";
const keyFor = (id: string) => `${prefix}${id}.json`;
const folderPrefix = "nexosphere-meta/folders/";
const folderKey = (id: string) => `${folderPrefix}${id}.json`;
type FolderMetadata = FolderRow & { deleted?: boolean };
const g = globalThis as unknown as { __nexoBlobSync?: { at: number; promise: Promise<void> } };

export async function persistMediaRow(row: MediaRow) {
  if (config.storageDriver === "local") return;
  await storage().putBuffer(keyFor(row.id), Buffer.from(JSON.stringify(row)), "application/json");
}

export async function persistMedia(id: string) { await persistMediaRow(getRow(id)); }

export async function persistFolder(workspace: WorkspaceBrand, id: string) {
  if (config.storageDriver === "local") return;
  await storage().putBuffer(folderKey(id), Buffer.from(JSON.stringify(getFolderRow(workspace, id))), "application/json");
}

/** Keep a tombstone so other server instances remove their cached copy too. */
export async function persistFolderDeletion(row: FolderRow) {
  if (config.storageDriver === "local") return;
  await storage().putBuffer(folderKey(row.id), Buffer.from(JSON.stringify({ ...row, deleted: true, updated_at: Date.now() })), "application/json");
}

async function readMetadata<T>(key: string): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of await storage().read(key))
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

/** Re-writes the durable sidecars for rows whose state changed (trash, restore, move, rename). */
export async function persistMediaMany(ids: string[]) {
  if (config.storageDriver === "local" || !ids.length) return;
  await Promise.all(ids.map((id) => persistMediaRow(getRow(id))));
}

export async function deleteMediaMetadata(ids: string[]) {
  if (config.storageDriver !== "local" && ids.length)
    await Promise.all(ids.map((id) => storage().delete(keyFor(id))));
}

/** Hydrate the per-instance SQLite cache from durable Blob sidecars. */
export async function syncMediaMetadata() {
  if (config.storageDriver === "local") return;
  const now = Date.now();
  if (g.__nexoBlobSync && now - g.__nexoBlobSync.at < 3000) return g.__nexoBlobSync.promise;
  const promise = (async () => {
    // Empty folders must survive cold starts, and must be restored before their media.
    const folderKeys = await storage().list(folderPrefix);
    for (const key of folderKeys) {
      try {
        const row = await readMetadata<FolderMetadata>(key);
        if (row.deleted) {
          if (folderExists(row.workspace, row.id)) deleteFolder(row.workspace, row.id);
        } else upsertFolder(row);
      } catch (error) {
        console.error(`[blob-meta] Could not restore folder ${key}:`, error);
        throw error;
      }
    }
    const keys = await storage().list(prefix);
    await Promise.all(keys.map(async (key) => {
        try {
          const row = await readMetadata<MediaRow>(key);
          upsertMedia(row);
        } catch (error) {
          // One damaged legacy sidecar must not make the whole gallery unavailable.
          console.error(`[blob-meta] Could not restore ${key}:`, error);
        }
      }));
  })();
  g.__nexoBlobSync = { at: now, promise };
  try { await promise; }
  catch (error) { g.__nexoBlobSync = undefined; throw error; }
}
