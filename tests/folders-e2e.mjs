// New-folder, single-file move and bulk create-and-move workflows in every brand.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import sharp from "sharp";

const BASE = process.env.BASE ?? "http://localhost:3000";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const wait = (fn) => page.waitForFunction(fn);
try {
  await page.goto(`${BASE}/unlock`);
  await page.getByLabel("Passphrase", { exact: true }).fill(process.env.PASSPHRASE);
  await page.getByRole("button", { name: "Unlock workspace" }).click();
  await page.waitForURL(`${BASE}/`);
  const image = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#ffc36a" } }).png().toBuffer();
  for (const [brand, label] of [["nexosphere", "Nexosphere"], ["nexuflow", "Nexuflow"], ["nexotv", "Nexo TV"]]) {
    await page.goto(BASE);
    await page.getByRole("button", { name: new RegExp(`Enter ${label}`) }).click();
    await page.locator(".dashboard").waitFor();
    for (const name of ["Projects", "Archive"]) {
      await page.locator(".dashboard").getByRole("button", { name: "New folder", exact: true }).click();
      await page.getByLabel("Folder name").fill(name);
      await page.getByRole("dialog").getByRole("button", { name: "Create folder", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.locator(".dash-folder", { hasText: name }).waitFor();
    }
    await page.locator(".dash-card", { hasText: "All media" }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.locator(".app-side").getByRole("button", { name: "Upload files" }).click();
    await (await chooser).setFiles(["asset-one.png", "asset-two.png"].map((name) => ({ name, mimeType: "image/png", buffer: image })));
    await wait(() => document.querySelectorAll(".gallery .card").length === 2);
    await page.getByRole("button", { name: "Move asset-one.png to folder", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Projects/ }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    const api = async (route) => (await page.request.get(`${BASE}${route}?workspace=${brand}`)).json();
    let folders = (await api("/api/folders")).folders;
    assert.equal(folders.find((f) => f.name === "Projects").count, 1);
    await page.goto(`${BASE}/?folder=${folders.find((f) => f.name === "Projects").id}`);
    await page.getByRole("button", { name: "Move asset-one.png to folder", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Archive/ }).click();
    await page.getByRole("heading", { name: "This folder is empty" }).waitFor();
    await page.goto(`${BASE}/?view=all`);
    await wait(() => document.querySelectorAll(".gallery .card").length === 2);
    for (const name of ["asset-one.png", "asset-two.png"]) await page.getByRole("checkbox", { name: `Select ${name}`, exact: true }).check();
    await page.getByRole("region", { name: "Actions for selected files" }).getByRole("button", { name: "Move to folder", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "New folder", exact: true }).click();
    await page.getByLabel("Folder name").fill("Delivery");
    await page.getByRole("dialog").getByRole("button", { name: "Create and move" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByRole("region", { name: "Actions for selected files" }).waitFor({ state: "hidden" });
    folders = (await api("/api/folders")).folders;
    assert.equal(folders.find((f) => f.name === "Delivery").count, 2);
    assert.equal(folders.find((f) => f.name === "Projects").count, 0);
    assert.equal(folders.find((f) => f.name === "Archive").count, 0);
    await page.goto(`${BASE}/?view=dashboard`);
    await page.locator(".dash-folder", { hasText: "Delivery" }).waitFor();
    await page.reload();
    await page.locator(".dash-folder", { hasText: "Delivery" }).waitFor();
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.locator(".dashboard").getByRole("button", { name: "New folder", exact: true }).waitFor();
    }
    console.log(`Passed: ${label} creates folders, moves files between folders, bulk creates-and-moves, persists after reload and fits mobile.`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
