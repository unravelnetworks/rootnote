// Finding library: reusable, text-only finding templates in their own versioned file.
// Library v2 adds optional references; v1
// files are read with the unchanged v1 rules and held as v2 in memory. Library v3 (with project schema v6)
// adds an optional CWE and vulnerability type per entry; v1 and v2 files are
// read with their own rules and held as v3. Library v4 (with project schema v7) also accepts a
// CVSS 4.0 Base vector; v1 to v3 files still accept only CVSS 3.1, are held as v4, and saves
// write v4.
// The library is held in memory and saved as a file; it never touches browser storage.
// Bounds hold after every change, not only on open.
import { LIMITS, SEVERITIES, FORMAT_KEYS, findingId, newBlockId, defaultFormats, validateReferences, cweErrors, vulnerabilityTypeErrors } from './project.js';
import { parseCvss31, parseCvss40 } from '../scoring/index.js';

export const LIBRARY_FORMAT = 'fieldnote-library';
export const LIBRARY_VERSION = 4;
export const LIBRARY_LIMITS = Object.freeze({ fileBytes: 5242880, entries: 500, name: 120, appVersion: 32 });

const ENTRY_ID = /^L-[0-9a-f]{32}$/;
const CVSS31 = /^CVSS:3\.1\/AV:[NALP]\/AC:[LH]\/PR:[NLH]\/UI:[NR]\/S:[UC]\/C:[NLH]\/I:[NLH]\/A:[NLH]$/;
const CVSS40 = /^CVSS:4\.0\/AV:[NALP]\/AC:[LH]\/AT:[NP]\/PR:[NLH]\/UI:[NPA]\/VC:[HLN]\/VI:[HLN]\/VA:[HLN]\/SC:[HLN]\/SI:[HLN]\/SA:[HLN]$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const FILE_KEYS = ['format', 'libraryVersion', 'appVersion', 'savedAt', 'entries'];
const ENTRY_KEYS_V1 = ['id', 'name', 'title', 'rating', 'cvss', 'affectedAssets', 'description', 'impact', 'threat', 'recommendation', 'formats', 'details'];
const ENTRY_KEYS_V2 = [...ENTRY_KEYS_V1, 'references'];
const ENTRY_KEYS_V3 = [...ENTRY_KEYS_V2, 'cwe', 'vulnerabilityType'];
const ENTRY_REQUIRED = ['id', 'name', 'title', 'rating', 'cvss', 'formats', 'details'];
const TEXT_KEYS = ['description', 'impact', 'threat', 'recommendation'];

/** A real instant: the ISO pattern and calendar values that exist (no 2026-99-99). */
function validTimestamp(s) {
  if (typeof s !== 'string' || !DATE_TIME.test(s)) return false;
  const [y, mo, d, hh, mm, ss] = s.slice(0, 19).split(/[-T:]/).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, hh, mm, ss));
  const off = /([+-])(\d{2}):(\d{2})$/.exec(s);
  if (off && (Number(off[2]) > 23 || Number(off[3]) > 59)) return false; // e.g. +99:99
  return Number.isFinite(Date.parse(s)) &&
    t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && t.getUTCHours() === hh && t.getUTCMinutes() === mm && t.getUTCSeconds() === ss;
}
/** At most `max` UTF-16 units (the validator's length rule), never splitting a surrogate pair. */
const capUnits = (s, max) => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
};
const plainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** A library entry name: trimmed, within 120 UTF-16 units, no split surrogate pair. */
export const capEntryName = (s) => capUnits(String(s).trim(), LIBRARY_LIMITS.name).trim();
export const newEntryId = () => `L-${crypto.randomUUID().replace(/-/g, '')}`;
export const createEmptyLibrary = () => ({ format: LIBRARY_FORMAT, libraryVersion: LIBRARY_VERSION, entries: [] });

