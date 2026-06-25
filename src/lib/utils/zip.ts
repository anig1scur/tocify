export type ZipFileEntry = {
  name: string;
  data: Uint8Array | ArrayBuffer;
};

const textEncoder = new TextEncoder();
let crcTable: Uint32Array | null = null;

function getCrcTable() {
  if (crcTable) return crcTable;

  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32(data: Uint8Array) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return {dosDate, dosTime};
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function createHeader(size: number) {
  return new Uint8Array(size);
}

function normalizeData(data: Uint8Array | ArrayBuffer) {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function assertZip32Size(value: number, label: string) {
  if (value > 0xffffffff) {
    throw new Error(`${label} is too large for ZIP32.`);
  }
}

export function getUniqueZipFilename(filename: string, usedNames: Set<string>) {
  const cleanFilename = filename.replace(/^\/+/, '').replace(/\/+/g, '/').trim() || 'chapter.pdf';
  const extensionIndex = cleanFilename.lastIndexOf('.');
  const base = extensionIndex > 0 ? cleanFilename.slice(0, extensionIndex) : cleanFilename;
  const extension = extensionIndex > 0 ? cleanFilename.slice(extensionIndex) : '';

  let candidate = cleanFilename;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base}-${suffix}${extension}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

export function createZipBlob(entries: ZipFileEntry[]) {
  if (entries.length > 0xffff) {
    throw new Error('Too many files for ZIP32.');
  }

  const chunks: BlobPart[] = [];
  const centralDirectoryChunks: Uint8Array[] = [];
  const {dosDate, dosTime} = toDosDateTime();
  let offset = 0;

  for (const entry of entries) {
    const data = normalizeData(entry.data);
    const filenameBytes = textEncoder.encode(entry.name);
    const checksum = crc32(data);
    const localHeader = createHeader(30 + filenameBytes.length);
    const localView = new DataView(localHeader.buffer);

    assertZip32Size(offset, 'ZIP offset');
    assertZip32Size(data.byteLength, entry.name);
    if (filenameBytes.length > 0xffff) {
      throw new Error(`Filename is too long for ZIP32: ${entry.name}`);
    }

    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0x0800);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, dosTime);
    writeUint16(localView, 12, dosDate);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, data.byteLength);
    writeUint32(localView, 22, data.byteLength);
    writeUint16(localView, 26, filenameBytes.length);
    writeUint16(localView, 28, 0);
    localHeader.set(filenameBytes, 30);

    chunks.push(localHeader, data);

    const centralHeader = createHeader(46 + filenameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0x0800);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, dosTime);
    writeUint16(centralView, 14, dosDate);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, data.byteLength);
    writeUint32(centralView, 24, data.byteLength);
    writeUint16(centralView, 28, filenameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, offset);
    centralHeader.set(filenameBytes, 46);
    centralDirectoryChunks.push(centralHeader);

    offset += localHeader.byteLength + data.byteLength;
  }

  const centralDirectoryOffset = offset;
  let centralDirectorySize = 0;
  for (const centralDirectoryChunk of centralDirectoryChunks) {
    chunks.push(centralDirectoryChunk);
    centralDirectorySize += centralDirectoryChunk.byteLength;
    offset += centralDirectoryChunk.byteLength;
  }

  assertZip32Size(centralDirectoryOffset, 'ZIP central directory offset');
  assertZip32Size(centralDirectorySize, 'ZIP central directory');

  const endHeader = createHeader(22);
  const endView = new DataView(endHeader.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralDirectorySize);
  writeUint32(endView, 16, centralDirectoryOffset);
  writeUint16(endView, 20, 0);
  chunks.push(endHeader);

  return new Blob(chunks, {type: 'application/zip'});
}
