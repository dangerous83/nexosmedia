// Drives the real app with Playwright and captures the screens that show the interface, so a
// static build (see build-preview.mjs) can display them on GitHub Pages when the app itself
// can't run there. Expects a server started against a scratch DATA_DIR and a known passphrase.
import { chromium } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";

// A CHROME=… env var pins the Chromium binary (used both here and by tests/fixtures.mjs, which
// launches its own headless Chromium to record a WebM). Wrap launch before importing fixtures.
if (process.env.CHROME) {
  const orig = chromium.launch.bind(chromium);
  chromium.launch = (o = {}) => orig({ executablePath: process.env.CHROME, ...o });
}
const { makeFixtures } = await import("../tests/fixtures.mjs");

const BASE = process.env.BASE || "http://localhost:3000";
const PASS = process.env.PASSPHRASE || "test-passphrase-123";
const OUT = process.env.OUT || "preview-out/shots";
mkdirSync(OUT, { recursive: true });

const shot = (page, name, full = false) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
const settle = (page, ms = 400) => page.waitForTimeout(ms);

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const desktop = { width: 1600, height: 1000, deviceScaleFactor: 2 };
const mobile = { width: 390, height: 780, deviceScaleFactor: 2 };

// ── Fixtures: real images we can upload to make the workspace look inhabited.
const fixturesDir = process.env.FIXTURES_DIR || path.resolve("./preview-out/fixtures");
if (!existsSync(fixturesDir)) mkdirSync(fixturesDir, { recursive: true });
const files = await makeFixtures(fixturesDir);
const uploads = [files.landscape, files.portrait, files.square];

async function unlock(page) {
  await page.goto(`${BASE}/unlock`);
  await page.getByLabel("Passphrase", { exact: true }).fill(PASS);
  await page.getByRole("button", { name: "Unlock workspace" }).click();
  await page.waitForURL(new RegExp(`${BASE.replace(/[/.]/g, "\\$&")}/?$`));
}

// ── 1. Unlock screen (desktop + mobile)
{
  const ctx = await browser.newContext({ viewport: desktop });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/unlock`);
  await settle(page);
  await shot(page, "01-unlock-desktop");
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: mobile });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/unlock`);
  await settle(page);
  await shot(page, "02-unlock-mobile");
  await ctx.close();
}

// ── 2. Workspace: empty, then filled. Reuse one context so the session carries over.
const ctx = await browser.newContext({ viewport: desktop });
const page = await ctx.newPage();
await unlock(page);
await settle(page);
await shot(page, "03-workspace-empty");

// Upload a few files via the visible file input so the gallery has real content.
const fileInput = page.locator('input[type="file"]').first();
await fileInput.setInputFiles(uploads);
// Wait until the three cards are all in the grid.
await page.waitForFunction((n) => document.querySelectorAll(".card").length >= n, uploads.length, { timeout: 30000 });
await settle(page, 800);
await shot(page, "04-workspace-populated");
// The landing image on the static site — a full-viewport snapshot of the populated dashboard.
await shot(page, "00-dashboard", true);

// Large thumbnail view — the graphic-designer view.
await page.getByRole("button", { name: "Large thumbnails" }).click();
await settle(page);
await shot(page, "05-workspace-large-thumbs");
await page.getByRole("button", { name: "Comfortable thumbnails" }).click();
await settle(page);

// Details panel: click a card to open its preview + metadata.
await page.locator(".card").first().click();
await settle(page, 500);
await shot(page, "06-details-panel");
await page.keyboard.press("Escape");
await settle(page);

// Folders: create one and show the sidebar populated.
await page.getByRole("button", { name: "Create folder" }).first().click();
await page.getByRole("textbox").fill("Spring campaign");
await page.getByRole("button", { name: "Create folder" }).last().click();
await settle(page);
await shot(page, "07-folder-created");

await ctx.close();

// ── 3. Mobile workspace
{
  const ctx = await browser.newContext({ viewport: mobile });
  const page = await ctx.newPage();
  await unlock(page);
  await settle(page, 600);
  await shot(page, "08-workspace-mobile");
  await ctx.close();
}

await browser.close();
console.log("preview screenshots →", OUT);