/** The exact text the app writes for `library`. */
export function serializeLibrary(library, { appVersion, savedAt = new Date().toISOString() } = {}) {
  const out = { format: LIBRARY_FORMAT, libraryVersion: LIBRARY_VERSION };
  if (appVersion !== undefined) out.appVersion = appVersion;
  out.savedAt = savedAt;
  out.entries = library.entries;
  // Compact: indentation would make a library that opens within 5 MB save larger.
  return JSON.stringify(out) + '\n';
}
const SAVED_AT = '2000-01-01T00:00:00.000Z';
export const libraryBytes = (library, appVersion) => new TextEncoder().encode(serializeLibrary(library, { appVersion, savedAt: SAVED_AT })).length;

/** Validates library data (already parsed). Returns a list of errors, empty when valid. */
export function libraryErrors(data) {
  const errors = [];
  const err = (path, msg) => { if (errors.length < 100) errors.push(`${path}: ${msg}`); }; // capped, as in project.js
  const line = (val, path, { required = false, max = LIMITS.line, nonBlank = false } = {}) => {
    if (val === undefined) { if (required) err(path, 'missing'); return; }
    if (typeof val !== 'string') return err(path, 'must be text');
    if (val.length > max) err(path, `longer than ${max} characters`);
    if (/[\r\n]/.test(val)) err(path, 'must be a single line');
    if (nonBlank && (!/\S/.test(val) || val !== val.trim())) err(path, 'must not be empty or start/end with spaces');
    if (XML_INVALID.test(val)) err(path, 'contains characters that cannot be written to Word');
  };
  const text = (val, path) => {
    if (val === undefined) return 0;
    if (typeof val !== 'string') { err(path, 'must be text'); return 0; }
    if (val.length > LIMITS.text) err(path, `longer than ${LIMITS.text} characters`);
    if (XML_INVALID.test(val)) err(path, 'contains characters that cannot be written to Word');
    return val.length;
  };
  if (!plainObject(data)) return ['file: not a library file'];
  for (const k of Object.keys(data)) if (!FILE_KEYS.includes(k)) err('file', `unknown field "${k}"`);
  if (data.format !== LIBRARY_FORMAT) return ['file: not a finding library (missing format marker)'];
  if (![1, 2, 3, 4].includes(data.libraryVersion)) return [Number.isInteger(data.libraryVersion) && data.libraryVersion > LIBRARY_VERSION
    ? `file: saved by a newer version (library ${data.libraryVersion}); this build reads library ${LIBRARY_VERSION}` : 'file: unsupported libraryVersion'];
  const entryKeys = data.libraryVersion === 1 ? ENTRY_KEYS_V1 : data.libraryVersion === 2 ? ENTRY_KEYS_V2 : ENTRY_KEYS_V3; // v4 entries have the v3 fields
  if (own(data, 'appVersion') && (typeof data.appVersion !== 'string' || data.appVersion.length > LIBRARY_LIMITS.appVersion || XML_INVALID.test(data.appVersion))) err('appVersion', 'invalid');
  if (own(data, 'savedAt') && !validTimestamp(data.savedAt)) err('savedAt', 'must be a valid ISO date-time');
  if (!Array.isArray(data.entries)) { err('entries', 'must be a list'); return errors; }
  if (data.entries.length > LIBRARY_LIMITS.entries) { err('entries', `more than ${LIBRARY_LIMITS.entries}`); return errors; }
  const ids = new Set();
  data.entries.forEach((e, i) => {
    const path = `entries[${i}]`;
    if (!plainObject(e)) return err(path, 'must be an object');
    for (const k of Object.keys(e)) if (!entryKeys.includes(k)) err(path, `unknown field "${k}"`);
    if (e.references !== undefined && entryKeys !== ENTRY_KEYS_V1) validateReferences(e.references, `${path}.references`, err);
    if (entryKeys === ENTRY_KEYS_V3) {
      if (own(e, 'cwe')) for (const m of cweErrors(e.cwe)) err(`${path}.cwe`, m);
      if (own(e, 'vulnerabilityType')) for (const m of vulnerabilityTypeErrors(e.vulnerabilityType)) err(`${path}.vulnerabilityType`, m);
    }
    for (const k of ENTRY_REQUIRED) if (!own(e, k)) err(`${path}.${k}`, 'missing');
    if (typeof e.id !== 'string' || !ENTRY_ID.test(e.id)) err(`${path}.id`, 'must look like L- and 32 hex digits');
    else if (ids.has(e.id)) err(`${path}.id`, `duplicate ${e.id}`);
    else ids.add(e.id);
    line(e.name, `${path}.name`, { required: true, max: LIBRARY_LIMITS.name, nonBlank: true });
    line(e.title, `${path}.title`, { required: true });
    if (own(e, 'rating') && !(e.rating === null || SEVERITIES.includes(e.rating))) err(`${path}.rating`, 'invalid rating');
    // Library v1-v3 accept only CVSS 3.1; v4 also a canonical CVSS 4.0 Base vector.
    const cvss40 = data.libraryVersion >= 4 && typeof e.cvss === 'string' && CVSS40.test(e.cvss) && parseCvss40(e.cvss).vector === e.cvss;
    if (own(e, 'cvss') && !(e.cvss === null || cvss40 || (typeof e.cvss === 'string' && CVSS31.test(e.cvss) && parseCvss31(e.cvss).vector === e.cvss))) {
      err(`${path}.cvss`, data.libraryVersion >= 4 ? 'must be a canonical CVSS 3.1 or 4.0 Base vector or null' : 'must be a canonical CVSS 3.1 Base vector or null');
    }
    if (own(e, 'affectedAssets')) {
      if (!Array.isArray(e.affectedAssets) || e.affectedAssets.length > LIMITS.assets) err(`${path}.affectedAssets`, `must be a list of at most ${LIMITS.assets}`);
      else e.affectedAssets.forEach((a, j) => line(a, `${path}.affectedAssets[${j}]`, { required: true }));
    }
    for (const k of TEXT_KEYS) text(e[k], `${path}.${k}`);
    if (own(e, 'formats')) {
      if (!plainObject(e.formats)) err(`${path}.formats`, 'must be an object');
      else {
        for (const k of Object.keys(e.formats)) if (!FORMAT_KEYS.includes(k)) err(`${path}.formats`, `unknown field "${k}"`);
        for (const k of FORMAT_KEYS) if (e.formats[k] !== 'plain' && e.formats[k] !== 'code') err(`${path}.formats.${k}`, 'must be plain or code');
      }
    }
    if (own(e, 'details')) {
      if (!Array.isArray(e.details) || e.details.length > LIMITS.detailBlocks) err(`${path}.details`, `must be a list of at most ${LIMITS.detailBlocks} text blocks`);
      else {
        let total = 0;
        e.details.forEach((b, j) => {
          const at = `${path}.details[${j}]`;
          if (!plainObject(b)) return err(at, 'must be an object');
          for (const k of Object.keys(b)) if (!['type', 'text', 'format'].includes(k)) err(at, `unknown field "${k}"`);
          if (b.type !== 'text') err(`${at}.type`, 'must be text (library entries hold no screenshots)');
          if (typeof b.text !== 'string') err(`${at}.text`, 'must be text');
          else { total += b.text.length; if (XML_INVALID.test(b.text)) err(`${at}.text`, 'contains characters that cannot be written to Word'); }
          if (b.format !== 'plain' && b.format !== 'code') err(`${at}.format`, 'must be plain or code');
        });
        if (total > LIMITS.text) err(`${path}.details`, `text blocks total ${total} characters; the limit is ${LIMITS.text}`);
      }
    }
  });
  return errors;
}

