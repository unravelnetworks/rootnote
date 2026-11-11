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
  if (mode.includes('cvss')) distributions.push(distribution('cvss', labels.cvss,
    ['Critical', 'High', 'Medium', 'Low', 'None'], f => f.cvss === null ? null : cvssBand(parseCvss(f.cvss).score)));
  return { mode, total, distributions };
}
