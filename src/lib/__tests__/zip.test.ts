import { describe, expect, it } from 'vitest';
import { buildZip, crc32 } from '../zip';

interface ReadEntry {
  name: string;
  content: string;
  crc: number;
}

/** Read a stored-only ZIP back through its central directory. */
function readZip(bytes: Uint8Array): ReadEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const end = bytes.byteLength - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries: ReadEntry[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    expect(view.getUint16(offset + 10, true)).toBe(0); // stored
    const crc = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const localNameLength = view.getUint16(local + 26, true);
    const dataStart = local + 30 + localNameLength + view.getUint16(local + 28, true);
    const data = bytes.subarray(dataStart, dataStart + size);
    expect(crc32(data)).toBe(crc);
    entries.push({ name, content: decoder.decode(data), crc });
    offset += 46 + nameLength;
  }
  return entries;
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('buildZip', () => {
  it('writes entries that read back with their names, contents and CRCs', () => {
    const zip = buildZip([
      { path: 'skill/SKILL.md', content: '# Skill\n' },
      { path: 'skill/references/notes.md', content: 'Ünïcode — fine\n' },
    ], new Date(2026, 9, 25, 12, 30, 10));
    expect(readZip(zip).map(({ name, content }) => ({ name, content }))).toEqual([
      { name: 'skill/SKILL.md', content: '# Skill\n' },
      { name: 'skill/references/notes.md', content: 'Ünïcode — fine\n' },
    ]);
  });

  it('writes an empty archive as just the end record', () => {
    const zip = buildZip([]);
    expect(zip.byteLength).toBe(22);
    expect(readZip(zip)).toEqual([]);
  });
});
