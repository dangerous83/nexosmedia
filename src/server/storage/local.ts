import { createReadStream, mkdirSync } from "node:fs";
import { rename, writeFile, stat, rm, rmdir, statfs, copyFile, unlink, readdir } from "node:fs/promises";
import path from "node:path";
import type { StorageAdapter } from "./types";

/**
 * Filesystem storage. Requires a persistent disk/volume: on ephemeral hosting (most serverless
 * platforms, containers without a mounted volume) uploaded files would be lost on redeploy.
 */
export class LocalStorage implements StorageAdapter {
  readonly name = "local";
  private root: string;
  private tmp: string;

  constructor(baseDir: string) {
    this.root = path.join(baseDir, "storage");
    this.tmp = path.join(baseDir, "tmp");
    mkdirSync(this.root, { recursive: true });
    mkdirSync(this.tmp, { recursive: true });
  }

  private resolve(key: string) {
    if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..")) throw new Error("Invalid storage key");
    const full = path.join(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async putFile(key: string, tempPath: string) {
    const dest = this.resolve(key);
    mkdirSync(path.dirname(dest), { recursive: true });
    try {
      await rename(tempPath, dest);
    } catch {
      // Cross-device moves fall back to copy + delete.
      await copyFile(tempPath, dest);
      await unlink(tempPath).catch(() => {}); // the caller also cleans up its temp file
    }
  }

  async putBuffer(key: string, data: Buffer) {
    const dest = this.resolve(key);
    mkdirSync(path.dirname(dest), { recursive: true });
    await writeFile(dest, data);
  }

  async read(key: string, range?: { start: number; end: number }) {
    return createReadStream(this.resolve(key), range);
  }

  async size(key: string) {
    try {
      return (await stat(this.resolve(key))).size;
    } catch {
      return null;
    }
  }

  async list(prefix: string) {
    const start = this.resolve(prefix);
    const keys: string[] = [];
    const walk = async (dir: string) => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else keys.push(path.relative(this.root, full).split(path.sep).join("/"));
      }
    };
    await walk(start);
    return keys;
  }

  async delete(key: string) {
    const full = this.resolve(key);
    await rm(full, { force: true });
    // Remove the item's folder once it is empty (fails harmlessly while other files remain).
    const dir = path.dirname(full);
    if (dir !== this.root) await rmdir(dir).catch(() => {});
  }

  tempDir() {
    return this.tmp;
  }

  async capacity() {
    try {
      const s = await statfs(this.root);
      return { free: s.bavail * s.bsize, size: s.blocks * s.bsize };
    } catch {
      return null;
    }
  }
}
