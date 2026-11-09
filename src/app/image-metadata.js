// Removes hidden metadata from a PNG or JPEG without re-encoding it. Screenshots were once stored and exported byte for
// byte, so camera, location, software and text notes inside a file reached the project file
// and the Word report. The image data is copied unchanged. What is kept is a whitelist of the
// structures the picture needs; everything else goes, wherever it sits in the file.
//
// Kept: the image data and its tables; a colour profile (PNG iCCP, JPEG ICC_PROFILE) so
// colours look the same; a standard JFIF or Adobe header, rebuilt to its fixed fields (no
// thumbnail); and the orientation, as a new EXIF block holding only that one value, so a
// photo flipped or turned 180° by its camera tag still looks the way it did.
// Input must already have passed sniffImage. A file this cannot fully walk gives null: the
// caller refuses it rather than keep data it could not check.

const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'pHYs']);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const ICC = ascii('ICC_PROFILE\0');
const EXIF = ascii('Exif\0\0');
const JFIF = ascii('JFIF\0');
const ADOBE = ascii('Adobe');
const startsWith = (bytes, at, prefix) => at + prefix.length <= bytes.length && prefix.every((b, k) => bytes[at + k] === b);

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The EXIF orientation (1–8) in a TIFF block, or null when there is none or it is unreadable. */
function tiffOrientation(t) {
  if (t.length < 8) return null;
  const le = t[0] === 0x49 && t[1] === 0x49;
  if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return null;
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  if (dv.getUint16(2, le) !== 42) return null;
  const ifd = dv.getUint32(4, le);
  if (ifd + 2 > t.length) return null;
  const count = dv.getUint16(ifd, le);
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > t.length) return null;
    if (dv.getUint16(e, le) === 0x0112 && dv.getUint16(e + 2, le) === 3 && dv.getUint32(e + 4, le) === 1) {
      const o = dv.getUint16(e + 8, le);
      return o >= 1 && o <= 8 ? o : null;
    }
  }
  return null;
}
/** A TIFF block holding only an orientation tag (big-endian, one IFD entry). */
function orientationTiff(o) {
  return new Uint8Array([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0]);
}

function pngChunk(type, data) {
  const chunk = new Uint8Array(12 + data.length);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, data.length);
  chunk.set(ascii(type), 4);
  chunk.set(data, 8);
  cv.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

function walkPng(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts = [bytes.subarray(0, 8)];
  let orientation = null;
  let i = 8;
  while (i + 12 <= bytes.length) {
    const len = dv.getUint32(i);
    const end = i + 12 + len;
    if (end > bytes.length) return null;
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    if (type === 'iCCP') {
      // The profile name is free text (often a device name); a fixed name replaces it.
      const data = bytes.subarray(i + 8, i + 8 + len);
      const nul = data.indexOf(0);
      if (nul < 1 || nul > 79) return null;
      parts.push(pngChunk('iCCP', new Uint8Array([...ascii('ICC Profile\0'), ...data.subarray(nul + 1)])));
    } else if (PNG_KEEP.has(type)) parts.push(bytes.subarray(i, end));
    else if (type === 'eXIf' && orientation === null) {
      orientation = tiffOrientation(bytes.subarray(i + 8, i + 8 + len));
      if (orientation && orientation !== 1) parts.push(pngChunk('eXIf', orientationTiff(orientation)));
    }
    i = end;
    if (type === 'IEND') return { parts, orientation };
  }
  return null;
}

// JPEG markers kept: frames, Huffman and quantisation tables, arithmetic conditioning,
// restart interval, line count, hierarchical progression, expand reference, and scans.
// Reserved markers (0x02–0xBF, JPG 0xC8, JPGn 0xF0–0xFD) are dropped like APPn and comments.
const JPEG_TABLES = new Set([0xc4, 0xcc, 0xdb, 0xdc, 0xdd, 0xde, 0xdf]);
const isFrame = (m) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

function walkJpeg(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts = [bytes.subarray(0, 2)];
  let orientation = null;
  let jfif = false;
  let adobe = false;
  let i = 2;
  // Every segment is walked, including those between the scans of a progressive image, up to
  // the first real end-of-image marker. Inside image data 0xFF is always followed
  // by 0x00 or a restart marker, so the first other marker after a scan is a real one.
  // Whatever follows the end (an appended file, even one ending like a JPEG) goes.
  while (i + 2 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd9) { parts.push(bytes.subarray(i, i + 2)); return { parts, orientation }; }
    if (marker >= 0xd0 && marker <= 0xd7) { parts.push(bytes.subarray(i, i + 2)); i += 2; continue; }
    if (marker === 0xd8 || marker === 0x01 || i + 4 > bytes.length) return null;
    const len = dv.getUint16(i + 2);
    const end = i + 2 + len;
    if (len < 2 || end > bytes.length) return null;
    const at = i + 4; // payload
    if (marker === 0xda) {
      let j = end;
      while (j + 1 < bytes.length && !(bytes[j] === 0xff && bytes[j + 1] !== 0x00 && bytes[j + 1] !== 0xff && !(bytes[j + 1] >= 0xd0 && bytes[j + 1] <= 0xd7))) j++;
      if (j + 1 >= bytes.length) return null;
      parts.push(bytes.subarray(i, j));
      i = j;
      continue;
    }
    if (isFrame(marker) || JPEG_TABLES.has(marker)) parts.push(bytes.subarray(i, end));
    else if (marker === 0xe0 && !jfif && len >= 16 && startsWith(bytes, at, JFIF)) {
      // JFIF: version, density units, X and Y density; thumbnail size 0×0 and no thumbnail.
      jfif = true;
      parts.push(new Uint8Array([0xff, 0xe0, 0, 16, ...JFIF, ...bytes.subarray(at + 5, at + 12), 0, 0]));
    } else if (marker === 0xee && !adobe && len >= 14 && startsWith(bytes, at, ADOBE)) {
      // Adobe: version, two flag words and the colour transform, which decoders need.
      adobe = true;
      parts.push(new Uint8Array([0xff, 0xee, 0, 14, ...bytes.subarray(at, at + 12)]));
    } else if (marker === 0xe2 && startsWith(bytes, at, ICC)) parts.push(bytes.subarray(i, end));
    else if (marker === 0xe1 && orientation === null && startsWith(bytes, at, EXIF)) {
      orientation = tiffOrientation(bytes.subarray(at + 6, end));
      if (orientation && orientation !== 1) {
        const tiff = orientationTiff(orientation);
        const seg = new Uint8Array(4 + EXIF.length + tiff.length);
        seg.set([0xff, 0xe1, 0, 2 + EXIF.length + tiff.length]);
        seg.set(EXIF, 4);
        seg.set(tiff, 4 + EXIF.length);
        parts.push(seg);
      }
    }
    i = end;
  }
  return null;
}

function walk(bytes, mime) {
  if (mime === 'image/png') return walkPng(bytes);
  if (mime === 'image/jpeg') return walkJpeg(bytes);
  return null;
}

/**
 * The same image without hidden metadata: the input itself when nothing was removed, a new
 * array when something was, or null when the file could not be fully walked (refuse it).
 */
export function stripImageMetadata(bytes, mime) {
  const result = walk(bytes, mime);
  if (!result) return null;
  const length = result.parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of result.parts) { out.set(p, at); at += p.length; }
  if (length === bytes.length && out.every((v, k) => v === bytes[k])) return bytes;
  return out;
}

/** The EXIF orientation the browser applies when it shows the image (1–8), or 1 when none. */
export function imageOrientation(bytes, mime) {
  return walk(bytes, mime)?.orientation ?? 1;
}
