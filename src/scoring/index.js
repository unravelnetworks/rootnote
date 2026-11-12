// Original implementation of FIRST CVSS 3.1 Base equations, section 7 / Appendix A.
// https://www.first.org/cvss/v3.1/specification-document
// No Temporal/Environmental calculation; no dependencies or I/O. CVSS 4.0 Base is in cvss40.js.
import { parseCvss40 } from './cvss40.js';
export { parseCvss40 } from './cvss40.js';
const ORDER = ['AV', 'AC', 'PR', 'UI', 'S', 'C', 'I', 'A'];
const VALUES = { AV: 'NALP', AC: 'LH', PR: 'NLH', UI: 'NR', S: 'UC', C: 'NLH', I: 'NLH', A: 'NLH' };
const IMPACT = { N: 0, L: 0.22, H: 0.56 };
export { formatFindingStatus, formatEngagementStatus, findingStatusCounts } from './status.js';

function roundup(value) {
  // FIRST Appendix A: integer rounding avoids a spurious extra 0.1 from FP noise.
  const n = Math.round(value * 100000);
  return n % 10000 === 0 ? n / 100000 : (Math.floor(n / 10000) + 1) / 10;
}

/** Parse strictly, canonicalize metric order, and derive a one-decimal Base score.
 * Entry may trim the user's vector before calling; this parser never discards text. */
