const UTF8_FLAG = 0x0800;
const FIXED_DOS_DATE = 0x0021;

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(content) {
  let value = 0xffffffff;
  for (const byte of content) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function validateEntryName(name, seen) {
  const segments = typeof name === "string" ? name.split("/") : [];
  const unsafe =
    typeof name !== "string" ||
    name.length === 0 ||
    name.includes("\0") ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name) ||
    name.normalize("NFC") !== name ||
    Buffer.byteLength(name, "utf8") > 0xffff ||
    segments.some((segment) =>
      segment === "" ||
      segment === "." ||
      segment === ".." ||
      segment.endsWith(".") ||
      segment.endsWith(" "),
    );
  if (unsafe) throw new Error(`Unsafe ZIP entry path: ${String(name)}`);
  if (seen.has(name)) throw new Error(`Duplicate ZIP entry path: ${name}`);
  seen.add(name);
}

function localHeader(name, content, checksum) {
  const nameBytes = Buffer.from(name, "utf8");
  const header = Buffer.alloc(30 + nameBytes.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(FIXED_DOS_DATE, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(content.length, 18);
  header.writeUInt32LE(content.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  nameBytes.copy(header, 30);
  return header;
}

function centralHeader(name, content, checksum, localOffset) {
  const nameBytes = Buffer.from(name, "utf8");
  const header = Buffer.alloc(46 + nameBytes.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(FIXED_DOS_DATE, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(content.length, 20);
  header.writeUInt32LE(content.length, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(localOffset, 42);
  nameBytes.copy(header, 46);
  return header;
}

export function createStoredZip(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("ZIP entries must be a non-empty array");
  }
  if (entries.length > 0xffff) {
    throw new Error("ZIP64 is not supported");
  }

  const seen = new Set();
  const normalizedEntries = entries.map((entry) => {
    validateEntryName(entry?.name, seen);
    if (!Buffer.isBuffer(entry?.content)) {
      throw new Error(`ZIP entry content must be a Buffer: ${String(entry?.name)}`);
    }
    if (entry.content.length > 0xffffffff) {
      throw new Error(`ZIP64 is not supported for entry: ${entry.name}`);
    }
    return entry;
  });

  const localChunks = [];
  const centralChunks = [];
  let localOffset = 0;
  for (const { name, content } of normalizedEntries) {
    const checksum = crc32(content);
    const header = localHeader(name, content, checksum);
    localChunks.push(header, content);
    centralChunks.push(centralHeader(name, content, checksum, localOffset));
    localOffset += header.length + content.length;
  }
  if (localOffset > 0xffffffff) throw new Error("ZIP64 is not supported");

  const centralDirectory = Buffer.concat(centralChunks);
  if (centralDirectory.length > 0xffffffff) throw new Error("ZIP64 is not supported");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(normalizedEntries.length, 8);
  end.writeUInt16LE(normalizedEntries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localChunks, centralDirectory, end]);
}