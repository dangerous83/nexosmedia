import "server-only";
import { crc32 } from "node:zlib";
import type { Readable } from "node:stream";

/*
 * Minimal streaming ZIP writer ("stored" entries, no compression — media is already compressed).
 * Files are streamed one after another straight from storage; nothing is buffered beyond a chunk,
 * so memory stays flat regardless of archive size. Sizes and CRCs go in data descriptors.
 * Classic (non-ZIP64) format: callers must keep the total under 4 GB and fewer than 65,535 files.
 */

export interface ZipEntry { name: string; size: number; mtime: Date; open: () => Promise<Readable> }

const FLAGS = 0x0808; // bit 3: sizes in data descriptor · bit 11: UTF-8 names

function dosTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export async function* zipStream(entries: ZipEntry[]): AsyncGenerator<Buffer> {
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const { time, date } = dosTime(e.mtime);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(FLAGS, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    // crc / sizes left as 0 → provided by the data descriptor
    local.writeUInt16LE(name.length, 26);
    const headerOffset = offset;
    yield local; yield name;
    offset += local.length + name.length;

    let crc = 0, written = 0;
    const stream = await e.open();
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      crc = crc32(chunk, crc);
      written += chunk.length;
      yield chunk;
    }
    offset += written;
    if (written !== e.size) throw new Error(`Size changed while archiving ${e.name}`);

    const desc = Buffer.alloc(16);
    desc.writeUInt32LE(0x08074b50, 0);
    desc.writeUInt32LE(crc >>> 0, 4);
    desc.writeUInt32LE(written, 8);
    desc.writeUInt32LE(written, 12);
    yield desc;
    offset += desc.length;

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(FLAGS, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc >>> 0, 16);
    c.writeUInt32LE(written, 20);
    c.writeUInt32LE(written, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(headerOffset, 42);
    central.push(c, name);
  }
  const cd = Buffer.concat(central);
  yield cd;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  yield end;
}

/** Exact byte length of the archive, so the download can show real progress. */
export function zipSize(entries: { name: string; size: number }[]) {
  return entries.reduce((n, e) => {
    const nameLen = Buffer.byteLength(e.name, "utf8");
    return n + 30 + nameLen + e.size + 16 + 46 + nameLen;
  }, 22);
}

/** Makes names unique inside the archive: "photo.jpg", "photo (2).jpg", … */
export function uniqueNames(names: string[]) {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const key = n.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 1) return n;
    const dot = n.lastIndexOf(".");
    return dot > 0 ? `${n.slice(0, dot)} (${count})${n.slice(dot)}` : `${n} (${count})`;
  });
}
