// Built-in OWASP starter library: original
// wording mapped to versioned OWASP and CWE references, in library format v2. Read-only in the
// app: entries are added to a report or copied into the user's own library, never edited here.
// Rating and CVSS are left empty; [[...]] prompts mark what the tester must observe and fill in.
import data from './starter-library.json' with { type: 'json' };

export const STARTER_LIBRARY = Object.freeze({ ...data, entries: Object.freeze(data.entries.map((e) => Object.freeze(e))) });

/** Unfilled [[...]] prompts in a text: the starter entries' observation prompts. */
export const PROMPT = /\[\[[^\[\]\n]{1,300}\]\]/g;
export const countPrompts = (s) => (typeof s === 'string' ? (s.match(PROMPT) || []).length : 0);
