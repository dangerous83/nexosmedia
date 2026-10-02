// Crop the owner's supplied artwork into compact web assets without redrawing it.
import sharp from "sharp";

for (const [name, area, width] of [
  ["symbol", { left: 680, top: 0, width: 500, height: 455 }, 384],
  ["wordmark", { left: 0, top: 540, width: 1869, height: 181 }, 1200],
]) {
  const crop = await sharp("Nexo Logo Transparent.png").extract(area).toBuffer();
  await sharp(crop).trim().resize({ width }).png().toFile(`public/brand/nexotv-${name}.png`);
}
