'use strict';
// Minimal ZIP reader for the ZTM GTFS (scripts/trasy.js, lib/handler.js routesRefreshHandler), without extra packages:
// the central directory gives every file's place in the buffer, and each file is inflated as a stream, so the
// ~380 MB stop_times.txt never sits in memory whole. Handles stored and deflated files and ZIP64 sizes/offsets.

const zlib = require('zlib');
const { Readable, PassThrough } = require('stream');

const EOCD = 0x06054b50, CEN = 0x02014b50, LOC = 0x04034b50, EOCD64_LOC = 0x07064b50, EOCD64 = 0x06064b50;

// ZIP64 extended information extra field (0x0001): the 8-byte values that are 0xFFFFFFFF in the header, in order.
function zip64(extra, want) {
  for (let i = 0; i + 4 <= extra.length;) {
    const id = extra.readUInt16LE(i), len = extra.readUInt16LE(i + 2);
    if (id === 1) {
      const out = {};
      let p = i + 4;
      for (const k of want) { out[k] = Number(extra.readBigUInt64LE(p)); p += 8; }
      return out;
    }
    i += 4 + len;
  }
  return {};
}

// buf: the whole ZIP file. Returns Map name -> { size, open() -> Readable of the uncompressed bytes }.
function readZip(buf) {
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === EOCD) { e = i; break; }
  if (e < 0) throw new Error('to nie jest plik ZIP (brak katalogu centralnego)');
  let count = buf.readUInt16LE(e + 10), cdOffset = buf.readUInt32LE(e + 16);
  if ((count === 0xffff || cdOffset === 0xffffffff) && e >= 20 && buf.readUInt32LE(e - 20) === EOCD64_LOC) {
    const z = Number(buf.readBigUInt64LE(e - 12));
    if (buf.readUInt32LE(z) !== EOCD64) throw new Error('uszkodzony katalog ZIP64');
    count = Number(buf.readBigUInt64LE(z + 32)); cdOffset = Number(buf.readBigUInt64LE(z + 48));
  }
  const files = new Map();
  for (let p = cdOffset, n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CEN) throw new Error('uszkodzony katalog centralny ZIP');
    const method = buf.readUInt16LE(p + 10);
    let comp = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24), offset = buf.readUInt32LE(p + 42);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const want = [size === 0xffffffff && 'size', comp === 0xffffffff && 'comp', offset === 0xffffffff && 'offset'].filter(Boolean);
    if (want.length) ({ size = size, comp = comp, offset = offset } = zip64(buf.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen), want));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (method !== 0 && method !== 8) throw new Error(`${name}: nieobsługiwana kompresja ${method}`);
    files.set(name, {
      size,
      open() {
        if (buf.readUInt32LE(offset) !== LOC) throw new Error(`${name}: uszkodzony nagłówek pliku w ZIP`);
        const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
        const data = Readable.from([buf.subarray(start, start + comp)]);
        return data.pipe(method === 8 ? zlib.createInflateRaw() : new PassThrough());
      },
    });
  }
  return files;
}

module.exports = { readZip };
