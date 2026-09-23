// Browser end-to-end checks for the Media Space UI (Playwright Chromium).
// Usage: BASE=http://localhost:3210 PASSPHRASE=… SHOTS=./shots node tests/e2e.mjs
// Start the server with an EMPTY DATA_DIR and default size limits.
import { chromium } from "playwright";
import os from "node:os";
import path from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import { makeFixtures } from "./fixtures.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const PASS = process.env.PASSPHRASE;
const SHOTS = process.env.SHOTS ?? path.join(os.tmpdir(), "nexo-shots");
mkdirSync(SHOTS, { recursive: true });
let failures = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log("  ✓", m); } else { failures++; console.log("  ✗", m); } };
const fx = await makeFixtures(path.join(os.tmpdir(), "nexo-fixtures"));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(String(e)));
const notFound = [];
page.on("response", (r) => { if (r.status() === 404) notFound.push(r.url()); });
const waitFor = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(200); } return false; };
const cards = () => page.locator(".gallery .card");
const apiJson = async (p) => (await page.request.get(`${BASE}${p}`)).json();
const summary = () => apiJson("/api/summary");
const side = () => page.locator(".app-side");
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

console.log("Access");
await page.goto(`${BASE}/`);
ok(page.url().endsWith("/unlock"), "workspace redirects to the access screen");
await page.getByLabel("Passphrase", { exact: true }).fill("wrong-passphrase");
await page.getByRole("button", { name: "Unlock workspace" }).click();
ok(await waitFor(async () => /isn't correct/.test(await page.locator(".alert").innerText())), "wrong passphrase → clear error");
await page.getByLabel("Passphrase", { exact: true }).fill(PASS);
await page.getByRole("button", { name: "Unlock workspace" }).click();
await page.waitForURL(`${BASE}/`);

console.log("Empty workspace");
await page.locator(".zone-hero").waitFor();
ok(await page.getByRole("heading", { name: "Drop it here. Keep it together." }).isVisible(), "large upload panel when empty");
ok((await page.locator(".toolbar").count()) === 0, "no gallery toolbar while empty");
const nav = side().getByRole("navigation", { name: "Workspace" });
for (const label of ["All media", "Images", "Videos", "All folders", "Uploads", "Trash"]) ok(await nav.getByRole("link", { name: label }).isVisible(), `sidebar: ${label}`);
ok(await side().getByRole("button", { name: "Upload files" }).isVisible() && await side().getByRole("button", { name: "Lock workspace" }).isVisible(), "sidebar: Upload files and Lock workspace");
ok(!(await page.locator(".uhead-upload").isVisible()), "no duplicate Upload button in the desktop header");
const text = await page.locator("body").innerText();
ok(!/SphereHub|Collections|Favorites|Presentation|Sign out|Good (morning|afternoon)/i.test(text), "no SphereHub/account UI");
await shot("empty-1440");

console.log("Upload");
let chooser = page.waitForEvent("filechooser");
await side().getByRole("button", { name: "Upload files" }).click();
await (await chooser).setFiles([fx.landscape, fx.portrait, fx.square, fx.video, fx.fake]);
ok(await waitFor(async () => (await summary()).all === 4, 30000), "4 valid files saved");
ok(await waitFor(async () => (await cards().count()) === 4), "gallery updates without reload");
ok(await waitFor(async () => (await page.locator(".uq-row.uq-danger").count()) === 1), "unsupported file stays visible in the tray");
await page.getByRole("button", { name: /Remove not-really-an-image/ }).click();

console.log("Progress, cancel, retry");
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 20, downloadThroughput: -1, uploadThroughput: 700 * 1024 });
chooser = page.waitForEvent("filechooser");
await side().getByRole("button", { name: "Upload files" }).click();
await (await chooser).setFiles([fx.big]);
const bigRow = page.locator(".tray .uq-row", { hasText: "large-noise-texture" });
let mid = null;
await waitFor(async () => { const m = /(\d+)% of/.exec(await bigRow.innerText()); if (m && +m[1] > 0 && +m[1] < 100) { mid = +m[1]; return true; } return false; });
ok(mid != null, `real progress (${mid}%)`);
await side().getByRole("navigation").getByRole("link", { name: "Uploads" }).click();
const mainRow = () => page.locator("main .uq-row", { hasText: "large-noise-texture" });
ok(await waitFor(async () => (await mainRow().count()) === 1), "Uploads view lists the active upload");
await mainRow().getByRole("button", { name: /Cancel upload/ }).click();
ok(await waitFor(async () => /Canceled/.test(await mainRow().innerText())), "cancel → listed under Needs attention");
ok((await summary()).all === 4, "canceled upload not saved");
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await mainRow().getByRole("button", { name: /Retry/ }).click();
ok(await waitFor(async () => (await summary()).all === 5, 30000), "retry saves exactly once");
await side().getByRole("navigation").getByRole("link", { name: "All media" }).click();
await waitFor(async () => (await cards().count()) === 5);

