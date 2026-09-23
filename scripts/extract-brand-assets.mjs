// Derives web-ready, transparent brand assets from the official NEXOSPHERE logo files in /brand.
// The artwork itself is never redrawn: the sphere is cut out with a circular alpha mask and the
// wordmark's alpha is taken from its own luminance (official white-on-dark variant).
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const OUT = "public/brand";
mkdirSync(OUT, { recursive: true });

async function raw(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { data, ...info };
}

// 1. Symbol — logo-1 is the sphere on pure black, so anti-aliased edges blend cleanly on dark UI.
{
  const img = await raw("brand/nexosphere-logo-1.jpeg");
  let minX = 1e9, maxX = 0, minY = 1e9, maxY = 0;
  for (let y = 0; y < 620; y++)
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 3;
      if (Math.max(img.data[i], img.data[i + 1], img.data[i + 2]) > 40) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  // The sphere is a true circle; its width is the reliable diameter (a faint reflection sits below it).
  const r = (maxX - minX + 1) / 2 - 1.5;
  const cx = (minX + maxX + 1) / 2, cy = minY + (maxX - minX + 1) / 2;
  const size = Math.ceil(r * 2) + 2;
  const left = Math.round(cx - size / 2), top = Math.round(cy - size / 2);
  console.log("sphere bounds", { minX, maxX, minY, maxY, size });
  const crop = await sharp("brand/nexosphere-logo-1.jpeg")
    .extract({ left, top, width: size, height: size }).raw().toBuffer();
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2);
      const a = Math.max(0, Math.min(1, r - d + 0.5)); // 1px anti-aliased edge
      const s = (y * size + x) * 3, t = (y * size + x) * 4;
      rgba[t] = crop[s]; rgba[t + 1] = crop[s + 1]; rgba[t + 2] = crop[s + 2];
      rgba[t + 3] = Math.round(a * 255);
    }
  const base = sharp(rgba, { raw: { width: size, height: size, channels: 4 } });
  await base.clone().png().toFile(`${OUT}/nexosphere-symbol.png`);
  await base.clone().resize(192).png().toFile(`${OUT}/nexosphere-symbol-192.png`);
  await base.clone().resize(96).png().toFile(`${OUT}/nexosphere-symbol-96.png`);
  // App icons sit on the brand's black ground (matches logo-1).
  for (const [name, px] of [["icon.png", 512], ["apple-icon.png", 180]]) {
    const inner = await base.clone().resize(Math.round(px * 0.82)).png().toBuffer();
    await sharp({ create: { width: px, height: px, channels: 4, background: "#000000" } })
      .composite([{ input: inner, gravity: "center" }]).png().toFile(`src/app/${name}`);
  }
}

// 2. Wordmark — logo-4 carries the largest wordmark (black on #f7f7f7). Alpha is derived from
// its darkness, and the fill is set to the official white used in logo-1 / logo-6.
{
  const file = "brand/nexosphere-logo-4.jpeg";
  const img = await raw(file);
  let minX = 1e9, maxX = 0, minY = 1e9, maxY = 0;
  for (let y = 1100; y < 1230; y++)
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 3;
      if (img.data[i] < 150) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  const pad = 4;
  const left = minX - pad, top = minY - pad, width = maxX - minX + pad * 2, height = maxY - minY + pad * 2;
  console.log("wordmark bounds", { left, top, width, height });
  const crop = await sharp(file).extract({ left, top, width, height }).greyscale().raw().toBuffer();
  const rgba = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const a = Math.max(0, Math.min(255, Math.round(((240 - crop[p]) / 220) * 255)));
    rgba[p * 4] = 255; rgba[p * 4 + 1] = 255; rgba[p * 4 + 2] = 255; rgba[p * 4 + 3] = a;
  }
  await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toFile(`${OUT}/nexosphere-wordmark.png`);
}
console.log("done");
