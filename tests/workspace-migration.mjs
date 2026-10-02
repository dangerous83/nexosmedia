// Exercise the actual SQL migrations against a populated v4 SQLite database.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../src/server/db.ts", import.meta.url), "utf8");
const sql = runInNewContext(source.match(/const MIGRATIONS: string\[\] = (\[[\s\S]*?\n\]);/)[1]);
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");
for (const migration of sql.slice(0, 4)) db.exec(migration);
for (const brand of ["nexosphere", "nexuflow"]) {
  db.prepare("INSERT INTO folders VALUES (?, ?, 1, 1, ?)").run(`folder-${brand}`, "Project", brand);
  db.prepare(`INSERT INTO media (id, kind, mime, ext, original_name, size, storage_key, thumb_key, created_at, folder_id, trashed_at, workspace)
    VALUES (?, 'image', 'image/png', 'png', 'image.png', 42, ?, 'thumb.png', 1, ?, ?, ?)`)
    .run(`media-${brand}`, `original-${brand}.png`, `folder-${brand}`, brand === "nexuflow" ? 123 : null, brand);
}
const before = db.prepare("SELECT * FROM media ORDER BY id").all();
const foldersBefore = db.prepare("SELECT * FROM folders ORDER BY id").all();
db.exec("BEGIN");
for (const migration of sql.slice(4)) db.exec(migration);
db.exec("COMMIT");
assert.deepEqual(db.prepare("SELECT * FROM media ORDER BY id").all(), before);
assert.deepEqual(db.prepare("SELECT * FROM folders ORDER BY id").all(), foldersBefore);
assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
db.prepare("INSERT INTO folders VALUES ('folder-tv', 'Project', 1, 1, 'nexotv')").run();
db.prepare(`INSERT INTO media (id, kind, mime, ext, original_name, size, storage_key, created_at, folder_id, workspace)
  VALUES ('media-tv', 'video', 'video/mp4', 'mp4', 'show.mp4', 12, 'show.mp4', 1, 'folder-tv', 'nexotv')`).run();
assert.throws(() => db.prepare("INSERT INTO folders VALUES ('duplicate', 'project', 1, 1, 'nexotv')").run(), /UNIQUE/);
assert.throws(() => db.prepare("INSERT INTO folders VALUES ('invalid', 'Invalid', 1, 1, 'other')").run(), /CHECK/);
db.prepare("DELETE FROM folders WHERE id = 'folder-tv'").run();
assert.equal(db.prepare("SELECT folder_id FROM media WHERE id = 'media-tv'").get().folder_id, null);
assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
db.close();
console.log("Passed: existing libraries, folder membership and Trash preserved; Nexo TV accepts media and folders independently.");
