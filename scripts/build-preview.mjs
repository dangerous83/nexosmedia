// Assembles the static site published to GitHub Pages: a single showcase page that embeds every
// screenshot captured by preview-shots.mjs. Everything is self-contained; no build tooling, no JS
// framework, no external requests — GitHub Pages serves it as-is.
import { readdirSync, writeFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const OUT = process.env.OUT || "preview-out";
const SHOTS = path.join(OUT, "shots");
mkdirSync(OUT, { recursive: true });

// Copy the brand assets so the showcase carries the same logo as the app.
if (existsSync("public/brand")) {
  mkdirSync(path.join(OUT, "brand"), { recursive: true });
  cpSync("public/brand", path.join(OUT, "brand"), { recursive: true });
}

const files = existsSync(SHOTS) ? readdirSync(SHOTS).filter((f) => f.endsWith(".png")).sort() : [];

// Human labels + captions, keyed by the ordered filenames written by preview-shots.mjs.
const meta = {
  "01-unlock-desktop.png":     { title: "Unlock", note: "The passphrase-gated entry to the shared workspace." },
  "02-unlock-mobile.png":      { title: "Unlock — mobile", note: "The same screen, 390 px wide." },
  "03-workspace-empty.png":    { title: "Empty workspace", note: "First-run state. Drop files anywhere, or use the sidebar." },
  "04-workspace-populated.png":{ title: "Populated grid", note: "Real uploads: real thumbnails, real metadata." },
  "05-workspace-large-thumbs.png":{ title: "Large thumbnails", note: "One of three thumbnail sizes." },
  "06-details-panel.png":      { title: "Details panel", note: "Preview, rename, move, download, delete." },
  "07-folder-created.png":     { title: "Folders", note: "One level, no nesting. All media is always visible." },
  "08-workspace-mobile.png":   { title: "Workspace — mobile", note: "The same UI on a phone." },
};

const cards = files.map((f) => {
  const m = meta[f] || { title: f.replace(/\.png$/, ""), note: "" };
  return `
    <figure class="shot">
      <a href="shots/${f}" target="_blank" rel="noopener">
        <img loading="lazy" src="shots/${f}" alt="${m.title}" />
      </a>
      <figcaption>
        <h3>${m.title}</h3>
        <p>${m.note}</p>
      </figcaption>
    </figure>`;
}).join("");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NEXOSPHERE Media Space — interface preview</title>
  <meta name="description" content="A visual preview of the NEXOSPHERE Media Space interface. The live app runs as a Node server; this page is a static gallery of screenshots taken from the real app on every push." />
  <style>
    :root {
      --bg: #0b0d10;
      --panel: #12151a;
      --line: #1e232b;
      --ink: #eef1f6;
      --ink-2: #a4adba;
      --accent: #7c9cff;
      --radius: 14px;
      --gutter: 24px;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
    a { color: var(--accent); }
    header {
      padding: 64px var(--gutter) 40px;
      max-width: 1120px; margin: 0 auto;
      display: flex; flex-direction: column; gap: 18px;
    }
    header .brand {
      display: flex; align-items: center; gap: 12px;
    }
    header .brand img { height: 40px; width: auto; display: block; }
    header .tag {
      display: inline-block; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--ink-2); border: 1px solid var(--line); padding: 4px 10px; border-radius: 999px;
    }
    header h1 { font-size: clamp(28px, 3.4vw, 44px); margin: 8px 0 0; line-height: 1.15; letter-spacing: -0.01em; }
    header p { color: var(--ink-2); max-width: 62ch; margin: 0; }
    header .meta { color: var(--ink-2); font-size: 13px; }
    header .meta code { background: var(--panel); border: 1px solid var(--line); padding: 2px 6px; border-radius: 6px; color: var(--ink); }
    main { padding: 8px var(--gutter) 120px; max-width: 1120px; margin: 0 auto; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: var(--gutter); }
    .shot { margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; display: flex; flex-direction: column; }
    .shot a { display: block; background: #06080a; }
    .shot img { display: block; width: 100%; height: auto; }
    .shot figcaption { padding: 16px 18px 18px; border-top: 1px solid var(--line); }
    .shot h3 { margin: 0 0 4px; font-size: 15px; letter-spacing: 0.01em; }
    .shot p { margin: 0; color: var(--ink-2); font-size: 13px; }
    footer { max-width: 1120px; margin: 40px auto 60px; padding: 24px var(--gutter); border-top: 1px solid var(--line); color: var(--ink-2); font-size: 13px; }
    .empty { padding: 60px 20px; text-align: center; color: var(--ink-2); border: 1px dashed var(--line); border-radius: var(--radius); }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <img src="brand/nexosphere-wordmark.png" alt="NEXOSPHERE" onerror="this.style.display='none'"/>
      <span class="tag">Media Space</span>
    </div>
    <h1>Interface preview</h1>
    <p>NEXOSPHERE Media Space is a private, passphrase-protected workspace for images and videos. The live app needs a Node server (SQLite, uploads, session cookies), so it can't run on GitHub Pages. This page is a static gallery of screenshots taken from the real app in CI on every push, so the interface is always visible here even when a live server isn't up.</p>
    <p class="meta">Built ${new Date().toISOString().slice(0, 10)} · <a href="https://github.com/dangerous83/nexosmedia">Source</a></p>
  </header>
  <main>
    ${files.length ? `<section class="grid">${cards}</section>` : `<p class="empty">No screenshots yet. The next push will fill this page.</p>`}
  </main>
  <footer>
    To run the actual workspace, follow <a href="https://github.com/dangerous83/nexosmedia#deploy-live-url-and-pull-request-previews">Deploy</a> in the README — the Render Blueprint gets you a live URL plus a preview URL per pull request.
  </footer>
</body>
</html>`;

writeFileSync(path.join(OUT, "index.html"), html);
// Disable Jekyll on Pages so filenames starting with "_" and folders like _next work verbatim.
writeFileSync(path.join(OUT, ".nojekyll"), "");
console.log(`preview site → ${OUT}/index.html (${files.length} shots)`);
