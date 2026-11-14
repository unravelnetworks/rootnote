// Engagement folders (Engagements\Customer\Engagement\). The app
// reads one level of customer folders, one level of engagement folders inside each, and the
// project and report files directly in each engagement folder. Nothing is remembered: the
// folder is chosen again in each session (a deliberate privacy choice). Chrome and Edge give
// a folder the app may write into; other browsers read a snapshot through a folder input.

import { LIMITS } from '../app/project.js';

// A project file larger than the project limit is never read. A batch reads at most batchFiles
// files and batchBytes bytes, except that one file larger than batchBytes is read on its own.
export const ENGAGEMENT_LIMITS = { projectBytes: LIMITS.fileBytes, batchFiles: 50, batchBytes: 200 * 1024 * 1024, name: 100 };

/** What a file in an engagement folder is: 'project', 'report' (Word, PDF or Markdown), 'sheet' (CSV), or null (ignored). */
export function kindOf(name) {
  // Projects saved before the rename to Rootnote end in.fieldnote.json.
  if (/\.(rootnote|fieldnote)\.json$/i.test(name)) return 'project';
  if (/\.(docx|pdf|md)$/i.test(name)) return 'report';
  if (/\.csv$/i.test(name)) return 'sheet';
  return null;
}

const BAD = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** Why a name cannot be a folder on Windows, macOS and Linux alike, or null when it can. */
export function folderNameProblem(raw) {
  const name = String(raw ?? '');
  if (!name.trim()) return 'Enter a name.';
  if (name !== name.trim()) return 'The name cannot start or end with a space.';
  if (name.length > ENGAGEMENT_LIMITS.name) return `Use at most ${ENGAGEMENT_LIMITS.name} characters.`;
  if (BAD.test(name)) return 'The name cannot contain < > : " / \\ | ? * or control characters.';
  if (/[.]$/.test(name)) return 'The name cannot end with a full stop.';
  if (RESERVED.test(name) || name === '.' || name === '..') return 'That name is reserved by Windows.';
  return null;
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** Customers from a list of { path, size, modified, open } where path is
 * "Root/Customer/Engagement/file" (a folder input's webkitRelativePath). Deeper or shallower
 * files and unknown file types are ignored. */
export function groupPaths(items) {
  const customers = new Map();
  for (const it of items) {
    const parts = it.path.split('/');
    if (parts.length !== 4) continue;
    const [, customer, engagement, name] = parts;
    const kind = kindOf(name);
    if (!kind) continue;
    if (!customers.has(customer)) customers.set(customer, { name: customer, dir: null, engagements: new Map() });
    const c = customers.get(customer);
    if (!c.engagements.has(engagement)) c.engagements.set(engagement, { name: engagement, dir: null, files: [] });
    c.engagements.get(engagement).files.push({ name, kind, size: it.size, modified: it.modified, open: it.open, handle: null });
  }
  return [...customers.values()].map((c) => ({ ...c, engagements: [...c.engagements.values()].map((e) => ({ ...e, files: e.files.sort(byName) })).sort(byName) })).sort(byName);
}

/** The same tree from a folder handle (Chrome, Edge), keeping handles so the app can save there. */
export async function scanHandle(root) {
  const customers = [];
  for await (const c of root.values()) {
    if (c.kind !== 'directory') continue;
    const engagements = [];
    for await (const e of c.values()) {
      if (e.kind !== 'directory') continue;
      const files = [];
      for await (const f of e.values()) {
        const kind = f.kind === 'file' ? kindOf(f.name) : null;
        if (!kind) continue;
        const file = await f.getFile();
        files.push({ name: f.name, kind, size: file.size, modified: file.lastModified, open: () => f.getFile(), handle: f });
      }
      engagements.push({ name: e.name, dir: e, files: files.sort(byName) });
    }
    customers.push({ name: c.name, dir: c, engagements: engagements.sort(byName) });
  }
  return customers.sort(byName);
}

/** The tree from a folder input's files (every browser; read only). */
export function scanFileList(list) {
  return groupPaths([...list].map((f) => ({ path: f.webkitRelativePath || f.name, size: f.size, modified: f.lastModified, open: async () => f })));
}

/** What the list shows about a project file, read without the full check (that runs on Open):
 * title, client, status and finding counts by rating. Null when it is not readable JSON. */
export function projectSummary(text) {
  let d;
  try { d = JSON.parse(text); } catch { return null; }
  // typeof null is 'object', so a null project is checked for explicitly (long fuzz run, 2026-11-04).
  if (!d || typeof d !== 'object' || !d.project || typeof d.project !== 'object' || !Array.isArray(d.findings)) return null;
  const str = (v) => (typeof v === 'string' ? v.slice(0, 200) : '');
  const counts = Object.create(null); // a rating named __proto__ is just a key
  for (const f of d.findings) {
    const r = typeof f?.rating === 'string' ? f.rating : 'Unscored';
    counts[r] = (counts[r] ?? 0) + 1;
  }
  return {
    title: str(d.project.title), client: str(d.project.client), status: str(d.project.engagementStatus),
    findings: d.findings.length, counts, schemaVersion: Number.isInteger(d.schemaVersion) ? d.schemaVersion : null,
  };
}

/** Plans which project files a scan reads now: within the batch limits, skipping files over
 * the project limit by size (never read). Returns { read, skipped, rest }. */
export function planBatch(files) {
  const read = [];
  const skipped = [];
  let bytes = 0;
  let i = 0;
  for (; i < files.length; i++) {
    const f = files[i];
    if (f.size > ENGAGEMENT_LIMITS.projectBytes) { skipped.push(f); continue; }
    // A file larger than the batch budget is read alone, so every scan makes progress.
    if (read.length >= ENGAGEMENT_LIMITS.batchFiles || (read.length && bytes + f.size > ENGAGEMENT_LIMITS.batchBytes)) break;
    read.push(f);
    bytes += f.size;
    if (bytes > ENGAGEMENT_LIMITS.batchBytes) { i++; break; }
  }
  return { read, skipped, rest: files.slice(i) };
}
