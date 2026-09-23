import "server-only";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "./config";

// One connection per server process. Kept on globalThis so dev hot-reloads don't leak handles.
const g = globalThis as unknown as { __nexoDb?: DatabaseSync };

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    prefs TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE media (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('image','video')),
    mime TEXT NOT NULL,
    ext TEXT NOT NULL,
    original_name TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    duration REAL,
    storage_key TEXT NOT NULL,
    thumb_key TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    is_sample INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX media_user_created ON media(user_id, created_at DESC);
  CREATE TABLE collections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    cover_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX collections_user ON collections(user_id, updated_at DESC);
  CREATE TABLE collection_items (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (collection_id, media_id)
  );
  CREATE INDEX collection_items_media ON collection_items(media_id);
  `,
  // v2 — "Media Space": one shared workspace protected by a passphrase. Media rows and files are kept
  // (IDs and storage keys unchanged); account, collection and favorite data is dropped. A full copy of
  // the v1 database is written to nexosphere.v1-backup.db before this runs (see open()).
  `
  DROP TABLE IF EXISTS collection_items;
  DROP TABLE IF EXISTS collections;
  CREATE TABLE media_v2 (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('image','video')),
    mime TEXT NOT NULL,
    ext TEXT NOT NULL,
    original_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    duration REAL,
    storage_key TEXT NOT NULL,
    thumb_key TEXT,
    created_at INTEGER NOT NULL
  );
  INSERT INTO media_v2 (id, kind, mime, ext, original_name, size, width, height, duration, storage_key, thumb_key, created_at)
    SELECT id, kind, mime, ext, original_name, size, width, height, duration, storage_key, thumb_key, created_at FROM media;
  DROP TABLE media;
  ALTER TABLE media_v2 RENAME TO media;
  CREATE INDEX media_created ON media(created_at DESC);
  CREATE INDEX media_name ON media(original_name COLLATE NOCASE);
  DROP TABLE IF EXISTS sessions;
  DROP TABLE IF EXISTS users;
  CREATE TABLE access_sessions (
    token_hash TEXT PRIMARY KEY,
    -- fingerprint of the passphrase hash in force when the session was issued;
    -- changing the passphrase therefore signs every device out.
    pass_fp TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
  // v3 — folders and Trash. Purely additive: existing media rows and files are untouched; every item
  // starts unfiled and not trashed. Deleting a folder un-files its media (ON DELETE SET NULL).
  `
  CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX folders_name ON folders(name COLLATE NOCASE);
  ALTER TABLE media ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
  ALTER TABLE media ADD COLUMN trashed_at INTEGER;
  CREATE INDEX media_folder ON media(folder_id);
  CREATE INDEX media_trashed ON media(trashed_at);
  `,
];

function open(): DatabaseSync {
  mkdirSync(config.dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(config.dataDir, "nexosphere.db"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (version >= 1 && version < MIGRATIONS.length) {
    // Keep a restorable copy of the database as it was before any schema change.
    const backup = path.join(config.dataDir, `nexosphere.v${version}-backup.db`);
    if (!existsSync(backup)) db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  }
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return db;
}

export function db(): DatabaseSync {
  if (!g.__nexoDb) g.__nexoDb = open();
  return g.__nexoDb;
}

export function tx<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}
