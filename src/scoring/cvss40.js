// CVSS 4.0 Base (CVSS-B) scoring: a faithful port of the FIRST CVSS v4.0 reference calculator,
// github.com/FIRSTdotorg/cvss-v4-calculator at commit c5b0d409ae9f57c44264c6ce5f27d89298e1d32a
// (cvss_score.js, cvss_lookup.js, max_composed.js, max_severity.js).
//
// Copyright (c) 2023 FIRST.ORG, Inc., Red Hat, and contributors
// SPDX-License-Identifier: BSD-2-Clause (full text in THIRD-PARTY-NOTICES)
//
// Changes from the reference: an ES module with local variables instead of globals; Base metrics
// only, so Threat and Environmental metrics take their "Not Defined" values (E:X = A,
// CR/IR/AR:X = H, no modified metrics); a strict parser. The arithmetic and its order are kept
// as in the reference so the scores match it exactly (tests/cvss40.test.mjs checks every vector).
const ORDER = ['AV', 'AC', 'AT', 'PR', 'UI', 'VC', 'VI', 'VA', 'SC', 'SI', 'SA'];
const VALUES = { AV: 'NALP', AC: 'LH', AT: 'NP', PR: 'NLH', UI: 'NPA', VC: 'HLN', VI: 'HLN', VA: 'HLN', SC: 'HLN', SI: 'HLN', SA: 'HLN' };

