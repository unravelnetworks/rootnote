// A project as the exact bytes JSON.stringify(project) gives, without building one giant
// string: the text around the screenshots is serialized normally and each screenshot's data
// URL is kept as its own part, already in its JSON form. Taking the parts is cheap and
// synchronous (the strings are immutable, so the parts are a snapshot); turning them into a
// Blob is done in small steps so a large project does not hold the page.

// A data URL written by this app's validator: no character JSON would escape.
const PLAIN_DATA_URL = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]*={0,2}$/;
const utf8 = new TextEncoder();

/** Own enumerable keys whose values JSON.stringify writes (it skips undefined, functions, symbols). */
const written = (o) => Object.keys(o).filter((k) => { const t = typeof o[k]; return t !== 'undefined' && t !== 'function' && t !== 'symbol'; });
const plainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype && typeof v.toJSON !== 'function';

/**
 * Splits `project` (a plain object with an `images` array of plain objects) into string parts
 * whose concatenation equals JSON.stringify(project), with each plain data URL as one part.
 * Returns { parts, bytes } where bytes is the exact UTF-8 length, or null when the project
 * is not in that shape (the caller then serializes it whole).
 */
export function projectParts(project) {
  if (!plainObject(project) || !Array.isArray(project.images) || !project.images.every(plainObject)) return null;
  const parts = [];
  let text = '';
  let bytes = 0;
  const flush = () => { if (text) { parts.push(text); bytes += utf8.encode(text).length; text = ''; } };
  text += '{';
  written(project).forEach((key, i) => {
    text += `${i ? ',' : ''}${JSON.stringify(key)}:`;
    if (key !== 'images') { text += JSON.stringify(project[key]); return; }
    text += '[';
    project.images.forEach((im, j) => {
      text += j ? ',{' : '{';
      written(im).forEach((k, n) => {
        text += `${n ? ',' : ''}${JSON.stringify(k)}:`;
        const v = im[k];
        if (k === 'dataUrl' && typeof v === 'string' && PLAIN_DATA_URL.test(v)) {
          text += '"';
          flush();
          parts.push(v);
          bytes += v.length; // ASCII
          text += '"';
        } else {
          text += JSON.stringify(v);
        }
      });
      text += '}';
    });
    text += ']';
  });
  text += '}';
  flush();
  return { parts, bytes };
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Builds a Blob from string parts, a few megabytes per step with a pause between steps, then
 * joins the pieces (joining Blobs copies nothing). `isCurrent()` is checked after each pause;
 * when it returns false the build stops and resolves null.
 */
export async function partsToBlob(parts, { type = 'application/json', step = 4 * 1048576, isCurrent = () => true } = {}) {
  const pieces = [];
  let group = [];
  let size = 0;
  for (const p of parts) {
    group.push(p);
    size += p.length;
    if (size >= step) {
      pieces.push(new Blob(group));
      group = [];
      size = 0;
      await pause();
      if (!isCurrent()) return null;
    }
  }
  if (group.length) pieces.push(new Blob(group));
  return new Blob(pieces, { type });
}