/** Parses and validates a library file. `rawBytes` is its UTF-8 size. */
export function openLibraryFile(raw, rawBytes) {
  if (rawBytes > LIBRARY_LIMITS.fileBytes) return { ok: false, errors: [`File is ${rawBytes} bytes; the library limit is ${LIBRARY_LIMITS.fileBytes} (5 MB).`] };
  let data;
  try { data = JSON.parse(raw); } catch { return { ok: false, errors: ['File is not valid JSON.'] }; }
  const errors = libraryErrors(data);
  if (errors.length) return { ok: false, errors };
  // A v1 or v2 file is held as v3 with its entries untouched (they have no classification);
  // openedVersion lets the app say once that saving writes the newer format.
  return { ok: true, library: { format: LIBRARY_FORMAT, libraryVersion: LIBRARY_VERSION, entries: data.entries }, openedVersion: data.libraryVersion };
}

/** Checks a library the app is about to keep (after merge, save or edit): every rule plus
 * the 5 MB written size. Returns errors; empty means it may replace the current one. */
export function checkLibrary(library, appVersion) {
  // The candidate itself first (root fields, format and version included), then the file
  // exactly as it would be written (metadata and size).
  const errors = libraryErrors(library);
  if (errors.length) return errors;
  errors.push(...libraryErrors(JSON.parse(serializeLibrary(library, { appVersion, savedAt: SAVED_AT }))));
  const bytes = libraryBytes(library, appVersion);
  if (bytes > LIBRARY_LIMITS.fileBytes) errors.push(`The library would be ${bytes} bytes; the limit is ${LIBRARY_LIMITS.fileBytes} (5 MB).`);
  return errors;
}