console.log("Persistence & preferences");
await page.getByRole("button", { name: "Large thumbnails" }).click();
await page.reload();
await cards().first().waitFor();
ok((await cards().count()) === 5, "5 files after reload");
ok(await page.locator(".gallery.dens-large").isVisible(), "thumbnail size preference persisted locally");
await page.getByRole("button", { name: "Comfortable thumbnails" }).click();
ok(await waitFor(async () => (await page.locator(".card .thumb-img[data-loaded]").count()) === 5), "thumbnails load (incl. video poster)");
await shot("all-1440");

console.log("Folders");
await side().getByRole("button", { name: "Create folder" }).click();
await page.getByLabel("Folder name").fill("Spring campaign");
await page.getByRole("button", { name: "Create folder" }).click();
ok(await waitFor(async () => (await side().getByRole("navigation").getByRole("link", { name: /Spring campaign/ }).count()) === 1), "folder appears in the sidebar");
await page.locator(".card", { hasText: "square-social" }).getByRole("button", { name: /Actions for/ }).click();
await page.getByRole("menuitem", { name: /Move to folder/ }).click();
await page.getByRole("dialog").getByRole("button", { name: /Spring campaign/ }).click();
ok(await waitFor(async () => (await apiJson("/api/folders")).folders[0].count === 1), "Move to folder (menu) works");
await side().getByRole("navigation").getByRole("link", { name: /Spring campaign/ }).click();
await page.waitForURL(/folder=/);
ok(await waitFor(async () => (await page.locator(".crumbs").innerText()).includes("Spring campaign")), "breadcrumb shows the folder");
ok(await page.getByRole("heading", { name: /add them to “Spring campaign”/ }).isVisible(), "upload strip names the destination");
chooser = page.waitForEvent("filechooser");
await side().getByRole("button", { name: "Upload files" }).click();
await (await chooser).setFiles([fx.portrait]);
ok(await waitFor(async () => (await apiJson("/api/folders")).folders[0].count === 2, 20000), "upload inside a folder lands in that folder");
ok(await waitFor(async () => (await cards().count()) === 2), "folder view shows only its 2 files");
ok((await summary()).all === 6, "All media includes files in folders (6)");
await shot("folder-1440");

console.log("Selection & bulk actions");
await side().getByRole("navigation").getByRole("link", { name: "All media" }).click();
await waitFor(async () => (await cards().count()) === 6);
await page.getByRole("button", { name: "Select", exact: true }).click();
await page.locator(".card", { hasText: "Mountain Campaign" }).locator(".check").check();
await page.locator(".card", { hasText: "Studio Reel" }).locator(".check").check();
ok((await page.locator(".viewer").count()) === 0, "checking a box never opens the preview");
ok(/2 selected/.test(await page.locator(".bulkbar").innerText()), "bulk bar shows the selected count");
await shot("selection-1440");
const dl = page.waitForEvent("download");
await page.locator(".bulkbar").getByRole("button", { name: /Download/ }).click();
const entries = readZip(readFileSync(await (await dl).path()));
ok(entries.length === 2 && entries.every((e) => e.crcOk) && entries.some((e) => e.data.equals(readFileSync(fx.landscape))), `bulk download is a valid zip of the 2 originals (${entries.map((e) => e.name).join(", ")})`);
await page.locator(".bulkbar").getByRole("button", { name: /Move to folder/ }).click();
await page.getByRole("dialog").getByRole("button", { name: /Spring campaign/ }).click();
ok(await waitFor(async () => (await apiJson("/api/folders")).folders[0].count === 4), "bulk move affects exactly the 2 selected files");
ok(await waitFor(async () => (await page.locator(".bulkbar").count()) === 0), "selection cleared after moving");
await page.getByRole("button", { name: "Select", exact: true }).click();
await page.getByRole("button", { name: /Select all loaded/ }).click();
ok(/6 selected/.test(await page.locator(".bulkbar").innerText()), "Select all selects the loaded results");
await page.keyboard.press("Escape");
ok(await waitFor(async () => (await page.locator(".bulkbar").count()) === 0), "Esc clears the selection");

