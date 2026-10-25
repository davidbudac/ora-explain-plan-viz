/**
 * Minimal ZIP writer: stored (uncompressed) entries with UTF-8 names. Enough
 * to package a few small text files in the browser (the agent-skill download)
 * without pulling in a compression library.
 */

export interface ZipEntry {
  /** Path inside the archive, `/`-separated; parent folders need no entries of their own. */
  path: string;
  content: string;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3), as ZIP headers store it. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS time and date words (2-second resolution, years from 1980). */
function dosDateTime(when: Date): { time: number; date: number } {
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2),
    date: (Math.max(0, when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const END_RECORD = 22;
const VERSION = 20;
const UTF8_NAMES = 0x0800;

export function buildZip(entries: ZipEntry[], modified: Date = new Date()): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(modified);
  const files = entries.map((entry) => {
    const name = encoder.encode(entry.path);
    const data = encoder.encode(entry.content);
    return { name, data, crc: crc32(data) };
  });

  const localBytes = files.reduce((sum, f) => sum + LOCAL_HEADER + f.name.length + f.data.length, 0);
  const centralBytes = files.reduce((sum, f) => sum + CENTRAL_HEADER + f.name.length, 0);
  const out = new Uint8Array(new ArrayBuffer(localBytes + centralBytes + END_RECORD));
  const view = new DataView(out.buffer);

  let offset = 0;
  const localOffsets: number[] = [];
  for (const f of files) {
    localOffsets.push(offset);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, VERSION, true);
    view.setUint16(offset + 6, UTF8_NAMES, true);
    view.setUint16(offset + 8, 0, true); // method: stored
    view.setUint16(offset + 10, time, true);
    view.setUint16(offset + 12, date, true);
    view.setUint32(offset + 14, f.crc, true);
    view.setUint32(offset + 18, f.data.length, true);
    view.setUint32(offset + 22, f.data.length, true);
    view.setUint16(offset + 26, f.name.length, true);
    view.setUint16(offset + 28, 0, true); // extra field length
    out.set(f.name, offset + LOCAL_HEADER);
    out.set(f.data, offset + LOCAL_HEADER + f.name.length);
    offset += LOCAL_HEADER + f.name.length + f.data.length;
  }

  const centralStart = offset;
  files.forEach((f, i) => {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, VERSION, true); // made by
    view.setUint16(offset + 6, VERSION, true); // needed to extract
    view.setUint16(offset + 8, UTF8_NAMES, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, time, true);
    view.setUint16(offset + 14, date, true);
    view.setUint32(offset + 16, f.crc, true);
    view.setUint32(offset + 20, f.data.length, true);
    view.setUint32(offset + 24, f.data.length, true);
    view.setUint16(offset + 28, f.name.length, true);
    // Extra/comment lengths, disk number, internal/external attributes stay 0.
    view.setUint32(offset + 42, localOffsets[i], true);
    out.set(f.name, offset + CENTRAL_HEADER);
    offset += CENTRAL_HEADER + f.name.length;
  });

  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 8, files.length, true);
  view.setUint16(offset + 10, files.length, true);
  view.setUint32(offset + 12, offset - centralStart, true);
  view.setUint32(offset + 16, centralStart, true);
  return out;
}