/** A library entry from a project finding: everything except its id and screenshots.
 * Text is copied as typed; nothing is sanitized or anonymised. */
export function entryFromFinding(finding, { id = newEntryId(), name } = {}) {
  const blocks = Array.isArray(finding.details) ? finding.details : [];
  const entry = {
    id, name: capUnits((name ?? finding.title ?? '').trim(), LIBRARY_LIMITS.name).trim() || 'Untitled finding',
    title: finding.title ?? '', rating: finding.rating ?? null, cvss: finding.cvss ?? null,
  };
  if (finding.affectedAssets !== undefined) entry.affectedAssets = [...finding.affectedAssets];
  for (const k of TEXT_KEYS) if (finding[k] !== undefined) entry[k] = finding[k];
  entry.formats = { ...defaultFormats(), ...finding.formats };
  entry.details = blocks.filter((b) => b.type === 'text').map((b) => ({ type: 'text', text: b.text, format: b.format }));
  // References come along; workflow status never does (it belongs to one report).
  if (finding.references?.length) entry.references = finding.references.map((r) => ({ title: r.title, url: r.url }));
  // Classification is the tester's wording for the kind of issue, not about the client: kept.
  if (finding.cwe) entry.cwe = finding.cwe;
  if (finding.vulnerabilityType) entry.vulnerabilityType = finding.vulnerabilityType;
  return { entry, droppedScreenshots: blocks.filter((b) => b.type === 'image').length + (finding.evidence?.length ?? 0) };
}

/** A new project finding from an entry, with the given F-number and fresh block ids. It
 * starts as Open, like any new finding. */
export function findingFromEntry(entry, number) {
  const f = { id: findingId(number), title: entry.title, rating: entry.rating, cvss: entry.cvss, affectedAssets: [...(entry.affectedAssets ?? [])] };
  for (const k of TEXT_KEYS) f[k] = entry[k] ?? '';
  f.details = entry.details.map((b) => ({ id: newBlockId(), type: 'text', text: b.text, format: b.format }));
  f.formats = { ...entry.formats };
  f.evidence = [];
  f.status = 'open';
  f.cwe = entry.cwe ?? '';
  f.vulnerabilityType = entry.vulnerabilityType ?? '';
  if (entry.references?.length) f.references = entry.references.map((r) => ({ title: r.title, url: r.url }));
  return f;
}

/** Union of `current` and `incoming`: entries with new ids are appended in order;
 * entries whose id already exists are skipped. The caller checks the result. */
export function mergeLibraries(current, incoming) {
  const have = new Set(current.entries.map((e) => e.id));
  const added = incoming.entries.filter((e) => !have.has(e.id));
  return { library: { ...current, entries: [...current.entries, ...added] }, added: added.length, skipped: incoming.entries.length - added.length };
}