export function parseCvss31(input) {
  if (typeof input !== 'string' || input.length > 64 || !input.startsWith('CVSS:3.1/')) {
    throw new Error('Enter a CVSS 3.1 Base vector starting with CVSS:3.1/.');
  }
  const tokens = input.slice(9).split('/');
  if (tokens.length !== 8) throw new Error('CVSS 3.1 Base requires exactly AV, AC, PR, UI, S, C, I and A.');
  const metrics = {};
  for (const token of tokens) {
    const pair = token.split(':');
    const [key, value] = pair;
    if (pair.length !== 2 || !ORDER.includes(key) || value.length !== 1 || !VALUES[key].includes(value)) {
      throw new Error('Invalid CVSS 3.1 Base metric: ' + token);
    }
    if (Object.hasOwn(metrics, key)) throw new Error('Duplicate CVSS metric: ' + key);
    metrics[key] = value;
  }
  if (ORDER.some(key => !Object.hasOwn(metrics, key))) throw new Error('Missing CVSS 3.1 Base metric.');
  const m = metrics, changed = m.S === 'C';
  const iss = 1 - (1 - IMPACT[m.C]) * (1 - IMPACT[m.I]) * (1 - IMPACT[m.A]);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  const pr = { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 }[m.PR];
  const exploitability = 8.22 * ({ N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[m.AV]) *
    ({ L: 0.77, H: 0.44 }[m.AC]) * pr * ({ N: 0.85, R: 0.62 }[m.UI]);
  const score = impact <= 0 ? 0 : roundup(Math.min((changed ? 1.08 : 1) * (impact + exploitability), 10));
  return { vector: 'CVSS:3.1/' + ORDER.map(key => key + ':' + metrics[key]).join('/'), metrics, score };
}

export const scoreCvss31 = input => parseCvss31(input).score;

/** The CVSS version a vector's prefix names ('3.1' or '4.0'), or null for no vector. It reads
 * the prefix only and does not validate the metrics (parseCvss does). Never inferred from the
 * report default. Throws for text with any other prefix. */
export function cvssVersion(vector) {
  if (vector === null || vector === undefined) return null;
  if (typeof vector === 'string' && vector.startsWith('CVSS:3.1/')) return '3.1';
  if (typeof vector === 'string' && vector.startsWith('CVSS:4.0/')) return '4.0';
  throw new Error('Enter a CVSS 3.1 or 4.0 Base vector.');
}

/** The CVSS version a report uses: project.scoring.cvssVersion (schema v7); files before v7
 * only knew CVSS 3.1. Every finding is scored in this version. */
export const reportCvssVersion = (doc) => doc?.project?.scoring?.cvssVersion ?? '3.1';

/** Rootnote's own label wordings, which follow the report's version. */
const DEFAULT_CVSS_LABEL = /^CVSS (3\.1|4\.0) Base$/;
/** A label naming a CVSS version, as "CVSS 3.1", "CVSS v4.0" or "CVSSv3.1". */
const NAMED_VERSION = /CVSS\s*v?(3\.1|4\.0)(?![\d.])/gi;

/** The score label as shown. Rootnote's own wording follows the report ("CVSS 3.1 Base" reads
 * "CVSS 4.0 Base" in a 4.0 report). Any other label is the author's text and is never
 * rewritten: it is shown as written when it names the report's version, and otherwise with
 * the version beside it ("Score (CVSS 4.0)"). A label naming another version is also flagged
 * by staleCvssLabel. */
export function cvssLabel(label, version) {
  if (DEFAULT_CVSS_LABEL.test(label)) return `CVSS ${version} Base`;
  const named = [...label.matchAll(NAMED_VERSION)].map((m) => m[1]);
  if (named.length && named.every((v) => v === version)) return label;
  return /CVSS/i.test(label) && !named.length ? `${label} (${version})` : `${label} (CVSS ${version})`;
}

/** The version a custom CVSS label names when it is not the report's, or null. */
export function staleCvssLabel(label, version) {
  if (DEFAULT_CVSS_LABEL.test(label)) return null;
  return [...label.matchAll(NAMED_VERSION)].map((m) => m[1]).find((v) => v !== version) ?? null;
}

/** For a report switching version: its label as stored afterwards. Only Rootnote's own
 * wording changes; the author's text is kept. */
export const switchedCvssLabel = (label, version) => (DEFAULT_CVSS_LABEL.test(label) ? `CVSS ${version} Base` : label);

/** Findings whose stored vector is not in the report's CVSS version (for example inserted from
 * a library or kept from an older report). They must be rescored or cleared before a report
 * with CVSS scores is exported; they are never converted or deleted silently. */
export function cvssMismatches(doc) {
  const version = reportCvssVersion(doc);
  return doc.findings.filter((f) => f.cvss && cvssVersion(f.cvss) !== version);
}

/** Why a report cannot be exported with CVSS scores, or null. `withCvss`: whether the output
 * carries CVSS scores (the CSV always does; a report when its scoring mode shows CVSS). Every
 * exporter checks this itself, so no route produces a report that mixes versions. */
export function cvssExportProblem(doc, withCvss = doc.project.scoring.mode.includes('cvss')) {
  const n = withCvss ? cvssMismatches(doc).length : 0;
  if (!n) return null;
  return `${n === 1 ? '1 finding is' : `${n} findings are`} scored in another CVSS version than this report's CVSS ${reportCvssVersion(doc)}. Rescore or clear ${n === 1 ? 'its score' : 'their scores'} first; Check & export lists ${n === 1 ? 'it' : 'them'}.`;
}

/** Suggestions for scoring a finding in `target` from its vector in the other CVSS version:
 * only metrics whose meaning carries over (Codex/Marketing 156; FIRST CVSS 4.0 user guide).
 * They are a draft for the tester to review, never a score: Rootnote does not convert.
 * 3.1 to 4.0: Attack Vector and Privileges Required; User Interaction only when it was None;
 * Confidentiality, Integrity and Availability as the vulnerable system's only when Scope was
 * Unchanged. Attack Complexity, Attack Requirements and the other systems' impact are left
 * to the tester (3.1 Attack Complexity covered what 4.0 splits into two questions).
 * 4.0 to 3.1: Attack Vector, Privileges Required, and User Interaction (Passive or Active is
 * Required). Returns the suggested metrics, possibly none. */
export function cvssSuggestions(vector, target) {
  const { version, metrics: m } = parseCvss(vector);
  if (version === target) return {};
  const out = { AV: m.AV, PR: m.PR };
  if (target === '4.0') {
    if (m.UI === 'N') out.UI = 'N';
    if (m.S === 'U') Object.assign(out, { VC: m.C, VI: m.I, VA: m.A });
  } else {
    out.UI = m.UI === 'N' ? 'N' : 'R';
  }
  return out;
}

/** A CVSS 3.1 or 4.0 Base vector, by its prefix: { version, vector, metrics, score }. Callers
 * that must accept only 3.1 (older file versions) keep using parseCvss31. */
export function parseCvss(input) {
  const version = cvssVersion(input);
  if (version === null) throw new Error('Enter a CVSS 3.1 or 4.0 Base vector.');
  return { version, ...(version === '4.0' ? parseCvss40(input) : parseCvss31(input)) };
}

/** FIRST qualitative bands, the same for CVSS 3.1 and 4.0; null is unscored, never zero. */
export function cvssBand(score) {
  if (score === null) return null;
  if (!Number.isFinite(score) || score < 0 || score > 10) throw new Error('Invalid CVSS Base score.');
  return score === 0 ? 'None' : score >= 9 ? 'Critical' : score >= 7 ? 'High' : score >= 4 ? 'Medium' : 'Low';
}

/** Independent distributions, not an aggregate risk score. A combined mode has
 * two distributions: each counts every finding once and has its own total.
 * Requires a validated v2/v3/v4 project; no mutation or dependence on section flags. */
export function ratingCounts(doc) {
  const mode = doc?.project?.scoring?.mode;
  if (!['severity', 'risk', 'cvss', 'severity+cvss', 'risk+cvss'].includes(mode) || !Array.isArray(doc?.findings)) {
    throw new Error('A validated project with a supported scoring mode is required.');
  }
  const labels = doc.project.labels;
  const total = doc.findings.length;
  const distribution = (key, label, levels, choose) => {
    const counts = new Map([...levels, 'unscored'].map(level => [level, 0]));
    for (const finding of doc.findings) {
      const level = choose(finding) ?? 'unscored';
      if (!counts.has(level)) throw new Error('Invalid finding rating.');
      counts.set(level, counts.get(level) + 1);
    }
    return { key, label, rows: [...counts].map(([key, count]) => ({ key, label: key === 'unscored' ? labels.unscored : key, count })), total };
  };
  const distributions = [];
  if (mode !== 'cvss') distributions.push(distribution('rating', mode.startsWith('risk') ? labels.risk : labels.severity,
    ['Critical', 'High', 'Medium', 'Low', 'Informational'], f => {
      if (f.rating !== null && !['Critical', 'High', 'Medium', 'Low', 'Informational'].includes(f.rating)) throw new Error('Invalid finding rating.');
      return f.rating;
    }));
  // CVSS counts never mix versions: while a finding is scored in another version than the
  // report's, the counts are withheld (cvssWithheld says how many findings) instead of shown.
  const mismatched = mode.includes('cvss') ? cvssMismatches(doc).length : 0;
  if (mode.includes('cvss') && !mismatched) distributions.push(distribution('cvss', cvssLabel(labels.cvss, reportCvssVersion(doc)),
    ['Critical', 'High', 'Medium', 'Low', 'None'], f => f.cvss === null ? null : cvssBand(parseCvss(f.cvss).score)));
  return { mode, total, distributions, ...(mismatched ? { cvssWithheld: mismatched } : {}) };
}
