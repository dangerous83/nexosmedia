import "server-only";
import { config } from "./config";
import { getRow, upsertMedia, type MediaRow } from "./media";
import { storage } from "./storage";

const prefix = "nexosphere-meta/media/";
const keyFor = (id: string) => `${prefix}${id}.json`;
const g = globalThis as unknown as { __nexoBlobSync?: { at: number; promise: Promise<void> } };

export async function persistMediaRow(row: MediaRow) {
  if (config.storageDriver === "local") return;
  await storage().putBuffer(keyFor(row.id), Buffer.from(JSON.stringify(row)), "application/json");
}

export async function persistMedia(id: string) { await persistMediaRow(getRow(id)); }

/** Re-writes the durable sidecars for rows whose state changed (trash, restore, move, rename). */
export async function persistMediaMany(ids: string[]) {
  if (config.storageDriver === "local" || !ids.length) return;
  await Promise.all(ids.map(async (id) => {
    try { await persistMediaRow(getRow(id)); }
    catch (error) { console.error(`[blob-meta] Could not persist ${id}:`, error); }
  }));
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
    const keys = await storage().list(prefix);
    await Promise.all(keys.map(async (key) => {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of await storage().read(key))
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          const row = JSON.parse(Buffer.concat(chunks).toString("utf8")) as MediaRow;
          upsertMedia(row);
        } catch (error) {
          // One damaged legacy sidecar must not make the whole gallery unavailable.
          console.error(`[blob-meta] Could not restore ${key}:`, error);
        }
      }));
  })();
  g.__nexoBlobSync = { at: now, promise };
  await promise;
}
