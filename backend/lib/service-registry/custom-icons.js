'use strict';

const crypto = require('node:crypto');

const MAX_BYTES = 128 * 1024;
const MAX_BLOBS = 64;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/x-icon']);
const HASH = /^[a-f0-9]{64}$/;
const GLYPHS = Object.freeze([
  'terminal', 'editor', 'container', 'server', 'globe', 'database',
  'code', 'monitor', 'network', 'shield', 'settings', 'hard-drive',
]);

function badImage() {
  throw new TypeError('Invalid or unsupported raster image');
}
function dimensions(w, h) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 ||
      w > 4096 || h > 4096 || w * h > 4096 * 4096) badImage();
}

// CRC verification also rejects truncated/chunk-spliced PNG files.
function crc32(buffer, start, end) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validPng(bytes) {
  if (bytes.length < 45 ||
      !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) badImage();
  let pos = 8;
  let seenIHDR = false;
  let seenData = false;
  let ended = false;
  while (pos + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(pos);
    if (size > MAX_BYTES || pos + 12 + size > bytes.length) badImage();
    const type = bytes.toString('ascii', pos + 4, pos + 8);
    if (!/^[A-Za-z]{4}$/.test(type) ||
        crc32(bytes, pos + 4, pos + 8 + size) !== bytes.readUInt32BE(pos + 8 + size)) badImage();
    if (!seenIHDR && (type !== 'IHDR' || size !== 13)) badImage();
    if (type === 'IHDR') {
      if (seenIHDR || size !== 13) badImage();
      dimensions(bytes.readUInt32BE(pos + 8), bytes.readUInt32BE(pos + 12));
      const depth = bytes[pos + 16], color = bytes[pos + 17];
      if (![0, 2, 3, 4, 6].includes(color) ||
          ![1, 2, 4, 8, 16].includes(depth) ||
          (color === 2 || color === 4 || color === 6) && depth < 8 ||
          bytes[pos + 18] !== 0 || bytes[pos + 19] !== 0 || bytes[pos + 20] > 1) badImage();
      seenIHDR = true;
    }
    // Do not retain text/EXIF metadata from user uploads.
    if (['eXIf', 'tEXt', 'iTXt', 'zTXt'].includes(type)) badImage();
    if (type === 'IDAT') { if (!size) badImage(); seenData = true; }
    if (type === 'IEND') {
      if (size !== 0 || !seenData || pos + 12 !== bytes.length) badImage();
      ended = true;
    }
    pos += size + 12;
    if (ended) break;
  }
  if (!ended) badImage();
}

function validJpeg(bytes) {
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8) badImage();
  let pos = 2, hasFrame = false, hasScan = false, ended = false, inScan = false;
  while (pos < bytes.length) {
    if (bytes[pos++] !== 0xff) {
      if (!inScan) badImage();
      continue;
    }
    while (pos < bytes.length && bytes[pos] === 0xff) pos++;
    if (pos >= bytes.length) badImage();
    const marker = bytes[pos++];
    if (inScan && (marker === 0x00 || marker >= 0xd0 && marker <= 0xd7)) continue;
    inScan = false;
    if (marker === 0xd9) { ended = pos === bytes.length; break; }
    if (marker === 0xd8 || marker === 0x00 || marker === 0x01 ||
        marker >= 0xd0 && marker <= 0xd7) badImage();
    if (pos + 2 > bytes.length) badImage();
    const segment = bytes.readUInt16BE(pos);
    if (segment < 2 || pos + segment > bytes.length) badImage();
    if (marker === 0xe1 && bytes.toString('ascii', pos + 2, pos + 8) === 'Exif\\0\\0') badImage();
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (segment < 8) badImage();
      dimensions(bytes.readUInt16BE(pos + 3), bytes.readUInt16BE(pos + 5));
      hasFrame = true;
    }
    if (marker === 0xda) { if (!hasFrame) badImage(); hasScan = true; inScan = true; }
    pos += segment;
  }
  if (!ended || !hasFrame || !hasScan) badImage();
}