// MacroVector scores (reference cvss_lookup.js).
const LOOKUP = Object.freeze({
  '000000': 10, '000001': 9.9, '000010': 9.8, '000011': 9.5, '000020': 9.5, '000021': 9.2,
  '000100': 10, '000101': 9.6, '000110': 9.3, '000111': 8.7, '000120': 9.1, '000121': 8.1,
  '000200': 9.3, '000201': 9, '000210': 8.9, '000211': 8, '000220': 8.1, '000221': 6.8,
  '001000': 9.8, '001001': 9.5, '001010': 9.5, '001011': 9.2, '001020': 9, '001021': 8.4,
  '001100': 9.3, '001101': 9.2, '001110': 8.9, '001111': 8.1, '001120': 8.1, '001121': 6.5,
  '001200': 8.8, '001201': 8, '001210': 7.8, '001211': 7, '001220': 6.9, '001221': 4.8,
  '002001': 9.2, '002011': 8.2, '002021': 7.2, '002101': 7.9, '002111': 6.9, '002121': 5,
  '002201': 6.9, '002211': 5.5, '002221': 2.7, '010000': 9.9, '010001': 9.7, '010010': 9.5,
  '010011': 9.2, '010020': 9.2, '010021': 8.5, '010100': 9.5, '010101': 9.1, '010110': 9,
  '010111': 8.3, '010120': 8.4, '010121': 7.1, '010200': 9.2, '010201': 8.1, '010210': 8.2,
  '010211': 7.1, '010220': 7.2, '010221': 5.3, '011000': 9.5, '011001': 9.3, '011010': 9.2,
  '011011': 8.5, '011020': 8.5, '011021': 7.3, '011100': 9.2, '011101': 8.2, '011110': 8,
  '011111': 7.2, '011120': 7, '011121': 5.9, '011200': 8.4, '011201': 7, '011210': 7.1,
  '011211': 5.2, '011220': 5, '011221': 3, '012001': 8.6, '012011': 7.5, '012021': 5.2,
  '012101': 7.1, '012111': 5.2, '012121': 2.9, '012201': 6.3, '012211': 2.9, '012221': 1.7,
  '100000': 9.8, '100001': 9.5, '100010': 9.4, '100011': 8.7, '100020': 9.1, '100021': 8.1,
  '100100': 9.4, '100101': 8.9, '100110': 8.6, '100111': 7.4, '100120': 7.7, '100121': 6.4,
  '100200': 8.7, '100201': 7.5, '100210': 7.4, '100211': 6.3, '100220': 6.3, '100221': 4.9,
  '101000': 9.4, '101001': 8.9, '101010': 8.8, '101011': 7.7, '101020': 7.6, '101021': 6.7,
  '101100': 8.6, '101101': 7.6, '101110': 7.4, '101111': 5.8, '101120': 5.9, '101121': 5,
  '101200': 7.2, '101201': 5.7, '101210': 5.7, '101211': 5.2, '101220': 5.2, '101221': 2.5,
  '102001': 8.3, '102011': 7, '102021': 5.4, '102101': 6.5, '102111': 5.8, '102121': 2.6,
  '102201': 5.3, '102211': 2.1, '102221': 1.3, '110000': 9.5, '110001': 9, '110010': 8.8,
  '110011': 7.6, '110020': 7.6, '110021': 7, '110100': 9, '110101': 7.7, '110110': 7.5,
  '110111': 6.2, '110120': 6.1, '110121': 5.3, '110200': 7.7, '110201': 6.6, '110210': 6.8,
  '110211': 5.9, '110220': 5.2, '110221': 3, '111000': 8.9, '111001': 7.8, '111010': 7.6,
  '111011': 6.7, '111020': 6.2, '111021': 5.8, '111100': 7.4, '111101': 5.9, '111110': 5.7,
  '111111': 5.7, '111120': 4.7, '111121': 2.3, '111200': 6.1, '111201': 5.2, '111210': 5.7,
  '111211': 2.9, '111220': 2.4, '111221': 1.6, '112001': 7.1, '112011': 5.9, '112021': 3,
  '112101': 5.8, '112111': 2.6, '112121': 1.5, '112201': 2.3, '112211': 1.3, '112221': 0.6,
  '200000': 9.3, '200001': 8.7, '200010': 8.6, '200011': 7.2, '200020': 7.5, '200021': 5.8,
  '200100': 8.6, '200101': 7.4, '200110': 7.4, '200111': 6.1, '200120': 5.6, '200121': 3.4,
  '200200': 7, '200201': 5.4, '200210': 5.2, '200211': 4, '200220': 4, '200221': 2.2,
  '201000': 8.5, '201001': 7.5, '201010': 7.4, '201011': 5.5, '201020': 6.2, '201021': 5.1,
  '201100': 7.2, '201101': 5.7, '201110': 5.5, '201111': 4.1, '201120': 4.6, '201121': 1.9,
  '201200': 5.3, '201201': 3.6, '201210': 3.4, '201211': 1.9, '201220': 1.9, '201221': 0.8,
  '202001': 6.4, '202011': 5.1, '202021': 2, '202101': 4.7, '202111': 2.1, '202121': 1.1,
  '202201': 2.4, '202211': 0.9, '202221': 0.4, '210000': 8.8, '210001': 7.5, '210010': 7.3,
  '210011': 5.3, '210020': 6, '210021': 5, '210100': 7.3, '210101': 5.5, '210110': 5.9,
  '210111': 4, '210120': 4.1, '210121': 2, '210200': 5.4, '210201': 4.3, '210210': 4.5,
  '210211': 2.2, '210220': 2, '210221': 1.1, '211000': 7.5, '211001': 5.5, '211010': 5.8,
  '211011': 4.5, '211020': 4, '211021': 2.1, '211100': 6.1, '211101': 5.1, '211110': 4.8,
  '211111': 1.8, '211120': 2, '211121': 0.9, '211200': 4.6, '211201': 1.8, '211210': 1.7,
  '211211': 0.7, '211220': 0.8, '211221': 0.2, '212001': 5.3, '212011': 2.4, '212021': 1.4,
  '212101': 2.4, '212111': 1.2, '212121': 0.5, '212201': 1, '212211': 0.3, '212221': 0.1,
});

