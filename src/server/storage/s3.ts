import { createReadStream } from "node:fs";
import { mkdirSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config";
import type { StorageAdapter } from "./types";

function client() {
  const { endpoint, region, accessKeyId, secretAccessKey } = config.s3;
  if (!endpoint || !accessKeyId || !secretAccessKey)
    throw new Error("S3 storage is not configured. Add the R2 endpoint and access keys.");
  return new S3Client({
    endpoint,
    region,
    forcePathStyle: false,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

function bucket() {
  if (!config.s3.bucket) throw new Error("S3_BUCKET is not configured.");
  return config.s3.bucket;
}

export async function presignS3Put(key: string, contentType: string) {
  return getSignedUrl(client(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }), {
    expiresIn: 15 * 60,
  });
}

/** Private S3-compatible storage, including Cloudflare R2. */
export class S3Storage implements StorageAdapter {
  readonly name = "s3";
  private tmp: string;

  constructor(baseDir: string) {
    this.tmp = path.join(baseDir, "tmp");
    mkdirSync(this.tmp, { recursive: true });
  }

  async putFile(key: string, tempPath: string, contentType: string) {
    const size = (await stat(tempPath)).size;
    await client().send(new PutObjectCommand({
      Bucket: bucket(), Key: key, Body: createReadStream(tempPath), ContentType: contentType, ContentLength: size,
    }));
  }

  async putBuffer(key: string, data: Buffer, contentType: string) {
    await client().send(new PutObjectCommand({
      Bucket: bucket(), Key: key, Body: data, ContentType: contentType, ContentLength: data.length,
    }));
  }

  async read(key: string, range?: { start: number; end: number }) {
    const result = await client().send(new GetObjectCommand({
      Bucket: bucket(), Key: key, Range: range ? `bytes=${range.start}-${range.end}` : undefined,
    }));
    if (!result.Body) throw new Error("Object not found");
    if (result.Body instanceof Readable) return result.Body;
    return Readable.fromWeb(result.Body.transformToWebStream() as import("node:stream/web").ReadableStream);
  }

  async size(key: string) {
    try {
      return Number((await client().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }))).ContentLength ?? 0);
    } catch {
      return null;
    }
  }

  async list(prefix: string) {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const page = await client().send(new ListObjectsV2Command({
        Bucket: bucket(), Prefix: prefix, ContinuationToken: token,
      }));
      for (const item of page.Contents ?? []) if (item.Key) keys.push(item.Key);
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  async delete(key: string) {
    await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  }

  tempDir() { return this.tmp; }
  async capacity() { return null; }
}
