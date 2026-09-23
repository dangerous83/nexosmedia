import "server-only";
import { randomUUID } from "node:crypto";
import { db, tx } from "./db";
import { storage } from "./storage";
import { HttpError } from "./http";
import type { Folder, Media, MediaKind, MediaPage, SortKey, Summary } from "@/lib/types";

interface MediaRow {
  id: string; kind: MediaKind; mime: string; ext: string; original_name: string; size: number;
  width: number | null; height: number | null; duration: number | null;
  storage_key: string; thumb_key: string | null; created_at: number;
  folder_id: string | null; trashed_at: number | null;
}

export function toMedia(r: MediaRow): Media {
  return {
    id: r.id, kind: r.kind, mime: r.mime, ext: r.ext, name: r.original_name, size: r.size,
    width: r.width, height: r.height, duration: r.duration, hasThumb: !!r.thumb_key, createdAt: r.created_at,
    folderId: r.folder_id, trashedAt: r.trashed_at,
  };
}

export function getRow(id: string): MediaRow {
  const row = db().prepare("SELECT * FROM media WHERE id = ?").get(id) as MediaRow | undefined;
  if (!row) throw new HttpError(404, "This file doesn't exist or was deleted.");
  return row;
}

export const getMedia = (id: string) => toMedia(getRow(id));

const ORDER: Record<SortKey, string> = {
  newest: "created_at DESC, id",
  oldest: "created_at ASC, id",
  name: "original_name COLLATE NOCASE ASC, id",
  size: "size DESC, id",
};

export interface Scope {
  type?: MediaKind | null;
  /** A folder id, or "none" for unfiled items. Omit for the whole workspace. */
  folder?: string | null;
  trash?: boolean;
}

