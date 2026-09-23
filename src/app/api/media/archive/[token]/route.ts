import { handle, requireAccess } from "@/server/http";
import { takeArchive } from "@/server/archive";
import { storage } from "@/server/storage";
import { zipSize, zipStream } from "@/server/zip";

export const runtime = "nodejs";
export const maxDuration = 3600;

/** Step 2 of a bulk download: stream the prepared zip. Still requires a workspace session. */
export const GET = handle<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  await requireAccess(req);
  const prepared = takeArchive((await params).token);
  const entries = prepared.entries.map((e) => ({
    name: e.name, size: e.size, mtime: new Date(e.mtime), open: () => storage().read(e.key),
  }));
  const gen = zipStream(entries);
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) controller.close();
        else controller.enqueue(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      } catch (e) {
        console.error("[archive]", e);
        controller.error(e);
      }
    },
    async cancel() { await gen.return(undefined); },
  });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zipSize(entries)),
      "Content-Disposition": `attachment; filename="nexosphere-media-${date}.zip"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