// Highest-severity vectors of each MacroVector (reference max_composed.js).
const MAX_COMPOSED = {
  eq1: { 0: ['AV:N/PR:N/UI:N/'], 1: ['AV:A/PR:N/UI:N/', 'AV:N/PR:L/UI:N/', 'AV:N/PR:N/UI:P/'], 2: ['AV:P/PR:N/UI:N/', 'AV:A/PR:L/UI:P/'] },
  eq2: { 0: ['AC:L/AT:N/'], 1: ['AC:H/AT:N/', 'AC:L/AT:P/'] },
  eq3: {
    0: { 0: ['VC:H/VI:H/VA:H/CR:H/IR:H/AR:H/'], 1: ['VC:H/VI:H/VA:L/CR:M/IR:M/AR:H/', 'VC:H/VI:H/VA:H/CR:M/IR:M/AR:M/'] },
    1: { 0: ['VC:L/VI:H/VA:H/CR:H/IR:H/AR:H/', 'VC:H/VI:L/VA:H/CR:H/IR:H/AR:H/'], 1: ['VC:L/VI:H/VA:L/CR:H/IR:M/AR:H/', 'VC:L/VI:H/VA:H/CR:H/IR:M/AR:M/', 'VC:H/VI:L/VA:H/CR:M/IR:H/AR:M/', 'VC:H/VI:L/VA:L/CR:M/IR:H/AR:H/', 'VC:L/VI:L/VA:H/CR:H/IR:H/AR:M/'] },
    2: { 1: ['VC:L/VI:L/VA:L/CR:H/IR:H/AR:H/'] },
  },
  eq4: { 0: ['SC:H/SI:S/SA:S/'], 1: ['SC:H/SI:H/SA:H/'], 2: ['SC:L/SI:L/SA:L/'] },
  eq5: { 0: ['E:A/'], 1: ['E:P/'], 2: ['E:U/'] },
};

// Maximal severity depth of each MacroVector, plus one (reference max_severity.js).
const MAX_SEVERITY = {
  eq1: { 0: 1, 1: 4, 2: 5 },
  eq2: { 0: 1, 1: 2 },
  eq3eq6: { 0: { 0: 7, 1: 6 }, 1: { 0: 8, 1: 8 }, 2: { 1: 10 } },
  eq4: { 0: 6, 1: 5, 2: 4 },
};

const LEVELS = {
  AV: { N: 0.0, A: 0.1, L: 0.2, P: 0.3 }, PR: { N: 0.0, L: 0.1, H: 0.2 }, UI: { N: 0.0, P: 0.1, A: 0.2 },
  AC: { L: 0.0, H: 0.1 }, AT: { N: 0.0, P: 0.1 },
  VC: { H: 0.0, L: 0.1, N: 0.2 }, VI: { H: 0.0, L: 0.1, N: 0.2 }, VA: { H: 0.0, L: 0.1, N: 0.2 },
  SC: { H: 0.1, L: 0.2, N: 0.3 }, SI: { S: 0.0, H: 0.1, L: 0.2, N: 0.3 }, SA: { S: 0.0, H: 0.1, L: 0.2, N: 0.3 },
  CR: { H: 0.0, M: 0.1, L: 0.2 }, IR: { H: 0.0, M: 0.1, L: 0.2 }, AR: { H: 0.0, M: 0.1, L: 0.2 },
};
// Reference order of the per-metric distances.
const DISTANCE_METRICS = ['AV', 'PR', 'UI', 'AC', 'AT', 'VC', 'VI', 'VA', 'SC', 'SI', 'SA', 'CR', 'IR', 'AR'];

/** The effective value of a metric (reference m()): Not Defined Threat and requirement metrics
 * take their worst case; a Base vector has no modified metrics. */
function m(selected, metric) {
  const value = selected[metric];
  if (metric === 'E' && value === 'X') return 'A';
  if ((metric === 'CR' || metric === 'IR' || metric === 'AR') && value === 'X') return 'H';
  return value;
}

function extractValueMetric(metric, str) {
  const extracted = str.slice(str.indexOf(metric) + metric.length + 1);
  return extracted.indexOf('/') > 0 ? extracted.substring(0, extracted.indexOf('/')) : extracted;
}

