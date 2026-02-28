"use client";

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c;
}

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function toBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function u16(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff];
}
function u32(v: number): number[] {
  return [
    v & 0xff,
    (v >> 8) & 0xff,
    (v >> 16) & 0xff,
    (v >> 24) & 0xff,
  ];
}

export function createZip(files: Record<string, string>): Blob {
  const entries = Object.entries(files);
  const localHeaders: Uint8Array[] = [];
  const centralHeaders: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of entries) {
    const nameBytes = toBytes(name);
    const dataBytes = toBytes(content);
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    const local = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,
      0x0a, 0x00,
      0x00, 0x00,
      0x00, 0x00,
      0x00, 0x00,
      0x00, 0x00,
      ...u32(crc),
      ...u32(size),
      ...u32(size),
      ...u16(nameBytes.length),
      0x00, 0x00,
      ...nameBytes,
      ...dataBytes,
    ]);
    localHeaders.push(local);

    const central = new Uint8Array([
      0x50, 0x4b, 0x01, 0x02,
      0x14, 0x00,
      0x0a, 0x00,
      0x00, 0x00,
      0x00, 0x00,
      0x00, 0x00,
      0x00, 0x00,
      ...u32(crc),
      ...u32(size),
      ...u32(size),
      ...u16(nameBytes.length),
      0x00, 0x00,
      0x00, 0x00,
      0x00, 0x00,
      0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      ...u32(offset),
      ...nameBytes,
    ]);
    centralHeaders.push(central);

    offset += local.length;
  }

  const centralSize = centralHeaders.reduce((s, h) => s + h.length, 0);

  const eocd = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06,
    0x00, 0x00,
    0x00, 0x00,
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralSize),
    ...u32(offset),
    0x00, 0x00,
  ]);

  const parts: BlobPart[] = [
    ...localHeaders.map((h) => h as unknown as BlobPart),
    ...centralHeaders.map((h) => h as unknown as BlobPart),
    eocd as unknown as BlobPart,
  ];
  return new Blob(parts, { type: "application/zip" });
}
