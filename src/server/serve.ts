import "server-only";
import { Readable } from "node:stream";
import { storage } from "./storage";
import { fail } from "./http";

/** Streams a stored object with HTTP Range support (needed for video seeking). */
export async function serveObject(
  req: Request,
  key: string,
  opts: { contentType: string; etag: string; download?: string; immutable?: boolean },
) {
  const size = await storage().size(key);
  if (size == null) return fail(404, "The file for this item is missing from storage.");
  const headers = new Headers({
    "Content-Type": opts.contentType,
    "Accept-Ranges": "bytes",
    ETag: `"${opts.etag}"`,
    "Cache-Control": opts.immutable ? "private, max-age=31536000, immutable" : "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
  });
  if (opts.download) {
    const ascii = opts.download.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    headers.set("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(opts.download)}`);
  }
  if (req.headers.get("if-none-match") === `"${opts.etag}"`) return new Response(null, { status: 304, headers });

  const range = req.headers.get("range");
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m && size > 0) {
    let start = m[1] ? Number(m[1]) : NaN;
    let end = m[2] ? Number(m[2]) : NaN;
    if (Number.isNaN(start)) { start = Math.max(0, size - end); end = size - 1; }
    else if (Number.isNaN(end) || end >= size) end = size - 1;
    if (start > end || start >= size) {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    const stream = await storage().read(key, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  const stream = await storage().read(key);
  return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers });
}