function scopeSql(o: Scope & { q?: string | null }) {
  const where = [o.trash ? "trashed_at IS NOT NULL" : "trashed_at IS NULL"];
  const args: (string | number)[] = [];
  if (o.type) { where.push("kind = ?"); args.push(o.type); }
  if (o.folder === "none") where.push("folder_id IS NULL");
  else if (o.folder) { where.push("folder_id = ?"); args.push(o.folder); }
  const q = o.q?.trim().toLowerCase();
  if (q) {
    for (const term of q.split(/\s+/).slice(0, 6)) {
      where.push("lower(original_name) LIKE ? ESCAPE '\\'");
      args.push(`%${term.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
    }
  }
  return { sql: `WHERE ${where.join(" AND ")}`, args };
}

export function listMedia(o: Scope & { q?: string | null; sort?: SortKey | null; cursor?: number; limit?: number }): MediaPage {
  // An unknown folder (e.g. deleted by someone else meanwhile) simply lists nothing; the UI explains it.
  const { sql, args } = scopeSql(o);
  const total = Number((db().prepare(`SELECT COUNT(*) AS n FROM media ${sql}`).get(...args) as { n: number }).n);
  const limit = Math.min(Math.max(o.limit ?? 48, 1), 200);
  const offset = Math.max(o.cursor ?? 0, 0);
  const order = o.trash && !o.sort ? "trashed_at DESC, id" : ORDER[o.sort ?? "newest"] ?? ORDER.newest;
  const rows = db().prepare(`SELECT * FROM media ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...args, limit, offset) as unknown as MediaRow[];
  return { items: rows.map(toMedia), total, nextCursor: offset + rows.length < total ? offset + rows.length : null };
}

export function summary(): Summary {
  const r = db().prepare(
    `SELECT COALESCE(SUM(trashed_at IS NULL), 0) AS a,
            COALESCE(SUM(trashed_at IS NULL AND kind = 'image'), 0) AS i,
            COALESCE(SUM(trashed_at IS NULL AND kind = 'video'), 0) AS v,
            COALESCE(SUM(trashed_at IS NULL AND folder_id IS NULL), 0) AS u,
            COALESCE(SUM(trashed_at IS NOT NULL), 0) AS t
     FROM media`,
  ).get() as Record<string, number>;
  return { all: Number(r.a), images: Number(r.i), videos: Number(r.v), unfiled: Number(r.u), trash: Number(r.t) };
}

export function insertMedia(r: Omit<MediaRow, "trashed_at">) {
  db().prepare(
    `INSERT INTO media (id, kind, mime, ext, original_name, size, width, height, duration, storage_key, thumb_key, created_at, folder_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(r.id, r.kind, r.mime, r.ext, r.original_name, r.size, r.width, r.height, r.duration, r.storage_key, r.thumb_key, r.created_at, r.folder_id);
}

export function setThumbKey(id: string, key: string) {
  db().prepare("UPDATE media SET thumb_key = ? WHERE id = ?").run(key, id);
}

/**
 * Renames the display filename. The extension always matches the stored format, so a rename can
 * never make a file look like a different type; the storage key is untouched.
 */
export function renameMedia(id: string, input: unknown) {
  const row = getRow(id);
  let base = clean(input, 200).replace(/[\\/:*?"<>|]+/g, "-");
  const exts = row.kind === "image" ? (row.ext === "jpg" ? ["jpg", "jpeg"] : [row.ext]) : (row.ext === "mp4" ? ["mp4", "m4v"] : [row.ext]);
  const current = /\.([a-z0-9]{2,5})$/i.exec(base)?.[1]?.toLowerCase();
  if (current && exts.includes(current)) base = base.slice(0, -(current.length + 1));
  base = base.trim().replace(/\.+$/, "");
  if (!base) throw new HttpError(400, "Enter a file name.");
  const keepExt = /\.([a-z0-9]{2,5})$/i.exec(row.original_name)?.[1]?.toLowerCase();
  const ext = keepExt && exts.includes(keepExt) ? keepExt : row.ext;
  db().prepare("UPDATE media SET original_name = ? WHERE id = ?").run(`${base}.${ext}`, id);
  return getMedia(id);
}

const ids = (list: string[]) => [...new Set(list)].slice(0, 1000);

export function moveMedia(list: string[], folderId: string | null) {
  if (folderId) getFolderRow(folderId);
  const stmt = db().prepare("UPDATE media SET folder_id = ? WHERE id = ? AND trashed_at IS NULL");
  let moved = 0;
  tx(() => { for (const id of ids(list)) moved += Number(stmt.run(folderId, id).changes); });
  return moved;
}

export function trashMedia(list: string[]) {
  const stmt = db().prepare("UPDATE media SET trashed_at = ? WHERE id = ? AND trashed_at IS NULL");
  const now = Date.now();
  const done: string[] = [];
  tx(() => { for (const id of ids(list)) if (Number(stmt.run(now, id).changes)) done.push(id); });
  return done;
}

/** Restores to the original folder; folders deleted meanwhile have already un-filed their items. */
export function restoreMedia(list: string[]) {
  const stmt = db().prepare("UPDATE media SET trashed_at = NULL WHERE id = ? AND trashed_at IS NOT NULL");
  const done: string[] = [];
  tx(() => { for (const id of ids(list)) if (Number(stmt.run(id).changes)) done.push(id); });
  return done;
}

/** Permanently deletes trashed items: record first, then the original and its thumbnail. */
export async function purgeMedia(list: string[] | "all") {
  const rows = (list === "all"
    ? db().prepare("SELECT * FROM media WHERE trashed_at IS NOT NULL").all()
    : ids(list).map((id) => db().prepare("SELECT * FROM media WHERE id = ? AND trashed_at IS NOT NULL").get(id)).filter(Boolean)) as unknown as MediaRow[];
  tx(() => { const del = db().prepare("DELETE FROM media WHERE id = ?"); for (const r of rows) del.run(r.id); });
  // A failed file delete leaves an orphaned file, never a record pointing at a missing file.
  for (const r of rows) {
    await storage().delete(r.storage_key).catch((e) => console.error("[purge] original", e));
    if (r.thumb_key) await storage().delete(r.thumb_key).catch((e) => console.error("[purge] thumb", e));
  }
  return rows.map((r) => r.id);
}

/** Rows for a bulk download (live, non-trashed items only, in the requested order). */
export function rowsForArchive(list: string[]) {
  const sel = db().prepare("SELECT * FROM media WHERE id = ? AND trashed_at IS NULL");
  return ids(list).map((id) => sel.get(id) as MediaRow | undefined).filter((r): r is MediaRow => !!r);
}

// ——— Folders ———

interface FolderRow { id: string; name: string; created_at: number; updated_at: number }

export function getFolderRow(id: string): FolderRow {
  const row = db().prepare("SELECT * FROM folders WHERE id = ?").get(id) as FolderRow | undefined;
  if (!row) throw new HttpError(404, "This folder doesn't exist or was deleted.");
  return row;
}

export function folderExists(id: string) {
  return !!db().prepare("SELECT 1 FROM folders WHERE id = ?").get(id);
}

export function listFolders(): Folder[] {
  const rows = db().prepare(
    `SELECT f.*, (SELECT COUNT(*) FROM media m WHERE m.folder_id = f.id AND m.trashed_at IS NULL) AS n
     FROM folders f ORDER BY f.name COLLATE NOCASE`,
  ).all() as unknown as (FolderRow & { n: number })[];
  const cover = db().prepare(
    `SELECT id, kind, thumb_key, width, height FROM media
     WHERE folder_id = ? AND trashed_at IS NULL AND thumb_key IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
  );
  return rows.map((f) => {
    const c = cover.get(f.id) as { id: string; kind: MediaKind; thumb_key: string; width: number | null; height: number | null } | undefined;
    return {
      id: f.id, name: f.name, count: Number(f.n), createdAt: f.created_at,
      cover: c ? { id: c.id, kind: c.kind, hasThumb: true, width: c.width, height: c.height } : null,
    };
  });
}

function folderName(input: unknown, exceptId?: string) {
  const name = clean(input, 60);
  if (!name) throw new HttpError(400, "Give the folder a name.");
  const clash = db().prepare("SELECT id FROM folders WHERE name = ? COLLATE NOCASE").get(name) as { id: string } | undefined;
  if (clash && clash.id !== exceptId) throw new HttpError(409, `A folder called “${name}” already exists.`);
  return name;
}

export function createFolder(input: unknown) {
  const name = folderName(input);
  const id = randomUUID();
  const now = Date.now();
  db().prepare("INSERT INTO folders (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, name, now, now);
  return listFolders().find((f) => f.id === id)!;
}

export function renameFolder(id: string, input: unknown) {
  getFolderRow(id);
  const name = folderName(input, id);
  db().prepare("UPDATE folders SET name = ?, updated_at = ? WHERE id = ?").run(name, Date.now(), id);
  return listFolders().find((f) => f.id === id)!;
}

/** Deletes a folder only. Its media (including trashed items) move back to the unfiled library. */
export function deleteFolder(id: string) {
  getFolderRow(id);
  let moved = 0;
  tx(() => {
    moved = Number(db().prepare("UPDATE media SET folder_id = NULL WHERE folder_id = ?").run(id).changes);
    db().prepare("DELETE FROM folders WHERE id = ?").run(id);
  });
  return moved;
}

export function clean(s: unknown, max: number) {
  if (typeof s !== "string") return "";
  return s.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}
