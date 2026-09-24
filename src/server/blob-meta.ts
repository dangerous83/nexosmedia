import "server-only";
import { del, get, list, put } from "@vercel/blob";
import { config } from "./config";
import { getRow, upsertMedia, type MediaRow } from "./media";

const prefix = "nexosphere-meta/media/";
const keyFor = (id: string) => `${prefix}${id}.json`;
const g = globalThis as unknown as { __nexoBlobSync?: { at: number; promise: Promise<void> } };

export async function persistMediaRow(row: MediaRow) {
  if (config.storageDriver !== "vercel-blob") return;
  await put(keyFor(row.id), JSON.stringify(row), {
    access: "private", allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60,
  });
}

export async function persistMedia(id: string) { await persistMediaRow(getRow(id)); }

export async function deleteMediaMetadata(ids: string[]) {
  if (config.storageDriver === "vercel-blob" && ids.length) await del(ids.map(keyFor));
}

/** Hydrate the per-instance SQLite cache from durable Blob sidecars. */
export async function syncMediaMetadata() {
  if (config.storageDriver !== "vercel-blob") return;
  const now = Date.now();
  if (g.__nexoBlobSync && now - g.__nexoBlobSync.at < 3000) return g.__nexoBlobSync.promise;
  const promise = (async () => {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, limit: 1000, cursor });
      await Promise.all(page.blobs.map(async (blob) => {
        const result = await get(blob.pathname, { access: "private", useCache: false });
        if (!result || result.statusCode !== 200 || !result.stream) return;
        const row = await new Response(result.stream).json() as MediaRow;
        upsertMedia(row);
      }));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  })();
  g.__nexoBlobSync = { at: now, promise };
  await promise;
}
