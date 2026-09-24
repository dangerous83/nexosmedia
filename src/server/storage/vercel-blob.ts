import { createReadStream, mkdirSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { del, get, head, list, put } from "@vercel/blob";
import type { StorageAdapter } from "./types";

/** Private, durable object storage for Vercel deployments. */
export class VercelBlobStorage implements StorageAdapter {
  readonly name = "vercel-blob";
  private tmp: string;

  constructor(baseDir: string) {
    this.tmp = path.join(baseDir, "tmp");
    mkdirSync(this.tmp, { recursive: true });
  }

  async putFile(key: string, tempPath: string, contentType: string) {
    await put(key, createReadStream(tempPath), { access: "private", allowOverwrite: true, contentType });
  }

  async putBuffer(key: string, data: Buffer, contentType: string) {
    await put(key, data, { access: "private", allowOverwrite: true, contentType });
  }

  async read(key: string, range?: { start: number; end: number }) {
    const result = await get(key, {
      access: "private",
      headers: range ? { Range: `bytes=${range.start}-${range.end}` } : undefined,
    });
    if (!result || ![200, 206].includes(result.statusCode) || !result.stream) throw new Error("Blob not found");
    return Readable.fromWeb(result.stream as import("node:stream/web").ReadableStream);
  }

  async size(key: string) {
    try { return (await head(key)).size; } catch { return null; }
  }

  async list(prefix: string) {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, limit: 1000, cursor });
      keys.push(...page.blobs.map((blob) => blob.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return keys;
  }

  async delete(key: string) { await del(key); }
  tempDir() { return this.tmp; }
  async capacity() { return null; }
}
