// {client} and {application}: two fixed name tokens in library text. Rootnote asks for the
// names when an entry is added to a report and fills them in one pass; nothing else is a token
// (no expressions, no escaping, case-sensitive). A token inside a second pair of braces, as in a
// template-injection payload like {{client}}, is left alone. The same field list is used for
// finding tokens, counting, previewing, replacing and offering a name for replacement.

export const NAME_TOKENS = Object.freeze(['client', 'application']);
const TOKEN = /(?<!\{)\{(client|application)\}(?!\})/g;
const TEXT_KEYS = ['description', 'impact', 'threat', 'recommendation'];

/** The fields that can hold tokens, in report order: { key, label, text, kind }. kind is
 * 'line' (title, asset, reference title), 'text' (a text section) or 'block' (a details block,
 * with code: true for code blocks). Reference addresses, ids and scores are never included. */
export function nameFields(entry) {
  const out = [{ key: 'title', label: 'Title', text: entry.title ?? '', kind: 'line' }];
  (entry.affectedAssets ?? []).forEach((a, i) => out.push({ key: `affectedAssets.${i}`, label: `Affected asset ${i + 1}`, text: a, kind: 'line' }));
  for (const k of TEXT_KEYS) out.push({ key: k, label: k, text: entry[k] ?? '', kind: 'text', code: entry.formats?.[k] === 'code' });
  (entry.details ?? []).forEach((b, i) => { if (b.type === undefined || b.type === 'text') out.push({ key: `details.${i}`, label: `Additional details block ${i + 1}`, text: b.text, kind: 'block', code: b.format === 'code' }); });
  (entry.references ?? []).forEach((r, i) => out.push({ key: `references.${i}`, label: `Reference ${i + 1} title`, text: r.title, kind: 'line' }));
  return out;
}

/** How many of each token the entry's fields hold: { client, application }. */
export function countNameTokens(entry) {
  const n = { client: 0, application: 0 };
  for (const f of nameFields(entry)) for (const m of f.text.matchAll(TOKEN)) n[m[1]]++;
  return n;
}

/** Counts in one string (for the checklist). */
export function tokensIn(text) {
  const n = { client: 0, application: 0 };
  if (typeof text === 'string') for (const m of text.matchAll(TOKEN)) n[m[1]]++;
  return n;
}

/** One pass: each token with a non-empty value becomes that value, exactly as typed (a value is
 * never scanned again, so "{application}" or "$&" in a value stays literal). */
export const fillText = (text, values) => text.replace(TOKEN, (m, name) => (values[name] ? values[name] : m));

/** A copy of the entry with the tokens filled; the entry itself is not changed. */
export function fillEntry(entry, values) {
  const e = structuredClone(entry);
  e.title = fillText(e.title ?? '', values);
  if (e.affectedAssets) e.affectedAssets = e.affectedAssets.map((a) => fillText(a, values));
  for (const k of TEXT_KEYS) if (typeof e[k] === 'string') e[k] = fillText(e[k], values);
  if (e.details) e.details = e.details.map((b) => (b.type === undefined || b.type === 'text' ? { ...b, text: fillText(b.text, values) } : b));
  if (e.references) e.references = e.references.map((r) => ({ ...r, title: fillText(r.title, values) }));
  return e;
}

// ---- The other way: a name in a finding, offered for replacement with {client} ----
// Only prose is offered: the title, plain text sections and plain Additional details blocks.
// Never code, affected assets or references; never part of a longer word; never a name shorter
// than three characters. At most REVERSE_MAX places are listed, and only listed places change.

export const REVERSE_MIN = 3;
export const REVERSE_MAX = 100;
const WORD = /[\p{L}\p{N}\p{M}_]/u;
// The whole characters next to a match (a surrogate pair is one character).
const charBefore = (t, at) => (at <= 0 ? '' : String.fromCodePoint(t.codePointAt(at >= 2 && /[\uDC00-\uDFFF]/.test(t[at - 1]) && /[\uD800-\uDBFF]/.test(t[at - 2]) ? at - 2 : at - 1)));
const charAfter = (t, end) => (end >= t.length ? '' : String.fromCodePoint(t.codePointAt(end)));
/** The places `name` could become {client} in a library entry (keys follow the entry, whose
 * details hold text blocks only): { matches: [{ key, start, end, before, after }], partial,
 * more }. partial: the name also occurs inside a longer word (those places are not offered);
 * more: whole-word places beyond REVERSE_MAX (not listed, not changed). */
export function findName(entry, name) {
  const out = { matches: [], partial: false, more: 0 };
  if (!name || name.length < REVERSE_MIN) return out;
  for (const f of nameFields(entry)) {
    if (!(f.key === 'title' || (f.kind !== 'line' && !f.code))) continue;
    for (let at = f.text.indexOf(name); at >= 0; at = f.text.indexOf(name, at + name.length)) {
      const end = at + name.length;
      if (WORD.test(charBefore(f.text, at)) || WORD.test(charAfter(f.text, end))) { out.partial = true; continue; }
      if (out.matches.length >= REVERSE_MAX) { out.more++; continue; }
      out.matches.push({ key: f.key, start: at, end, before: f.text.slice(Math.max(0, at - 80), at), after: f.text.slice(end, end + 80) });
    }
  }
  return out;
}

/** Which places start ticked: none when the name also occurs inside a longer word (the tester
 * decides); otherwise all of them, since every listed place is a whole word in prose. */
export const defaultTicks = (found) => found.matches.map(() => !found.partial);

/** A copy of the entry with the ticked matches replaced by {client}. */
export function replaceMatches(entry, matches, ticked) {
  const e = structuredClone(entry);
  const byKey = new Map();
  matches.forEach((m, i) => { if (ticked[i]) (byKey.get(m.key) ?? byKey.set(m.key, []).get(m.key)).push(m); });
  const edit = (text, list) => list.sort((a, z) => z.start - a.start).reduce((t, m) => `${t.slice(0, m.start)}{client}${t.slice(m.end)}`, text);
  for (const [key, list] of byKey) {
    const [field, i] = key.split('.');
    if (field === 'title') e.title = edit(e.title, list);
    else if (field === 'affectedAssets') e.affectedAssets[i] = edit(e.affectedAssets[i], list);
    else if (field === 'details') e.details[i] = { ...e.details[i], text: edit(e.details[i].text, list) };
    else if (field === 'references') e.references[i] = { ...e.references[i], title: edit(e.references[i].title, list) };
    else e[field] = edit(e[field], list);
  }
  return e;
}
