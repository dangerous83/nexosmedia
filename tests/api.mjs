// Access-protection and media-workflow checks against a running server.
// Usage: BASE=http://localhost:3210 PASSPHRASE=… DATA_DIR=… node tests/api.mjs
// The server must use the same DATA_DIR and a NEXO_PASSPHRASE_HASH created from PASSPHRASE.
// Run it with MAX_IMAGE_MB=5 so the oversize check is quick.
import { existsSync, readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { makeFixtures } from "./fixtures.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const PASS = process.env.PASSPHRASE;
const DATA_DIR = process.env.DATA_DIR;
if (!PASS) { console.error("Set PASSPHRASE"); process.exit(2); }
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (cond) { passes++; console.log("  ✓", msg); } else { failures++; console.log("  ✗", msg); } };
const CSRF = { "x-nexo-request": "1" };

class Client {
  cookie = "";
  setCookie = "";
  async req(p, init = {}) {
    const res = await fetch(BASE + p, { ...init, headers: { ...(init.headers ?? {}), ...(this.cookie ? { cookie: this.cookie } : {}) }, redirect: "manual" });
    const set = res.headers.get("set-cookie");
    if (set) { this.setCookie = set; this.cookie = set.split(";")[0]; }
    return res;
  }
  async json(p, method = "GET", body, headers = {}) {
    const res = await this.req(p, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
  }
  unlock(passphrase, headers = CSRF) { return this.json("/api/access", "POST", { passphrase }, headers); }
  async upload(file, type, extra = {}, headers = CSRF) {
    const res = await this.req("/api/media/upload", { method: "POST", headers: { "content-type": type, "x-file-name": encodeURIComponent(path.basename(file)), ...headers, ...extra }, body: readFileSync(file) });
    return { status: res.status, body: await res.json().catch(() => null) };
  }
}

const fx = await makeFixtures(path.join(os.tmpdir(), "nexo-fixtures"));
const anon = new Client(), A = new Client();

console.log("Pages");
let res = await anon.req("/");
ok(res.status === 307 && res.headers.get("location")?.endsWith("/unlock"), "workspace redirects to /unlock without a session");
res = await anon.req("/unlock");
ok(res.status === 200, "unlock page renders");
const html = await res.text();
ok(!/SphereHub|Create an account|Sign up|Collections|Favorites/i.test(html), "no SphereHub / account UI on the access screen");
ok(!html.includes(PASS), "passphrase never appears in client HTML");
res = await anon.req("/register");
ok(res.status === 404, "old /register route is gone");

console.log("Unlock");
let r = await anon.unlock(PASS, {});
ok(r.status === 403, "unlock without the CSRF header is rejected");
r = await anon.unlock(PASS, { ...CSRF, origin: "https://evil.example" });
ok(r.status === 403, "cross-origin unlock is rejected");
r = await anon.unlock(PASS, { ...CSRF, "sec-fetch-site": "cross-site" });
ok(r.status === 403, "cross-site (Sec-Fetch-Site) unlock is rejected");
r = await anon.unlock("", CSRF);
ok(r.status === 400 && /Enter the workspace passphrase/.test(r.body.error), "empty passphrase → helpful 400");
r = await anon.unlock("definitely-wrong", { ...CSRF, "x-forwarded-for": "10.9.9.1" });
ok(r.status === 401 && /attempts? left/.test(r.body.error), `wrong passphrase → 401 with remaining attempts (“${r.body.error}”)`);
r = await A.unlock(PASS);
ok(r.status === 200, "correct passphrase unlocks");
ok(/HttpOnly/i.test(A.setCookie) && /SameSite=Lax/i.test(A.setCookie) && /Expires=/i.test(A.setCookie) && /Path=\//.test(A.setCookie),
  `session cookie is HttpOnly, SameSite, expiring (${A.setCookie.split(";").slice(1).map((s) => s.trim().split("=")[0]).join(", ")})`);
res = await A.req("/unlock");
ok(res.status === 307 && res.headers.get("location")?.endsWith("/"), "unlock page redirects to the workspace when already unlocked");

console.log("Protection of direct requests");
for (const [m, p] of [["GET", "/api/media"], ["GET", "/api/media/x/file"], ["GET", "/api/media/x/thumb"], ["GET", "/api/media/x"]]) {
  r = await anon.json(p, m);
  ok(r.status === 401, `${m} ${p} without a session → 401`);
}
r = await anon.upload(fx.landscape, "image/jpeg");
ok(r.status === 401, "upload without a session → 401");
r = await anon.json("/api/media/x", "DELETE", undefined, CSRF);
ok(r.status === 401, "delete without a session → 401");
r = await A.upload(fx.landscape, "image/jpeg", {}, {});
ok(r.status === 403, "upload without the CSRF header → 403 even with a session");
const forged = new Client(); forged.cookie = "nx_access=forged-token-value";
r = await forged.json("/api/media");
ok(r.status === 401, "forged session cookie → 401");

console.log("Uploads");
const up1 = await A.upload(fx.landscape, "image/jpeg");
ok(up1.status === 201 && up1.body.media.width === 3000 && up1.body.media.height === 2000 && up1.body.media.hasThumb, "JPEG saved with server-read dimensions + thumbnail");
ok(up1.body.media.name === "Mountain Campaign Hero.jpg", "original filename kept");
const up2 = await A.upload(fx.portrait, "image/png");
ok(up2.status === 201 && up2.body.media.mime === "image/png", "PNG");
const up3 = await A.upload(fx.square, "image/webp");
ok(up3.status === 201 && up3.body.media.ext === "webp", "WebP");
const upv = await A.upload(fx.video, "video/webm", { "x-media-width": "640", "x-media-height": "360", "x-media-duration": "2.5" });
ok(upv.status === 201 && upv.body.media.kind === "video" && upv.body.media.duration === 2.5, "WebM video with metadata");
r = await A.upload(fx.fake, "image/jpeg");
ok(r.status === 415, `renamed non-image rejected by content (${r.body?.error?.slice(0, 50)}…)`);
r = await A.upload(fx.gif, "image/jpeg");
ok(r.status === 415 && /GIF/.test(r.body.error), "GIF rejected with specific guidance");
r = await A.upload(fx.mov, "video/mp4");
ok(r.status === 415 && /MOV/.test(r.body.error), "MOV rejected with specific guidance");
r = await A.upload(fx.text, "text/plain");
ok(r.status === 415, "text file rejected");
res = await A.req("/api/media/upload", { method: "POST", headers: { "content-type": "image/png", "x-file-name": "empty.png", ...CSRF }, body: new Uint8Array(0) });
ok(res.status === 400, "empty file rejected");
r = await A.upload(fx.big, "image/png");
ok(r.status === 413 && /limit/.test(r.body.error), `oversized image rejected (${r.body?.error})`);
res = await A.req(`/api/media/${upv.body.media.id}/poster`, { method: "PUT", headers: { "content-type": "image/jpeg", ...CSRF }, body: readFileSync(fx.landscape) });
ok(res.status === 200 && (await res.json()).media.hasThumb, "video poster stored");

console.log("Serving");
const imgId = up1.body.media.id, vidId = upv.body.media.id;
res = await A.req(`/api/media/${imgId}/thumb`);
ok(res.status === 200 && res.headers.get("content-type") === "image/webp", "thumbnail served as WebP");
res = await A.req(`/api/media/${imgId}/file?download=1`);
const bytes = Buffer.from(await res.arrayBuffer());
ok(bytes.equals(readFileSync(fx.landscape)), "download is byte-identical to the original");
ok(/attachment;.*Mountain/.test(res.headers.get("content-disposition") ?? ""), "download uses the original filename");
res = await A.req(`/api/media/${vidId}/file`, { headers: { range: "bytes=0-99" } });
ok(res.status === 206 && (await res.arrayBuffer()).byteLength === 100, "video Range request → 206");
ok(DATA_DIR && !existsSync(path.join(process.cwd(), "public", "media")), "originals are not under public/");

console.log("List, search, filter, sort");
r = await A.json("/api/summary");
ok(r.body.all === 4 && r.body.images === 3 && r.body.videos === 1 && r.body.trash === 0, "summary counts by type");
r = await A.json("/api/media?type=video");
ok(r.body.total === 1 && r.body.items[0].id === vidId, "type=video");
r = await A.json("/api/media?q=portrait");
ok(r.body.total === 1, "search by filename");
r = await A.json("/api/media?q=o&type=image&sort=name");
const names = r.body.items.map((m) => m.name.toLowerCase());
ok(r.body.items.every((m) => m.kind === "image") && names.every((n, i) => i === 0 || names[i - 1] <= n), "search + type + name sort combine");
r = await A.json("/api/media?sort=oldest");
ok(r.body.items[0].id === imgId, "oldest first");
r = await A.json("/api/media?sort=size");
ok(r.body.items.every((m, i, arr) => i === 0 || arr[i - 1].size >= m.size), "file size sort (largest first)");
r = await A.json("/api/media?limit=2");
ok(r.body.items.length === 2 && r.body.nextCursor === 2, "pagination cursor");

console.log("Rename");
r = await A.json(`/api/media/${imgId}`, "PATCH", { name: "Hero final.png" }, CSRF);
ok(r.status === 200 && r.body.media.name === "Hero final.png.jpg", `a different extension can't change the format (${r.body.media.name})`);
r = await A.json(`/api/media/${imgId}`, "PATCH", { name: "Hero final.jpg" }, CSRF);
ok(r.body.media.name === "Hero final.jpg", "rename keeps the real extension");
res = await A.req(`/api/media/${imgId}/file?download=1`);
ok(/Hero final\.jpg/.test(res.headers.get("content-disposition") ?? "") && Buffer.from(await res.arrayBuffer()).equals(readFileSync(fx.landscape)), "renamed file downloads with the new name and original bytes");
r = await A.json(`/api/media/${imgId}`, "PATCH", { name: "  " }, CSRF);
ok(r.status === 400, "empty name rejected");

console.log("Folders");
r = await A.json("/api/folders", "POST", { name: "Spring campaign" }, CSRF);
ok(r.status === 201 && r.body.folder.count === 0, "create folder");
const fold = r.body.folder.id;
r = await A.json("/api/folders", "POST", { name: "spring CAMPAIGN" }, CSRF);
ok(r.status === 409, "duplicate folder name rejected");
r = await anon.json("/api/folders", "POST", { name: "x" }, CSRF);
ok(r.status === 401, "folders require a session");
r = await A.json(`/api/folders/${fold}`, "PATCH", { name: "Spring launch" }, CSRF);
ok(r.status === 200 && r.body.folder.name === "Spring launch", "rename folder");
r = await A.json("/api/media/actions", "POST", { action: "move", ids: [imgId, up3.body.media.id], folderId: fold }, CSRF);
ok(r.body.moved === 2, "move two files into the folder");
r = await A.json(`/api/media?folder=${fold}`);
ok(r.body.total === 2, "folder view shows only its contents");
r = await A.json("/api/media");
ok(r.body.total === 4, "All media still includes files in folders");
r = await A.json("/api/media?folder=none");
ok(r.body.total === 2, "unfiled scope");
const inFolder = await A.upload(fx.portrait, "image/png", { "x-folder-id": fold });
ok(inFolder.status === 201 && inFolder.body.media.folderId === fold && !inFolder.body.folderMissing, "upload directly into a folder");
const ghost = await A.upload(fx.portrait, "image/png", { "x-folder-id": "no-such-folder" });
ok(ghost.status === 201 && ghost.body.media.folderId === null && ghost.body.folderMissing === true, "upload to a deleted folder falls back to unfiled and says so");
r = await A.json("/api/folders");
const listed = r.body.folders.find((x) => x.id === fold);
ok(listed.count === 3 && listed.cover && listed.cover.hasThumb, "folder count and cover thumbnail are genuine");

console.log("Trash, restore, permanent delete");
const before = (await A.json("/api/summary")).body;
r = await A.json("/api/media/actions", "POST", { action: "trash", ids: [imgId] }, CSRF);
ok(r.body.ids.length === 1, "move to Trash");
r = await A.json("/api/media");
ok(!r.body.items.some((m) => m.id === imgId), "trashed file hidden from All media");
r = await A.json("/api/media?q=hero");
ok(r.body.total === 0, "trashed file hidden from search");
r = await A.json(`/api/media?folder=${fold}`);
ok(!r.body.items.some((m) => m.id === imgId), "and hidden from its folder");
r = await A.json("/api/media?trash=1");
ok(r.body.total === 1 && r.body.items[0].id === imgId && r.body.items[0].trashedAt > 0, "Trash view lists it");
r = await A.json("/api/summary");
ok(r.body.all === before.all - 1 && r.body.trash === 1, "summary reflects Trash");
r = await A.json("/api/media/actions", "POST", { action: "move", ids: [imgId], folderId: null }, CSRF);
ok(r.body.moved === 0, "trashed files can't be moved");
res = await A.req(`/api/media/${ghost.body.media.id}`, { method: "DELETE", headers: CSRF });
ok(res.status === 409, "permanent delete requires Trash first");
await A.json("/api/media/actions", "POST", { action: "restore", ids: [imgId] }, CSRF);
r = await A.json(`/api/media?folder=${fold}`);
ok(r.body.items.some((m) => m.id === imgId), "restore returns the file to its original folder");
await A.json("/api/media/actions", "POST", { action: "trash", ids: [imgId] }, CSRF);
r = await A.json(`/api/folders/${fold}`, "DELETE", undefined, CSRF);
ok(r.status === 200 && r.body.unfiled === 3, "deleting a folder un-files its media, including trashed items");
r = await A.json("/api/summary");
ok(r.body.all === before.all - 1 && r.body.trash === 1, "no media deleted with the folder");
await A.json("/api/media/actions", "POST", { action: "restore", ids: [imgId] }, CSRF);
r = await A.json(`/api/media/${imgId}`);
ok(r.body.media.trashedAt === null && r.body.media.folderId === null, "restore after folder deletion goes to unfiled");
const victim = up2.body.media.id;
await A.json("/api/media/actions", "POST", { action: "trash", ids: [victim] }, CSRF);
r = await A.json("/api/media/actions", "POST", { action: "purge", ids: [victim] }, {});
ok(r.status === 403, "purge without CSRF header → 403");
r = await A.json("/api/media/actions", "POST", { action: "purge", ids: [victim, vidId] }, CSRF);
ok(r.body.ids.length === 1 && r.body.ids[0] === victim, "purge only affects trashed files in the request");
res = await A.req(`/api/media/${victim}/file`);
ok(res.status === 404, "purged original no longer served");
ok(!existsSync(path.join(DATA_DIR, "storage", "media", victim)), "purged original and thumbnail removed from storage");
ok(existsSync(path.join(DATA_DIR, "storage", "media", vidId)), "other files untouched");

console.log("Bulk download (zip)");
r = await A.json("/api/media/archive", "POST", { ids: [vidId, up3.body.media.id, imgId] }, CSRF);
ok(r.status === 200 && r.body.count === 3 && r.body.token, "prepare archive");
const token = r.body.token;
res = await anon.req(`/api/media/archive/${token}`);
ok(res.status === 401, "archive download requires a session");
res = await A.req(`/api/media/archive/${token}`);
const zip = Buffer.from(await res.arrayBuffer());
ok(res.status === 200 && res.headers.get("content-type") === "application/zip" && Number(res.headers.get("content-length")) === zip.length, "zip streamed with exact Content-Length");
const entries = readZip(zip);
ok(entries.length === 3 && entries.every((e) => e.crcOk), `zip has 3 entries with valid CRCs (${entries.map((e) => e.name).join(", ")})`);
ok(entries.some((e) => e.data.equals(readFileSync(fx.landscape))) && entries.some((e) => e.data.equals(readFileSync(fx.video))), "zip entries are byte-identical to the originals");
res = await A.req(`/api/media/archive/${token}`);
ok(res.status === 410, "archive tokens are single-use");
r = await A.json("/api/media/archive", "POST", { ids: ["nope-1", "nope-2"] }, CSRF);
ok(r.status === 400, "preparing with no available files fails clearly");

console.log("Lock");
const stolen = A.cookie;
r = await A.json("/api/access", "DELETE", undefined, CSRF);
ok(r.status === 200 && /nx_access=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(A.setCookie), "lock clears the cookie");
const replay = new Client(); replay.cookie = stolen;
r = await replay.json("/api/media");
ok(r.status === 401, "the old session token is invalid after locking (server-side)");
for (const p of ["/api/folders", "/api/summary", "/api/media?trash=1"]) { r = await replay.json(p); ok(r.status === 401, `locked: ${p} → 401`); }
r = await replay.json("/api/media/actions", "POST", { action: "trash", ids: ["x"] }, CSRF);
ok(r.status === 401, "locked: bulk actions → 401");
r = await replay.json("/api/media/archive", "POST", { ids: ["x"] }, CSRF);
ok(r.status === 401, "locked: archive preparation → 401");

console.log("Throttling");
const guesser = { ...CSRF, "x-forwarded-for": "10.7.7.7" };
let last;
for (let i = 0; i < 5; i++) last = await anon.unlock(`wrong-${i}`, guesser);
ok(last.status === 429 && Number(last.headers.get("retry-after")) > 0, `5 wrong attempts → 429 + Retry-After (${last.body.error})`);
r = await anon.unlock(PASS, guesser);
ok(r.status === 429, "even the correct passphrase is refused during the lockout");

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

/** Minimal reader for the stored-entry zips we produce, via the central directory. */
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  const out = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    const crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const lNameLen = buf.readUInt16LE(local + 26), lExtra = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lNameLen + lExtra, local + 30 + lNameLen + lExtra + size);
    out.push({ name, data, crcOk: (crc32(data) >>> 0) === crc });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}
