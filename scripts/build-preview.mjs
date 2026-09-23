// Assembles the static site published to GitHub Pages. The landing page IS the dashboard — a
// full-viewport snapshot of the populated workspace with no header, no gallery, no wrapper. Other
// screens are still captured and reachable at /shots/… for reference, but they are not surfaced
// on the index. Everything is self-contained; GitHub Pages serves it as-is.
import { existsSync, mkdirSync, cpSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = process.env.OUT || "preview-out";
const SHOTS = path.join(OUT, "shots");
mkdirSync(OUT, { recursive: true });

// Carry the brand assets so the tab icon and OG image match the app.
if (existsSync("public/brand")) {
  mkdirSync(path.join(OUT, "brand"), { recursive: true });
  cpSync("public/brand", path.join(OUT, "brand"), { recursive: true });
}

// The dashboard shot is the whole page; fall back to the populated grid if the full-page one is
// missing for any reason (older run, capture failed, etc.).
const shots = existsSync(SHOTS) ? readdirSync(SHOTS).filter((f) => f.endsWith(".png")).sort() : [];
const dashboard =
  shots.find((f) => f.startsWith("00-dashboard")) ||
  shots.find((f) => f.startsWith("04-workspace-populated")) ||
  shots[0];

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NEXOSPHERE Media Space</title>
  <link rel="icon" href="brand/nexosphere-symbol-192.png" />
  <style>
    :root { color-scheme: dark; }
    html, body { margin: 0; background: #0b0d10; }
    body {
      min-height: 100dvh;
      display: block;
      font: 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
      color: #eef1f6;
      -webkit-font-smoothing: antialiased;
    }
    /* The dashboard fills the page. On desktop it sits at natural width; on narrow screens it
       scales down to fit so nothing overflows sideways. */
    .dashboard {
      display: block;
      width: 100%;
      height: auto;
      max-width: 100vw;
    }
  </style>
</head>
<body>
  ${dashboard
    ? `<img class="dashboard" src="shots/${dashboard}" alt="NEXOSPHERE Media Space" />`
    : `<p style="padding:40px;color:#a4adba">Dashboard screenshot missing. The next push will fill this page.</p>`}
</body>
</html>`;

writeFileSync(path.join(OUT, "index.html"), html);
// Disable Jekyll so filenames beginning with "_" and folders like _next are served verbatim.
writeFileSync(path.join(OUT, ".nojekyll"), "");
console.log(`preview site → ${OUT}/index.html (landing: ${dashboard || "—"}, ${shots.length} shots total)`);
