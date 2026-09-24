import type { Readable } from "node:stream";

/**
 * Storage adapter contract. The rest of the app only talks to this interface, so a production
 * object store (S3, R2, GCS, Azure Blob…) can be added as another implementation without touching
 * routes or UI. Keys are generated server-side only — never from user input.
 */
export interface StorageAdapter {
  readonly name: string;
  /** Moves a fully-written local temp file into storage under `key`. */
  putFile(key: string, tempPath: string, contentType: string): Promise<void>;
  putBuffer(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Returns a readable stream; `range` is inclusive on both ends. */
  read(key: string, range?: { start: number; end: number }): Promise<Readable>;
  size(key: string): Promise<number | null>;
  /** Lists every object key below a server-generated prefix. */
  list(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
  /** A directory for in-flight uploads on local disk (uploads are streamed here first). */
  tempDir(): string;
  /** Free/total bytes of the backing volume when knowable. */
  capacity(): Promise<{ free: number; size: number } | null>;
}