console.log("Trash, Undo, Restore, permanent delete");
await page.getByRole("button", { name: "Select", exact: true }).click();
await page.locator(".card", { hasText: "large-noise" }).locator(".check").check();
await page.locator(".bulkbar").getByRole("button", { name: /Move to Trash/ }).click();
ok(await waitFor(async () => (await summary()).trash === 1 && (await cards().count()) === 5), "bulk Move to Trash removes it from the view");
await page.getByRole("button", { name: "Undo" }).click();
ok(await waitFor(async () => (await summary()).trash === 0 && (await cards().count()) === 6), "Undo restores it");
await page.locator(".card", { hasText: "large-noise" }).getByRole("button", { name: /Actions for/ }).click();
await page.getByRole("menuitem", { name: "Move to Trash" }).click();
ok(await waitFor(async () => (await summary()).trash === 1), "single Move to Trash");
await side().getByRole("navigation").getByRole("link", { name: /Trash/ }).click();
ok(await waitFor(async () => (await cards().count()) === 1), "Trash view shows the trashed file");
await shot("trash-1440");
await page.locator(".card").getByRole("button", { name: /Actions for/ }).click();
await page.getByRole("menuitem", { name: "Restore" }).click();
ok(await waitFor(async () => { const s = await summary(); return s.trash === 0 && s.all === 6; }), "Restore returns it");
await side().getByRole("navigation").getByRole("link", { name: "All media" }).click();
await page.locator(".card", { hasText: "large-noise" }).getByRole("button", { name: /Actions for/ }).click();
await page.getByRole("menuitem", { name: "Move to Trash" }).click();
await waitFor(async () => (await summary()).trash === 1);
await side().getByRole("navigation").getByRole("link", { name: /Trash/ }).click();
await waitFor(async () => (await cards().count()) === 1);
await page.locator(".card").getByRole("button", { name: /Actions for/ }).click();
await page.getByRole("menuitem", { name: /Delete permanently/ }).click();
ok(/can.t be undone/.test(await page.getByRole("alertdialog").innerText()), "permanent delete asks for confirmation");
await page.getByRole("button", { name: "Delete permanently" }).click();
ok(await waitFor(async () => { const s = await summary(); return s.trash === 0 && s.all === 5; }), "deleted permanently; nothing else affected");

console.log("Details & rename");
await side().getByRole("navigation").getByRole("link", { name: "All media" }).click();
await waitFor(async () => (await cards().count()) === 5);
await page.locator(".card", { hasText: "Studio Reel" }).getByRole("button", { name: /Actions for/ }).click();
await page.getByRole("menuitem", { name: "Details" }).click();
const det = page.locator(".details");
ok(await det.isVisible() && /Spring campaign/.test(await det.innerText()) && /Video · WEBM/.test(await det.innerText()), "details panel shows type and current folder");
await det.getByRole("button", { name: "Rename", exact: true }).click();
await page.getByRole("dialog").getByLabel("File name").fill("Launch teaser");
await page.getByRole("dialog").getByRole("button", { name: "Rename", exact: true }).click();
ok(await waitFor(async () => /Launch teaser\.webm/.test(await det.innerText())), "rename updates the display name and keeps the extension");
await shot("details-1440");
await det.getByRole("button", { name: "Close details" }).click();

console.log("Preview");
await page.locator(".card", { hasText: "Mountain Campaign" }).locator(".card-open").click();
await page.locator(".viewer-img").first().waitFor();
await page.getByRole("button", { name: "Zoom in (+)" }).click();
ok((await page.locator(".viewer-zoom-level").innerText()) === "125%", "zoom");
await page.keyboard.press("Escape");
ok(await waitFor(async () => (await page.locator(".viewer").count()) === 0), "Esc closes the preview");
await page.locator(".card", { hasText: "Launch teaser" }).locator(".card-open").click();
const video = page.locator(".viewer video");
await video.waitFor();
ok(await video.evaluate((v) => v.paused && v.hasAttribute("controls")), "video: controls, no autoplay");
const t = await video.evaluate(async (v) => { v.muted = true; await v.play(); await new Promise((r) => setTimeout(r, 700)); return v.currentTime; });
ok(t > 0.2, "video plays on request");
await page.keyboard.press("Escape");
await waitFor(async () => (await page.locator(".viewer").count()) === 0);