function macroVector(s) {
  let eq1, eq3, eq4, eq5;
  const AV = m(s, 'AV'), PR = m(s, 'PR'), UI = m(s, 'UI');
  if (AV === 'N' && PR === 'N' && UI === 'N') eq1 = '0';
  else if ((AV === 'N' || PR === 'N' || UI === 'N') && !(AV === 'N' && PR === 'N' && UI === 'N') && !(AV === 'P')) eq1 = '1';
  else if (AV === 'P' || !(AV === 'N' || PR === 'N' || UI === 'N')) eq1 = '2';

  const eq2 = m(s, 'AC') === 'L' && m(s, 'AT') === 'N' ? '0' : '1';

  const VC = m(s, 'VC'), VI = m(s, 'VI'), VA = m(s, 'VA');
  if (VC === 'H' && VI === 'H') eq3 = 0;
  else if (!(VC === 'H' && VI === 'H') && (VC === 'H' || VI === 'H' || VA === 'H')) eq3 = 1;
  else if (!(VC === 'H' || VI === 'H' || VA === 'H')) eq3 = 2;

  if (m(s, 'MSI') === 'S' || m(s, 'MSA') === 'S') eq4 = 0;
  else if (m(s, 'SC') === 'H' || m(s, 'SI') === 'H' || m(s, 'SA') === 'H') eq4 = 1;
  else eq4 = 2;

  const E = m(s, 'E');
  if (E === 'A') eq5 = 0; else if (E === 'P') eq5 = 1; else if (E === 'U') eq5 = 2;

  const eq6 = (m(s, 'CR') === 'H' && VC === 'H') || (m(s, 'IR') === 'H' && VI === 'H') || (m(s, 'AR') === 'H' && VA === 'H') ? 0 : 1;
  return eq1 + eq2 + eq3 + eq4 + eq5 + eq6;
}

function score(s) {
  // No impact on any system: the score is 0.
  if (['VC', 'VI', 'VA', 'SC', 'SI', 'SA'].every((metric) => m(s, metric) === 'N')) return 0.0;
  const mv = macroVector(s);
  let value = LOOKUP[mv];
  const eq1 = parseInt(mv[0]), eq2 = parseInt(mv[1]), eq3 = parseInt(mv[2]);
  const eq4 = parseInt(mv[3]), eq5 = parseInt(mv[4]), eq6 = parseInt(mv[5]);

  // 1a. The next lower MacroVector of each EQ, which may not exist (its score is then NaN).
  const eq1Lower = ''.concat(eq1 + 1, eq2, eq3, eq4, eq5, eq6);
  const eq2Lower = ''.concat(eq1, eq2 + 1, eq3, eq4, eq5, eq6);
  let eq3eq6Lower, eq3eq6Left, eq3eq6Right;
  if (eq3 === 1 && eq6 === 1) eq3eq6Lower = ''.concat(eq1, eq2, eq3 + 1, eq4, eq5, eq6);
  else if (eq3 === 0 && eq6 === 1) eq3eq6Lower = ''.concat(eq1, eq2, eq3 + 1, eq4, eq5, eq6);
  else if (eq3 === 1 && eq6 === 0) eq3eq6Lower = ''.concat(eq1, eq2, eq3, eq4, eq5, eq6 + 1);
  else if (eq3 === 0 && eq6 === 0) {
    eq3eq6Left = ''.concat(eq1, eq2, eq3, eq4, eq5, eq6 + 1);
    eq3eq6Right = ''.concat(eq1, eq2, eq3 + 1, eq4, eq5, eq6);
  } else eq3eq6Lower = ''.concat(eq1, eq2, eq3 + 1, eq4, eq5, eq6 + 1);
  const eq4Lower = ''.concat(eq1, eq2, eq3, eq4 + 1, eq5, eq6);
  const eq5Lower = ''.concat(eq1, eq2, eq3, eq4, eq5 + 1, eq6);

  const scoreEq1Lower = LOOKUP[eq1Lower], scoreEq2Lower = LOOKUP[eq2Lower];
  let scoreEq3eq6Lower;
  if (eq3 === 0 && eq6 === 0) {
    const left = LOOKUP[eq3eq6Left], right = LOOKUP[eq3eq6Right];
    scoreEq3eq6Lower = left > right ? left : right;
  } else scoreEq3eq6Lower = LOOKUP[eq3eq6Lower];
  const scoreEq4Lower = LOOKUP[eq4Lower], scoreEq5Lower = LOOKUP[eq5Lower];

  // 1b. Severity distance from the first highest-severity vector of this MacroVector that the
  // scored vector does not exceed. As in the reference, if none qualifies the last one is used.
  const maxVectors = [];
  for (const a of MAX_COMPOSED.eq1[mv[0]]) for (const b of MAX_COMPOSED.eq2[mv[1]]) for (const c of MAX_COMPOSED.eq3[mv[2]][mv[5]])
    for (const d of MAX_COMPOSED.eq4[mv[3]]) for (const e of MAX_COMPOSED.eq5[mv[4]]) maxVectors.push(a + b + c + d + e);
  const dist = {};
  for (const maxVector of maxVectors) {
    for (const metric of DISTANCE_METRICS) dist[metric] = LEVELS[metric][m(s, metric)] - LEVELS[metric][extractValueMetric(metric, maxVector)];
    if (DISTANCE_METRICS.some((metric) => dist[metric] < 0)) continue;
    break;
  }
  const distEq1 = dist.AV + dist.PR + dist.UI;
  const distEq2 = dist.AC + dist.AT;
  const distEq3eq6 = dist.VC + dist.VI + dist.VA + dist.CR + dist.IR + dist.AR;
  const distEq4 = dist.SC + dist.SI + dist.SA;

  // 1c-d. Proportion of each distance, times the maximal scoring difference.
  const step = 0.1;
  const availEq1 = value - scoreEq1Lower, availEq2 = value - scoreEq2Lower, availEq3eq6 = value - scoreEq3eq6Lower;
  const availEq4 = value - scoreEq4Lower, availEq5 = value - scoreEq5Lower;
  const maxEq1 = MAX_SEVERITY.eq1[eq1] * step, maxEq2 = MAX_SEVERITY.eq2[eq2] * step;
  const maxEq3eq6 = MAX_SEVERITY.eq3eq6[eq3][eq6] * step, maxEq4 = MAX_SEVERITY.eq4[eq4] * step;
  let lower = 0, normEq1 = 0, normEq2 = 0, normEq3eq6 = 0, normEq4 = 0, normEq5 = 0;
  if (!isNaN(availEq1)) { lower += 1; normEq1 = availEq1 * (distEq1 / maxEq1); }
  if (!isNaN(availEq2)) { lower += 1; normEq2 = availEq2 * (distEq2 / maxEq2); }
  if (!isNaN(availEq3eq6)) { lower += 1; normEq3eq6 = availEq3eq6 * (distEq3eq6 / maxEq3eq6); }
  if (!isNaN(availEq4)) { lower += 1; normEq4 = availEq4 * (distEq4 / maxEq4); }
  if (!isNaN(availEq5)) { lower += 1; normEq5 = availEq5 * 0; }

  // 2-3. The MacroVector score minus the mean distance, kept in 0-10, rounded to one decimal.
  const meanDistance = lower === 0 ? 0 : (normEq1 + normEq2 + normEq3eq6 + normEq4 + normEq5) / lower;
  value -= meanDistance;
  if (value < 0) value = 0.0;
  if (value > 10) value = 10.0;
  return Math.round(value * 10) / 10;
}

