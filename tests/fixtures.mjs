// Generates test media: real images (sharp), a disguised non-image, and a playable WebM recorded
// by headless Chromium's MediaRecorder (no ffmpeg required).
import sharp from "sharp";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

export async function makeFixtures(dir) {
  mkdirSync(dir, { recursive: true });
  const svg = (w, h, a, b, label) => Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 4}" fill="rgba(255,255,255,0.25)"/><text x="50%" y="54%" font-family="Arial" font-size="${Math.min(w, h) / 9}" fill="white" text-anchor="middle">${label}</text></svg>`,
  );
  const files = {
    landscape: path.join(dir, "Mountain Campaign Hero.jpg"),
    portrait: path.join(dir, "portrait_lookbook.png"),
    square: path.join(dir, "square-social.webp"),
    fake: path.join(dir, "not-really-an-image.jpg"),
    text: path.join(dir, "notes.txt"),
    video: path.join(dir, "Studio Reel.webm"),
    big: path.join(dir, "large-noise-texture.png"),
    gif: path.join(dir, "animation.gif"),
    mov: path.join(dir, "iphone-clip.mov"),
  };
  await sharp(svg(3000, 2000, "#1d4ed8", "#9333ea", "Landscape")).jpeg({ quality: 85 }).toFile(files.landscape);
  await sharp(svg(1200, 1800, "#0e7490", "#4338ca", "Portrait")).png().toFile(files.portrait);
  await sharp(svg(1080, 1080, "#be185d", "#312e81", "Square")).webp().toFile(files.square);
  if (!existsSync(files.big)) {
    // Incompressible noise → a ~9 MB PNG, big enough to observe progress under throttling.
    const w = 1800, h = 1700, raw = Buffer.alloc(w * h * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (Math.random() * 256) | 0;
    await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 0 }).toFile(files.big);
  }
  await sharp(svg(64, 64, "#111", "#333", "G")).gif().toFile(files.gif);
  // Minimal QuickTime header (ftyp brand "qt  ") — enough for content sniffing to recognise MOV.
  writeFileSync(files.mov, Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from("ftypqt  ", "latin1"), Buffer.alloc(4), Buffer.from("qt  ", "latin1"), Buffer.alloc(64)]));
  writeFileSync(files.fake, "MZ this is definitely not a JPEG, just text pretending to be one");
  writeFileSync(files.text, "plain text");

  if (!existsSync(files.video)) {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const b64 = await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 640; c.height = 360;
      const ctx = c.getContext("2d");
      const stream = c.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      const done = new Promise((r) => (rec.onstop = r));
      rec.start(100);
      const t0 = performance.now();
      await new Promise((resolve) => {
        const draw = () => {
          const t = (performance.now() - t0) / 1000;
          const g = ctx.createLinearGradient(0, 0, 640, 360);
          g.addColorStop(0, "#1e3a8a"); g.addColorStop(1, "#7e22ce");
          ctx.fillStyle = g; ctx.fillRect(0, 0, 640, 360);
          ctx.fillStyle = "#22d3ee";
          ctx.beginPath(); ctx.arc(320 + Math.cos(t * 2) * 180, 180 + Math.sin(t * 2) * 90, 40, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#fff"; ctx.font = "bold 36px Arial"; ctx.fillText(`Nexosphere ${t.toFixed(1)}s`, 180, 60);
          if (t < 2.5) requestAnimationFrame(draw); else resolve();
        };
        draw();
      });
      rec.stop();
      await done;
      const blob = new Blob(chunks, { type: "video/webm" });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    });
    writeFileSync(files.video, Buffer.from(b64, "base64"));
    await browser.close();
  }
  return files;
}