console.log("Sorting & list view");
await page.locator(".toolbar select").selectOption("size");
const bySize = (await apiJson("/api/media?sort=size")).items.map((m) => m.name);
ok(await waitFor(async () => (await page.locator(".card-name").first().innerText()) === bySize[0]), "sort by file size");
await page.getByRole("button", { name: "List view" }).click();
ok(await waitFor(async () => (await page.locator(".rows .row").count()) === 5), "list view shows rows");
await shot("list-1440");
await page.reload();
ok(await waitFor(async () => (await page.locator(".rows .row").count()) === 5), "list view preference persisted");
await page.getByRole("button", { name: "Grid view" }).click();
await page.locator(".toolbar select").selectOption("newest");

console.log("Delete folder");
await side().getByRole("navigation").getByRole("link", { name: /Spring campaign/ }).click();
await page.getByRole("button", { name: /Folder actions/ }).click();
await page.getByRole("menuitem", { name: /Delete folder/ }).click();
ok(/move back to All media/.test(await page.getByRole("alertdialog").innerText()), "folder deletion explains files are kept");
await page.getByRole("button", { name: "Delete folder" }).click();
await page.waitForURL(/view=folders/);
ok(await waitFor(async () => (await apiJson("/api/folders")).folders.length === 0 && (await summary()).all === 5), "folder deleted, all 5 files kept");

console.log("Responsive");
for (const w of [360, 390, 768, 1024, 1440, 1920]) {
  await page.setViewportSize({ width: w, height: w < 800 ? 820 : 900 });
  for (const view of ["/", "/?view=folders", "/?view=trash", "/?view=uploads"]) {
    await page.goto(`${BASE}${view}`);
    await page.locator("main h1").waitFor();
    await page.waitForTimeout(250);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(over <= 0, `${view} @${w}px: no overflow${over > 0 ? ` (+${over})` : ""}`);
  }
  await page.goto(`${BASE}/`);
  await cards().first().waitFor();
  await page.waitForTimeout(400);
  await shot(`all-${w}`);
}
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/`);
await cards().first().waitFor();
ok(await page.locator(".uhead-upload").isVisible(), "phone: Upload stays in the header");
const small = await page.evaluate(() => [...document.querySelectorAll(".uhead button, .toolbar button, .toolbar select, .item-more, .zone button")]
  .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.width < 40 || r.height < 40); }).map((el) => el.getAttribute("aria-label") || el.textContent.trim()));
ok(small.length === 0, `phone: controls large enough${small.length ? ` (${small.join(", ")})` : ""}`);
await page.getByRole("button", { name: "Open navigation" }).click();
ok(await page.locator(".drawer").getByRole("link", { name: "Trash" }).isVisible(), "phone: navigation drawer");
await shot("drawer-390");
await page.locator(".drawer").getByRole("link", { name: "Images" }).click();
ok(await waitFor(async () => page.url().includes("view=images") && (await page.locator(".drawer").count()) === 0), "drawer navigates and closes");
await cards().first().waitFor();
await page.locator(".card").first().getByRole("button", { name: /Actions for/ }).click();
await page.getByRole("menuitem", { name: "Details" }).click();
ok(await waitFor(async () => page.locator(".sheet").isVisible()), "phone: details open as a sheet");
await shot("details-sheet-390");
await page.keyboard.press("Escape");
await page.setViewportSize({ width: 1024, height: 800 });
await page.goto(`${BASE}/`);
await cards().first().waitFor();
ok(await page.locator(".app-rail").isVisible() && !(await side().isVisible()), "tablet: compact rail instead of the full sidebar");
await page.locator(".app-rail").getByRole("link", { name: "Trash" }).hover();
await shot("rail-1024");

console.log("Lock");
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${BASE}/`);
await side().getByRole("button", { name: "Lock workspace" }).click();
await page.waitForURL(`${BASE}/unlock`);
for (const p of ["/api/media", "/api/folders", "/api/summary"]) ok((await page.request.get(`${BASE}${p}`)).status() === 401, `locked: ${p} → 401`);

const relevant = consoleErrors.filter((e) => !/status of (401|415)/.test(e));
ok(relevant.length === 0, `no console errors${relevant.length ? `:\n    ${relevant.slice(0, 5).join("\n    ")}` : ""}`);
if (notFound.length) console.log("    404 URLs:", notFound.join(" | "));
await browser.close();
console.log(`\n${passes} passed, ${failures} failed. Screenshots: ${SHOTS}`);
process.exit(failures ? 1 : 0);

function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    const crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    out.push({ name, data, crcOk: (crc32(data) >>> 0) === crc });
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}