/** Parse a CVSS 4.0 Base vector strictly; return it in canonical metric order with its Base
 * score (CVSS-B). Metrics may come in any order, as for CVSS 3.1. Threat, Environmental and
 * Supplemental metrics are refused, never dropped. */
export function parseCvss40(input) {
  if (typeof input !== 'string' || input.length > 64 || !input.startsWith('CVSS:4.0/')) {
    throw new Error('Enter a CVSS 4.0 Base vector starting with CVSS:4.0/.');
  }
  const tokens = input.slice(9).split('/');
  if (tokens.length !== 11) throw new Error('CVSS 4.0 Base requires exactly AV, AC, AT, PR, UI, VC, VI, VA, SC, SI and SA.');
  const metrics = {};
  for (const token of tokens) {
    const pair = token.split(':');
    const [key, value] = pair;
    if (pair.length !== 2 || !Object.hasOwn(VALUES, key) || value.length !== 1 || !VALUES[key].includes(value)) {
      throw new Error('Invalid CVSS 4.0 Base metric: ' + token);
    }
    if (Object.hasOwn(metrics, key)) throw new Error('Duplicate CVSS metric: ' + key);
    metrics[key] = value;
  }
  if (ORDER.some((key) => !Object.hasOwn(metrics, key))) throw new Error('Missing CVSS 4.0 Base metric.');
  return { vector: 'CVSS:4.0/' + ORDER.map((key) => key + ':' + metrics[key]).join('/'), metrics, score: score({ ...metrics, E: 'X', CR: 'X', IR: 'X', AR: 'X' }) };
}

export const CVSS40_ORDER = Object.freeze([...ORDER]);
export const CVSS40_VALUES = Object.freeze({ ...VALUES });
