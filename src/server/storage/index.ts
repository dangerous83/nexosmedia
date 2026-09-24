import "server-only";
import { config } from "../config";
import { LocalStorage } from "./local";
import { VercelBlobStorage } from "./vercel-blob";
import { S3Storage } from "./s3";
import type { StorageAdapter } from "./types";

const g = globalThis as unknown as { __nexoStorage?: StorageAdapter };

export function storage(): StorageAdapter {
  if (g.__nexoStorage) return g.__nexoStorage;
  switch (config.storageDriver) {
    case "local":
      g.__nexoStorage = new LocalStorage(config.dataDir);
      break;
    case "vercel-blob":
      g.__nexoStorage = new VercelBlobStorage(config.dataDir);
      break;
    case "s3":
      g.__nexoStorage = new S3Storage(config.dataDir);
      break;
    default:
      throw new Error(
        `STORAGE_DRIVER="${config.storageDriver}" is not implemented. Use "local", "vercel-blob" or "s3".`,
      );
  }
  return g.__nexoStorage;
}

export type { StorageAdapter };
