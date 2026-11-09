// Single validated path for every screenshot, whether chosen, dropped or pasted.
import {
  LIMITS, sniffImage, decodeImageInBrowser, sha256Hex, bytesToBase64, sanitizeLine,
} from '../app/project.js';
import { stripImageMetadata, imageOrientation } from '../app/image-metadata.js';

/**
 * Turns raw bytes into an image record without an id, or throws an Error with a message
 * for the user. The caller assigns the id when it commits the record to the project, so
 * concurrent imports can never reserve the same id.
 * Order matters: cheap checks first, full decode last, so oversized rasters are never decoded.
 */
export async function importImageBytes(bytes, { name = '' } = {}) {
  const label = name || 'Pasted image';
  if (bytes.length === 0) throw new Error(`${label}: the file is empty.`);
  if (bytes.length > LIMITS.imageBytes) {
    throw new Error(`${label}: ${(bytes.length / 1048576).toFixed(1)} MB is over the 2 MB limit per screenshot.`);
  }
  const sniff = sniffImage(bytes);
  if (!sniff) throw new Error(`${label}: only PNG and JPEG screenshots are supported.`);
  const { width, height, mime } = sniff;
  // A quarter turn swaps width and height on screen, which the report layout cannot follow.
  if (imageOrientation(bytes, mime) >= 5) {
    throw new Error(`${label}: this image is turned a quarter turn by a camera setting, which the report cannot keep. Open it in an image editor, save a copy, and add that.`);
  }
  // Camera, location, software and text notes never enter the project. A file that cannot be fully checked is refused, not kept as is.
  const clean = stripImageMetadata(bytes, mime);
  if (!clean) throw new Error(`${label}: the file could not be checked for hidden data, so it was not added.`);
  bytes = clean;
  if (width < 1 || height < 1 || width > LIMITS.imageSide || height > LIMITS.imageSide || width * height > LIMITS.imagePixels) {
    throw new Error(`${label}: ${width}×${height} is over the 16 megapixel / 16000 px limit.`);
  }
  let decoded;
  try {
    decoded = await decodeImageInBrowser(bytes, mime);
  } catch {
    throw new Error(`${label}: the image data is damaged and cannot be read.`);
  }
  if (decoded.width !== width || decoded.height !== height) {
    throw new Error(`${label}: the image size does not match its header.`);
  }
  const record = {
    mime,
    dataUrl: `data:${mime};base64,${bytesToBase64(bytes)}`,
    width,
    height,
    bytes: bytes.length,
    sha256: await sha256Hex(bytes),
    caption: '',
    tallMode: 'auto',
  };
  const original = sanitizeLine(name).slice(0, 255);
  if (original) record.originalName = original;
  return record;
}

/** Image files from a paste or drop, ignoring text and HTML entirely. */
export function imageFilesFrom(dataTransfer) {
  if (!dataTransfer) return [];
  const files = [];
  for (const item of dataTransfer.items || []) {
    if (item.kind === 'file' && (item.type === 'image/png' || item.type === 'image/jpeg')) {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  if (!files.length) {
    for (const f of dataTransfer.files || []) if (f.type === 'image/png' || f.type === 'image/jpeg') files.push(f);
  }
  return files;
}