function validWebp(bytes) {
  if (bytes.length < 24 || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 12) !== 'WEBP' ||
      bytes.readUInt32LE(4) !== bytes.length - 8) badImage();
  let pos = 12, hasImage = false;
  while (pos + 8 <= bytes.length) {
    const kind = bytes.toString('ascii', pos, pos + 4);
    const n = bytes.readUInt32LE(pos + 4);
    if (n > MAX_BYTES || pos + 8 + n + (n % 2) > bytes.length) badImage();
    const at = pos + 8;
    if (kind === 'EXIF' || kind === 'XMP ') badImage();
    if (kind === 'VP8 ') {
      if (n < 10 || bytes[at + 3] !== 0x9d || bytes[at + 4] !== 0x01 ||
          bytes[at + 5] !== 0x2a) badImage();
      dimensions(bytes.readUInt16LE(at + 6) & 0x3fff, bytes.readUInt16LE(at + 8) & 0x3fff);
      hasImage = true;
    }
    if (kind === 'VP8L') {
      if (n < 5 || bytes[at] !== 0x2f) badImage();
      const bits = bytes.readUInt32LE(at + 1);
      dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      hasImage = true;
    }
    if (kind === 'VP8X') {
      if (n !== 10) badImage();
      const w = 1 + bytes[at + 4] + (bytes[at + 5] << 8) + (bytes[at + 6] << 16);
      const h = 1 + bytes[at + 7] + (bytes[at + 8] << 8) + (bytes[at + 9] << 16);
      dimensions(w, h);
    }
    pos += 8 + n + (n % 2);
  }
  if (!hasImage || pos !== bytes.length) badImage();
}

function validIco(bytes) {
  if (bytes.length < 22 || bytes.readUInt16LE(0) !== 0 ||
      bytes.readUInt16LE(2) !== 1) badImage();
  const count = bytes.readUInt16LE(4);
  if (count < 1 || count > 8 || bytes.length < 6 + 16 * count) badImage();
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16, n = bytes.readUInt32LE(at + 8), offset = bytes.readUInt32LE(at + 12);
    if (n < 40 || offset < 6 + count * 16 || offset + n > bytes.length) badImage();
    const data = bytes.subarray(offset, offset + n);
    if (data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
      validPng(data);
    } else {
      const header = data.readUInt32LE(0);
      if (![40, 108, 124].includes(header) || data.length < header ||
          ![1, 4, 8, 24, 32].includes(data.readUInt16LE(14)) ||
          ![0, 3].includes(data.readUInt32LE(16))) badImage();
      dimensions(Math.abs(data.readInt32LE(4)), Math.abs(data.readInt32LE(8)));
    }
  }
}

function normalizeMime(type) {
  if (typeof type !== 'string') throw new TypeError('Unsupported image content type');
  const mime = type.trim().toLowerCase();
  if (mime === 'image/vnd.microsoft.icon') return 'image/x-icon';
  if (!MIME_TYPES.has(mime)) throw new TypeError('Unsupported image content type');
  return mime;
}

function validateImage(bytes, type) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) {
    throw new TypeError('Image must be at most 128 KiB');
  }
  const mime = normalizeMime(type);
  if (mime === 'image/png') validPng(bytes);
  if (mime === 'image/jpeg') validJpeg(bytes);
  if (mime === 'image/webp') validWebp(bytes);
  if (mime === 'image/x-icon') validIco(bytes);
  return mime;
}

function createCustomIconStore(db) {
  // Separate from automatically discovered icons: favicon-cache eviction
  // cannot reclaim user-owned bytes.
  db.exec('CREATE TABLE IF NOT EXISTS registry_custom_icons (' +
    'hash TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL, created_at INTEGER NOT NULL)');
  const get = db.prepare('SELECT mime, bytes FROM registry_custom_icons WHERE hash = ?');
  const stats = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(length(bytes)), 0) AS bytes ' +
    'FROM registry_custom_icons');
  const insert = db.prepare('INSERT INTO registry_custom_icons (hash, mime, bytes, created_at) VALUES (?, ?, ?, ?)');
  const save = db.transaction((bytes, type) => {
    const mime = validateImage(bytes, type);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (!get.get(hash)) {
      const used = stats.get();
      if (used.count >= MAX_BLOBS || used.bytes + bytes.length > MAX_TOTAL_BYTES) {
        const error = new Error('Custom icon storage is full');
        error.code = 'custom_icon_capacity';
        throw error;
      }
      insert.run(hash, mime, bytes, Date.now());
    }
    return { hash, mime };
  });
  return {
    save,
    get(hash) {
      return typeof hash === 'string' && HASH.test(hash) ? get.get(hash) || null : null;
    },
    stats: () => stats.get(),
  };
}

module.exports = {
  createCustomIconStore, validateImage, GLYPHS,
  MAX_BYTES, MAX_BLOBS, MAX_TOTAL_BYTES,
};
