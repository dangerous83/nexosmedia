import "server-only";
import { randomBytes } from "node:crypto";
import { storage } from "./storage";
import { HttpError } from "./http";
import { rowsForArchive } from "./media";
import { uniqueNames } from "./zip";
import { ARCHIVE_LIMITS } from "@/lib/types";

/*
 * Bulk downloads, in two steps:
 *   1. POST validates the selection (limits, availability) and returns a short-lived, single-use token.
 *   2. GET with that token streams the zip. The GET route still requires a valid workspace session.
 * Tokens live in memory for five minutes (per server process).
 */

interface Prepared { entries: { id: string; key: string; name: string; size: number; mtime: number }[]; bytes: number; expires: number }
const g = globalThis as unknown as { __nexoArchives?: Map<string, Prepared> };
const pending: Map<string, Prepared> = (g.__nexoArchives ??= new Map());

export async function prepareArchive(ids: string[]) {
  for (const [t, p] of pending) if (p.expires < Date.now()) pending.delete(t);
  const rows = rowsForArchive(ids);
  if (!rows.length) throw new HttpError(400, "None of the selected files are available to download.");
  if (rows.length > ARCHIVE_LIMITS.maxFiles)
    throw new HttpError(413, `You can download up to ${ARCHIVE_LIMITS.maxFiles} files at once. Select fewer files and try again.`);
  const bytes = rows.reduce((n, r) => n + r.size, 0);
  if (bytes > ARCHIVE_LIMITS.maxBytes)
    throw new HttpError(413, "The selected files are larger than 4 GB together. Select fewer files and try again.");
  let missing = 0;
  for (const r of rows) if ((await storage().size(r.storage_key)) !== r.size) missing++;
  if (missing) throw new HttpError(409, `${missing} of the selected file${missing > 1 ? "s are" : " is"} unavailable in storage, so the download can't be prepared.`);
  const names = uniqueNames(rows.map((r) => r.original_name));
  const token = randomBytes(24).toString("base64url");
  pending.set(token, {
    entries: rows.map((r, i) => ({ id: r.id, key: r.storage_key, name: names[i], size: r.size, mtime: r.created_at })),
    bytes,
    expires: Date.now() + 5 * 60_000,
  });
  return { token, count: rows.length, bytes };
}

export function takeArchive(token: string) {
  const p = pending.get(token);
  pending.delete(token);
  if (!p || p.expires < Date.now()) throw new HttpError(410, "This download link has expired. Start the download again.");
  return p;
}
