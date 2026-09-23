import type { MediaKind } from "@/lib/types";

export interface Sniffed { kind: MediaKind; mime: string; ext: string }
export type SniffResult = Sniffed | { unsupported: string } | null;

/**
 * Identifies a file from its leading bytes; the filename and declared type are never trusted.
 * Supported: JPEG, PNG, WebP, MP4, WebM. Recognisable-but-unsupported formats get a specific hint.
 */
export function sniff(b: Buffer): SniffResult {
  const ascii = (start: number, end: number) => b.subarray(start, end).toString("latin1");
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "image", mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: "image", mime: "image/png", ext: "png" };
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { kind: "image", mime: "image/webp", ext: "webp" };
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: "video", mime: "video/webm", ext: "webm" };
  if (b.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return { unsupported: "GIF images aren't supported. Convert the file to PNG or WebP (or MP4 for animation)." };
  if (b.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand === "qt  ") return { unsupported: "MOV (QuickTime) videos aren't supported. Export or convert the video to MP4." };
    if (["heic", "heix", "mif1", "msf1", "hevc"].includes(brand)) return { unsupported: "HEIC photos aren't supported. Export the photo as JPEG." };
    if (brand === "avif" || brand === "avis") return { unsupported: "AVIF images aren't supported. Convert the file to JPEG, PNG or WebP." };
    return { kind: "video", mime: "video/mp4", ext: "mp4" };
  }
  return null;
}
