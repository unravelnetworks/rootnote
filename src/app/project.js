// Project model, import validation and v1 -> v2 -> v3 -> v4 -> v5 -> v6 -> v7 migration.
// schema/project.schema.json (v1), project.v2/v3/v4.schema.json (all frozen) are the
// contracts; the numbered rules in their top $comment are enforced here
// because JSON Schema cannot express them.

import { stripImageMetadata } from './image-metadata.js';

export const FORMAT = 'fieldnote-project';
export const SCHEMA_VERSION = 8;
// Bounds of schema v1-v7 files (v1 also allows at most 31 images). Frozen: older files are
// checked against the bounds they were written under.
export const LIMITS_V7 = Object.freeze({
  fileBytes: 26214400,
  imageBytes: 2097152,
  imagePixels: 16000000,
  imageSide: 16000,
  findings: 20,
  evidence: 30,
  images: 32,
  engagementRows: 20,
  label: 80,
  prefix: 40,
  assets: 50,
  line: 300,
  text: 20000,
  detailBlocks: 100,
});
// Schema v8: only the size of a report changes (tested up to 150 findings, 400 screenshots and
// 256 MB on Windows). Every image is a screenshot or a logo, so 402 images at most.
export const LIMITS_V8 = Object.freeze({ ...LIMITS_V7, fileBytes: 268435456, findings: 150, evidence: 400, images: 402 });
/** The limits of the current format: what this version saves and edits. */
export const LIMITS = LIMITS_V8;
/** The bounds a file of this schema version is checked against, or null for an unknown version. */
export function limitsForVersion(v) {
  return v === 8 ? LIMITS_V8 : Number.isInteger(v) && v >= 1 && v <= 7 ? LIMITS_V7 : null;
}
/** A size in the app's unit: binary MB, as the app has always shown them. */
export const megabytes = (bytes) => `${Math.round(bytes / 1048576)} MB`;
const fileTooLarge = (rawBytes, limit) => ({ ok: false, errors: [`File is ${rawBytes} bytes; the limit is ${limit} (${megabytes(limit)}).`] });
export const SEVERITIES = Object.freeze(['Critical', 'High', 'Medium', 'Low', 'Informational']);
export const SCORING_MODES = Object.freeze(['severity', 'risk', 'cvss', 'severity+cvss', 'risk+cvss']);
export const REPORT_SECTIONS = Object.freeze(['executiveSummary', 'engagement', 'scope', 'findingsSummary']);
export const FINDING_SECTIONS = Object.freeze(['assets', 'description', 'details', 'impact', 'threat', 'recommendation', 'evidence']);
export const TEXT_SECTIONS = Object.freeze(['description', 'details', 'impact', 'threat', 'recommendation']);
/** v3: plain-text finding sections with a format switch. Additional details is blocks. */
export const FORMAT_KEYS = Object.freeze(['description', 'impact', 'threat', 'recommendation']);
export const ENGAGEMENT_SOURCES = Object.freeze(['custom', 'engagementId', 'client', 'testerName', 'organisation',
  'testingPeriod', 'reportVersion', 'reportDate', 'classification']);
export const LABEL_KEYS = Object.freeze(['findings', 'idColumn', 'titleColumn', 'severity', 'risk', 'cvss', 'unscored',
  'figure', 'part', 'partOf', 'page', 'pageOf', 'backToSummary', 'client', 'version', 'date']);
const V1_MAX_IMAGES = 31;

// ---- schema v4 ----
// The unsuffixed lists above keep their frozen v2/v3 meaning; v4 adds to them.
export const REPORT_SECTIONS_V4 = Object.freeze(['contents', ...REPORT_SECTIONS]);
export const FINDING_SECTIONS_V4 = Object.freeze([...FINDING_SECTIONS, 'references']);
export const LABEL_KEYS_V4 = Object.freeze([...LABEL_KEYS, 'status', 'statusNotSet']);
export const ENGAGEMENT_SOURCES_V4 = Object.freeze([...ENGAGEMENT_SOURCES, 'engagementStatus']);
// Schema v5: one more report section, the authored rating explanation.
export const REPORT_SECTIONS_V5 = Object.freeze([...REPORT_SECTIONS_V4, 'ratingMethod']);
// Schema v6: the
// user's own report sections, and a CWE and vulnerability type per finding.
export const CUSTOM_LIMITS = Object.freeze({ sections: 10, title: 80, vulnerabilityType: 120 });
export const LABEL_KEYS_V6 = Object.freeze([...LABEL_KEYS_V4, 'cwe', 'vulnerabilityType', 'classification']);
export const CUSTOM_SECTION_ID = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;
export const CWE_ID = /^CWE-[0-9]{1,5}$/;
/** The report-order key of a custom section. */
export const customKey = (id) => `custom-${id}`;
/** A new custom section id: "C" and 23 hex digits of a random UUID; never from its title. */
export const newCustomSectionId = () => `C${crypto.randomUUID().replace(/-/g, '').slice(0, 23)}`;
const CLASSIFICATION_DISPLAY_KEYS = ['keyFacts', 'summaryColumn'];
/** Finding workflow statuses; null (Not set) is also valid. */
export const FINDING_STATUSES = Object.freeze(['open', 'fixed', 'partly_fixed', 'risk_accepted', 'false_positive']);
/** Engagement statuses; null (Not set) is also valid. */
export const ENGAGEMENT_STATUSES = Object.freeze(['draft', 'in_review', 'delivered', 'retest_due']);
export const REFERENCE_LIMITS = Object.freeze({ perFinding: 20, units: 20000, title: 300, url: 2048 });
const STATUS_DISPLAY_KEYS = ['keyFacts', 'summaryColumn', 'counts'];

const FINDING_ID = /^F-(?!000)[0-9]{3}$/;
const BLOCK_ID = /^[A-Za-z0-9_-]{1,64}$/;
const IMAGE_ID = /^IMG-(?!0000)[0-9]{4}$/;
const DATE = /^$|^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
// A screenshot's data URL: data:image/png|jpeg;base64, then base64 characters and at most two
// '=' at the end. A single pattern over the whole string was slow on large projects (hundreds
// of MB of base64 when opening), so the parts are checked separately below.
const DATA_URL_PREFIX = /^data:image\/(png|jpeg);base64,/;
const NOT_BASE64 = /[^A-Za-z0-9+/]/;
const BASE64_WHITESPACE = /[\t\n\f\r ]/;
// True when every character is in the base64 alphabet. The built-in decoder rejects any other
// character except ASCII whitespace and '=', which the caller has already ruled out; it is much
// faster than a character-class scan over hundreds of MB.
const allBase64 = (s) => {
  if (typeof Uint8Array.fromBase64 !== 'function') return !NOT_BASE64.test(s);
  try { Uint8Array.fromBase64(s); return true; } catch { return false; }
};
/** Checks a screenshot data URL. Returns null when it is not one, { tooLarge: true } when its
 * base64 is longer than `maxBase64` (checked before anything is decoded), else
 * { type: 'png' | 'jpeg', base64 }. */
export function parseImageDataUrl(s, maxBase64 = Infinity) {
  const m = DATA_URL_PREFIX.exec(s);
  if (!m) return null;
  if (s.length - m[0].length > maxBase64) return { tooLarge: true };
  let end = s.length;
  for (let pad = 0; pad < 2 && end > m[0].length && s.charCodeAt(end - 1) === 61; pad++) end--;
  const core = s.slice(m[0].length, end);
  if (!core.length || core.indexOf('=') !== -1 || BASE64_WHITESPACE.test(core)) return null;
  // Whole groups of four through the decoder; the last 0-3 characters checked directly.
  const whole = core.length - (core.length % 4);
  if (NOT_BASE64.test(core.slice(whole)) || (whole && !allBase64(core.slice(0, whole)))) return null;
  return { type: m[1], base64: s.slice(m[0].length) };
}
const SHA256 = /^[0-9a-f]{64}$/;
const CVSS31 = /^CVSS:3\.1\/AV:[NALP]\/AC:[LH]\/PR:[NLH]\/UI:[NR]\/S:[UC]\/C:[NLH]\/I:[NLH]\/A:[NLH]$/;
// Schema v7 also accepts a canonical CVSS 4.0 Base vector (the 11 Base metrics in FIRST order).
const CVSS40 = /^CVSS:4\.0\/AV:[NALP]\/AC:[LH]\/AT:[NP]\/PR:[NLH]\/UI:[NPA]\/VC:[HLN]\/VI:[HLN]\/VA:[HLN]\/SC:[HLN]\/SI:[HLN]\/SA:[HLN]$/;
export const CVSS_VERSIONS = Object.freeze(['3.1', '4.0']);
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
// Rule 10: characters that are not valid XML 1.0 text, plus unpaired surrogates.
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const XML_INVALID_G = new RegExp(XML_INVALID.source, 'g');

const PROJECT_KEYS_V1 = ['title', 'client', 'testerName', 'organisation', 'reportVersion', 'classification',
  'startDate', 'endDate', 'reportDate', 'scope', 'executiveSummary', 'paperSize', 'accentColor',
  'logoImageId', 'nextFindingNumber', 'nextImageNumber'];
const FINDING_KEYS_V1 = ['id', 'title', 'severity', 'affectedAssets', 'description', 'reproduction',
  'impact', 'recommendation', 'evidence'];
const PROJECT_KEYS_V2 = ['title', 'subtitle', 'client', 'testerName', 'organisation', 'reportVersion',
  'classification', 'startDate', 'endDate', 'reportDate', 'scope', 'executiveSummary', 'paperSize', 'accentColor',
  'nextFindingNumber', 'nextImageNumber', 'engagementId', 'findingPrefix', 'cover', 'branding', 'scoring',
  'engagement', 'sections', 'labels', 'backToSummaryLinks'];
const FINDING_KEYS_V2 = ['id', 'title', 'rating', 'cvss', 'affectedAssets', 'description', 'details', 'impact',
  'threat', 'recommendation', 'formats', 'evidence'];
const PROJECT_KEYS_V4 = [...PROJECT_KEYS_V2, 'engagementStatus', 'findingStatusDisplay'];
const FINDING_KEYS_V4 = [...FINDING_KEYS_V2, 'status', 'references'];
const PROJECT_KEYS_V5 = [...PROJECT_KEYS_V4, 'ratingMethod'];
const PROJECT_KEYS_V6 = [...PROJECT_KEYS_V5, 'customSections', 'classificationDisplay'];
const FINDING_KEYS_V6 = [...FINDING_KEYS_V4, 'cwe', 'vulnerabilityType'];
const IMAGE_KEYS = ['id', 'mime', 'dataUrl', 'width', 'height', 'bytes', 'sha256', 'caption',
  'tallMode', 'originalName'];

/** Removes characters that cannot appear in XML 1.0 from typed or pasted text. */
export function sanitizeText(s) {
  return String(s).replace(XML_INVALID_G, '');
}

/** Removes line breaks as well, for single-line fields. */
export function sanitizeLine(s) {
  return sanitizeText(s).replace(/[\r\n]+/g, ' ');
}

/** Schema v1 empty project, kept for tests and fixtures of the v1 format. */
export function createEmptyProjectV1(now = new Date()) {
  const t = now.toISOString();
  return {
    format: FORMAT,
    schemaVersion: 1,
    createdAt: t,
    savedAt: t,
    project: {
      title: '',
      client: '',
      testerName: '',
      organisation: '',
      reportVersion: '1.0',
      classification: '',
      startDate: '',
      endDate: '',
      reportDate: '',
      scope: '',
      executiveSummary: '',
      paperSize: 'A4',
      accentColor: '#1f5f8b',
      logoImageId: null,
      nextFindingNumber: 1,
      nextImageNumber: 1,
    },
    findings: [],
    images: [],
  };
}

// ---- schema v2 defaults ----

const DEFAULT_LABELS = Object.freeze({
  findings: 'Findings', idColumn: 'ID', titleColumn: 'Finding', severity: 'Severity', risk: 'Risk',
  cvss: 'CVSS 3.1 Base', unscored: 'Unscored', figure: 'Figure', part: 'part', partOf: 'of', page: 'Page',
  pageOf: 'of', backToSummary: 'Back to findings summary', client: 'Client', version: 'Version', date: 'Date',
});
const REPORT_SECTION_LABELS = { executiveSummary: 'Executive summary', engagement: 'Engagement details', scope: 'Scope', findingsSummary: 'Findings summary' };
const FINDING_SECTION_LABELS = { assets: 'Affected assets', description: 'Description', details: 'Additional details', impact: 'Impact', threat: 'Threat', recommendation: 'Recommendations', evidence: 'Evidence' };

function defaultEngagementRows() {
  const bound = (source, label) => ({ source, label, enabled: true });
  const custom = (label) => ({ source: 'custom', label, enabled: true, value: '', format: 'plain' });
  return [
    bound('engagementId', 'Engagement ID'), bound('testerName', 'Researcher(s)'), bound('client', 'Customer'),
    custom('Customer contact'), bound('testingPeriod', 'Testing period'), custom('Scope summary'),
    custom('Analysed data'), custom('Methodology'), custom('Limitations'),
  ];
}

/** The v2 project settings. `migrated` keeps a converted v1 report's look: no cover,
 * no engagement table, and the v1 heading for the former reproduction text. */
function defaultSettings({ migrated }) {
  return {
    engagementId: '',
    findingPrefix: '',
    cover: { enabled: !migrated },
    scoring: { mode: 'severity' },
    engagement: { rows: defaultEngagementRows() },
    sections: {
      report: REPORT_SECTIONS.map((key) => ({ key, label: REPORT_SECTION_LABELS[key], enabled: !(migrated && key === 'engagement') })),
      finding: FINDING_SECTIONS.map((key) => ({ key, label: migrated && key === 'details' ? 'Request and reproduction' : FINDING_SECTION_LABELS[key], enabled: true })),
    },
    labels: { ...DEFAULT_LABELS },
    backToSummaryLinks: false,
  };
}

const noLogo = () => ({ imageId: null, front: true, header: false, footer: false });

/** New projects are schema v7 (createEmptyProjectV7). */
export const createEmptyProject = (now = new Date()) => createEmptyProjectV8(now);

/** Schema v3 empty project, kept for tests and fixtures of the v3 format. Screenshots go into
 * Additional details, so the separate Evidence gallery section starts disabled (v3 notes). */
export function createEmptyProjectV3(now = new Date()) {
  const p = createEmptyProjectV2(now);
  p.schemaVersion = 3;
  p.project.sections.finding.find((s) => s.key === 'evidence').enabled = false;
  return p;
}

/** Schema v2 empty project, kept for tests and fixtures of the v2 format. */
export function createEmptyProjectV2(now = new Date()) {
  const p = createEmptyProjectV1(now);
  const { logoImageId, nextFindingNumber, nextImageNumber, ...meta } = p.project;
  p.schemaVersion = 2;
  p.project = {
    ...meta, subtitle: '', nextFindingNumber, nextImageNumber, ...defaultSettings({ migrated: false }),
    branding: { testerLogo: noLogo(), clientLogo: noLogo() },
  };
  return p;
}

/** v2 finding formats (five keys). */
export const defaultTextFormats = () => ({ description: 'plain', details: 'plain', impact: 'plain', threat: 'plain', recommendation: 'plain' });
/** v3 finding formats: details has none, each text block carries its own. */
export const defaultFormats = () => ({ description: 'plain', impact: 'plain', threat: 'plain', recommendation: 'plain' });

// ---- v3 Additional details blocks ----

/** A new block id: "B-" and a random UUID without dashes. Ids survive reordering. */
export const newBlockId = () => `B-${crypto.randomUUID().replace(/-/g, '')}`;
export const textBlock = (text = '', format = 'plain') => ({ id: newBlockId(), type: 'text', text, format });
export const imageBlock = (imageId) => ({ id: newBlockId(), type: 'image', imageId });

/**
 * Every screenshot reference of a finding: Additional details image blocks in block order,
 * then Evidence gallery entries in gallery order. This is not report order; the plan
 * numbers figures by the enabled section order (rule 17). Shared by the validator and the
 * report plan (v3 rules 6, 8 and 17). Tolerates v2 findings (details is text).
 */
export function screenshotRefs(finding) {
  const out = [];
  if (Array.isArray(finding.details)) {
    for (const b of finding.details) if (isObject(b) && b.type === 'image') out.push({ imageId: b.imageId, where: 'details', blockId: b.id });
  }
  if (Array.isArray(finding.evidence)) for (const id of finding.evidence) out.push({ imageId: id, where: 'evidence', blockId: null });
  return out;
}

/** Summed length of a finding's details text blocks (v3 rule 16, same length rule as text fields). */
export const detailsTextLength = (finding) => (Array.isArray(finding.details) ? finding.details : [])
  .reduce((n, b) => n + (isObject(b) && b.type === 'text' && typeof b.text === 'string' ? b.text.length : 0), 0);

/**
 * Converts a validated schema v1 project to schema v2 without changing any content:
 * every string, null, counter, date and image byte is carried over exactly.
 * reproduction -> details (code format), severity -> rating, logoImageId -> tester logo.
 */
export function migrateV1toV2(v1, { appVersion } = {}) {
  const { logoImageId = null, nextFindingNumber, nextImageNumber, ...meta } = v1.project;
  const project = {
    ...meta, subtitle: '', nextFindingNumber, nextImageNumber, ...defaultSettings({ migrated: true }),
    branding: { testerLogo: { ...noLogo(), imageId: logoImageId }, clientLogo: noLogo() },
  };
  const findings = v1.findings.map((f) => {
    const out = { id: f.id, title: f.title, rating: f.severity, cvss: null };
    if (f.affectedAssets !== undefined) out.affectedAssets = [...f.affectedAssets];
    for (const [from, to] of [['description', 'description'], ['reproduction', 'details'], ['impact', 'impact'], ['recommendation', 'recommendation']]) {
      if (f[from] !== undefined) out[to] = f[from];
    }
    out.formats = { ...defaultTextFormats(), details: 'code' };
    out.evidence = [...f.evidence];
    return out;
  });
  const out = { format: FORMAT, schemaVersion: 2 };
  if (appVersion !== undefined) out.appVersion = appVersion;
  else if (v1.appVersion !== undefined) out.appVersion = v1.appVersion;
  return { ...out, createdAt: v1.createdAt, savedAt: v1.savedAt, project, findings, images: v1.images.map((im) => ({ ...im })) };
}

/**
 * Converts a validated schema v2 project to schema v3 without changing any content.
 * details (string) + formats.details -> one text block with a deterministic id, the exact
 * string and its format; an absent details -> []. Evidence galleries, section flags and
 * everything else are carried over unchanged.
 */
export function migrateV2toV3(v2, { appVersion } = {}) {
  const findings = v2.findings.map((f) => {
    const out = {};
    for (const [k, val] of Object.entries(f)) {
      if (k === 'details') continue;
      if (k === 'formats') {
        if (!('details' in out)) out.details = f.details === undefined ? [] : [{ id: `B-${f.id}-details`, type: 'text', text: f.details, format: f.formats.details }];
        const { details, ...rest } = val;
        out.formats = rest;
        continue;
      }
      out[k] = Array.isArray(val) ? [...val] : val;
    }
    return out;
  });
  const out = { format: FORMAT, schemaVersion: 3 };
  if (appVersion !== undefined) out.appVersion = appVersion;
  else if (v2.appVersion !== undefined) out.appVersion = v2.appVersion;
  return { ...out, createdAt: v2.createdAt, savedAt: v2.savedAt, project: structuredClone(v2.project), findings, images: v2.images.map((im) => ({ ...im })) };
}

/** Schema v4 empty project: Draft, status shown
 * in key facts only, Contents first and disabled, References last and enabled. */
export function createEmptyProjectV4(now = new Date()) {
  const p = createEmptyProjectV3(now);
  p.schemaVersion = 4;
  const q = p.project;
  q.engagementStatus = 'draft';
  q.findingStatusDisplay = { keyFacts: true, summaryColumn: false, counts: false };
  q.sections.report.unshift({ key: 'contents', label: 'Contents', enabled: false });
  q.sections.finding.push({ key: 'references', label: 'References', enabled: true });
  q.labels.status = 'Status';
  q.labels.statusNotSet = 'Not set';
  return p;
}

/**
 * Converts a validated schema v3 project to schema v4 without changing any content
 * (notes section 3). Status is never guessed: findings and the engagement get null (Not
 * set), status display is off, Contents is appended disabled and References appended
 * enabled. No text is parsed or moved, so converting alone adds nothing to the report.
 */
export function migrateV3toV4(v3, { appVersion } = {}) {
  const project = structuredClone(v3.project);
  project.engagementStatus = null;
  project.findingStatusDisplay = { keyFacts: false, summaryColumn: false, counts: false };
  project.sections.report.push({ key: 'contents', label: 'Contents', enabled: false });
  project.sections.finding.push({ key: 'references', label: 'References', enabled: true });
  project.labels.status = 'Status';
  project.labels.statusNotSet = 'Not set';
  const findings = v3.findings.map((f) => ({ ...structuredClone(f), status: null }));
  const out = { format: FORMAT, schemaVersion: 4 };
  if (appVersion !== undefined) out.appVersion = appVersion;
  else if (v3.appVersion !== undefined) out.appVersion = v3.appVersion;
  return { ...out, createdAt: v3.createdAt, savedAt: v3.savedAt, project, findings, images: v3.images.map((im) => ({ ...im })) };
}

/** Schema v5 empty project: v4 plus the "How findings are rated" section, disabled, placed
 * before the findings summary, with empty text (the editor fills it only when asked). */
export function createEmptyProjectV5(now = new Date()) {
  const p = createEmptyProjectV4(now);
  p.schemaVersion = 5;
  const list = p.project.sections.report;
  list.splice(list.findIndex((x) => x.key === 'findingsSummary'), 0, { key: 'ratingMethod', label: RATING_METHOD_LABEL, enabled: false });
  p.project.ratingMethod = { text: '' };
  return p;
}
export const RATING_METHOD_LABEL = 'How findings are rated';

/** Converts a validated schema v4 project to v5 without changing any content: the rating
 * explanation is appended disabled with empty text, so converting adds nothing to the report. */
export function migrateV4toV5(v4, { appVersion } = {}) {
  const project = structuredClone(v4.project);
  project.sections.report.push({ key: 'ratingMethod', label: RATING_METHOD_LABEL, enabled: false });
  project.ratingMethod = { text: '' };
  const out = { format: FORMAT, schemaVersion: 5 };
  if (appVersion !== undefined) out.appVersion = appVersion;
  else if (v4.appVersion !== undefined) out.appVersion = v4.appVersion;
  return { ...out, createdAt: v4.createdAt, savedAt: v4.savedAt, project, findings: structuredClone(v4.findings), images: v4.images.map((im) => ({ ...im })) };
}

const V6_LABELS = Object.freeze({ cwe: 'CWE', vulnerabilityType: 'Vulnerability type', classification: 'Classification' });

/** Schema v6 empty project: v5 with no custom sections, classification shown in key facts
 * only, and the three new labels. */
export function createEmptyProjectV6(now = new Date()) {
  const p = createEmptyProjectV5(now);
  p.schemaVersion = 6;
  p.project.customSections = [];
  p.project.classificationDisplay = { keyFacts: true, summaryColumn: false };
  Object.assign(p.project.labels, V6_LABELS);
  return p;
}

/** Converts a validated schema v5 project to v6 without changing any content: no custom
 * sections (no report row is added), the display defaults, the new labels, and empty
 * classification values on every finding. */
export function migrateV5toV6(v5, { appVersion } = {}) {
  const project = structuredClone(v5.project);
  project.customSections = [];
  project.classificationDisplay = { keyFacts: true, summaryColumn: false };
  Object.assign(project.labels, V6_LABELS);
  const findings = v5.findings.map((f) => ({ ...structuredClone(f), cwe: '', vulnerabilityType: '' }));
  const out = { format: FORMAT, schemaVersion: 6 };
  if (appVersion !== undefined) out.appVersion = appVersion;
  else if (v5.appVersion !== undefined) out.appVersion = v5.appVersion;
  return { ...out, createdAt: v5.createdAt, savedAt: v5.savedAt, project, findings, images: v5.images.map((im) => ({ ...im })) };
}

/** Schema v7 empty project: v6 with the report scored in CVSS 3.1 until the tester chooses
 * CVSS 4.0. The score label keeps its v6 default; its version number follows the report. */
export function createEmptyProjectV7(now = new Date()) {
  const p = createEmptyProjectV6(now);
  p.schemaVersion = 7;
  p.project.scoring.cvssVersion = '3.1';
  return p;
}

/** Converts a validated schema v6 project to v7 without changing any content: the report uses
 * CVSS 3.1, which every v6 vector already is, and labels and vectors stay as they are. */
export function migrateV6toV7(v6, { appVersion } = {}) {
  const project = structuredClone(v6.project);
  project.scoring.cvssVersion = '3.1';
  const out = { format: FORMAT, schemaVersion: 7 };
  if (appVersion !== undefined) out.appVersion = appVersion;
  else if (v6.appVersion !== undefined) out.appVersion = v6.appVersion;
  return { ...out, createdAt: v6.createdAt, savedAt: v6.savedAt, project, findings: v6.findings.map((f) => structuredClone(f)), images: v6.images.map((im) => ({ ...im })) };
}

/** Schema v8 empty project: v7 with the larger report limits. */
export function createEmptyProjectV8(now = new Date()) {
  const p = createEmptyProjectV7(now);
  p.schemaVersion = 8;
  return p;
}

/** Converts a validated schema v7 project to v8 without changing any content: only the limits
 * a v8 file is checked against are larger. */
export function migrateV7toV8(v7, { appVersion } = {}) {
  const out = { format: FORMAT, schemaVersion: 8 };
  if (appVersion !== undefined) out.appVersion = appVersion;
  else if (v7.appVersion !== undefined) out.appVersion = v7.appVersion;
  return { ...out, createdAt: v7.createdAt, savedAt: v7.savedAt, project: structuredClone(v7.project), findings: v7.findings.map((f) => structuredClone(f)), images: v7.images.map((im) => ({ ...im })) };
}

/** At most `max` UTF-16 units, never splitting a surrogate pair (the validators' length rule). */
export function capUnits(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** Errors for a CWE value ('' is valid): exactly CWE- and 1-5 digits, nothing else. */
export function cweErrors(value) {
  if (typeof value !== 'string') return ['must be text'];
  return value === '' || CWE_ID.test(value) ? [] : ['must look like CWE-79 (CWE, a hyphen and up to 5 digits), or be empty'];
}
/** Errors for a vulnerability type: one trimmed line of at most 120 units, Word-safe. */
export function vulnerabilityTypeErrors(value) {
  if (typeof value !== 'string') return ['must be text'];
  const errors = [];
  if (value.length > CUSTOM_LIMITS.vulnerabilityType) errors.push(`longer than ${CUSTOM_LIMITS.vulnerabilityType} characters`);
  if (/[\r\n]/.test(value)) errors.push('must be a single line');
  if (value !== value.trim()) errors.push('must not start or end with spaces');
  if (XML_INVALID.test(value)) errors.push('contains characters that cannot be written to Word');
  return errors;
}
/** Errors for a custom section title: one trimmed, non-blank line of 1-80 units, Word-safe. */
export function customTitleErrors(value) {
  if (typeof value !== 'string') return ['must be text'];
  const errors = [];
  if (!/\S/.test(value)) errors.push('must not be empty');
  else if (value !== value.trim()) errors.push('must not start or end with spaces');
  if (value.length > CUSTOM_LIMITS.title) errors.push(`longer than ${CUSTOM_LIMITS.title} characters`);
  if (/[\r\n]/.test(value)) errors.push('must be a single line');
  if (XML_INVALID.test(value)) errors.push('contains characters that cannot be written to Word');
  return errors;
}

// ---- references (v4 rule 18) ----

const URL_FORBIDDEN = /[\s\u0000-\u001F\u007F]/;

/** Errors for one reference URL ('' is valid): absolute http(s), a host, no credentials,
 * no whitespace or controls, at most 2048 UTF-16 units. Never fetched or rewritten. */
export function referenceUrlErrors(url) {
  if (url === '') return [];
  if (typeof url !== 'string') return ['must be text'];
  const errors = [];
  if (url.length > REFERENCE_LIMITS.url) errors.push(`longer than ${REFERENCE_LIMITS.url} characters`);
  if (URL_FORBIDDEN.test(url)) errors.push('must not contain spaces or control characters');
  if (XML_INVALID.test(url)) errors.push('contains characters that cannot be written to Word');
  let u = null;
  try { u = new URL(url); } catch { /* reported below */ }
  if (!/^https?:\/\//i.test(url) || !u || (u.protocol !== 'http:' && u.protocol !== 'https:')) errors.push('must be a full http:// or https:// address, or empty');
  else {
    if (!u.hostname) errors.push('must name a host');
    if (u.username || u.password) errors.push('must not contain a user name or password');
  }
  return errors;
}

/** Errors for one reference title: one line, not blank, already trimmed, <= 300 units. */
export function referenceTitleErrors(title) {
  if (typeof title !== 'string') return ['must be text'];
  const errors = [];
  if (!/\S/.test(title)) errors.push('must not be empty');
  else if (title !== title.trim()) errors.push('must not start or end with spaces');
  if (title.length > REFERENCE_LIMITS.title) errors.push(`longer than ${REFERENCE_LIMITS.title} characters`);
  if (XML_INVALID.test(title)) errors.push('contains characters that cannot be written to Word');
  if (/[\r\n]/.test(title)) errors.push('must be a single line');
  return errors;
}

/** Validates a references list (rule 18), calling err(path, message) for each problem.
 * Shared by project v4, library v2 and the editor, including the XML 1.0 text rule. */
export function validateReferences(refs, path, err) {
  if (!Array.isArray(refs) || refs.length > REFERENCE_LIMITS.perFinding) return err(path, `must be a list of at most ${REFERENCE_LIMITS.perFinding}`);
  let units = 0;
  refs.forEach((r, i) => {
    const at = `${path}[${i}]`;
    if (!isObject(r)) return err(at, 'must be an object');
    for (const k of Object.keys(r)) if (k !== 'title' && k !== 'url') err(at, `unknown field "${k}"`);
    if (r.title === undefined) err(`${at}.title`, 'missing');
    else for (const m of referenceTitleErrors(r.title)) err(`${at}.title`, m);
    if (r.url === undefined) err(`${at}.url`, 'missing');
    else for (const m of referenceUrlErrors(r.url)) err(`${at}.url`, m);
    if (typeof r.title === 'string') units += r.title.length;
    if (typeof r.url === 'string') units += r.url.length;
  });
  if (units > REFERENCE_LIMITS.units) err(path, `titles and addresses total ${units} characters; the limit is ${REFERENCE_LIMITS.units}`);
}

// ---- visible finding IDs (v2 rule 14) ----

/** Returns the trimmed prefix if it is valid (1-40 characters, single line, no tab,
 * XML-valid), else null. Never truncates. */
export function validPrefix(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t.length >= 1 && t.length <= LIMITS.prefix && !/[\r\n\t]/.test(t) && !XML_INVALID.test(t) ? t : null;
}
export const resolveFindingPrefix = (meta) => validPrefix(meta.findingPrefix) ?? validPrefix(meta.engagementId) ?? 'F';

// ---- size ----

const SAVED_AT_PLACEHOLDER = '2000-01-01T00:00:00.000Z';
/** Exact UTF-8 size of the file the app saves for `data`, with savedAt measured at the
 * fixed ISO length the app writes. Image data URLs are ASCII with nothing to escape, so
 * they are counted by length instead of being encoded again. */
export function savedSize(data) {
  let images = 0;
  const text = JSON.stringify({ ...data, savedAt: SAVED_AT_PLACEHOLDER }, (k, v) => {
    if (k === 'dataUrl' && typeof v === 'string') { images += v.length; return ''; }
    return v;
  });
  return new TextEncoder().encode(text).length + images;
}

export const findingId = (n) => `F-${String(n).padStart(3, '0')}`;
export const imageId = (n) => `IMG-${String(n).padStart(4, '0')}`;

/** Decodes standard base64 to bytes without relying on Buffer (runs in the browser). */
export function base64ToBytes(b64) {
  // The built-in decoder where there is one (same result as atob, several times faster).
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(b64);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export async function sha256Hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Checks PNG or JPEG container structure and reads the pixel size.
 * PNG: IHDR first, at least one IDAT, IEND last, every chunk inside the file.
 * JPEG: a frame header before the first scan, and an EOI marker after it.
 * Returns { mime, width, height } or null. This is structural only: it does not
 * prove the pixel data decodes, which the app checks with decodeImageInBrowser.
 */
export function sniffImage(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    let i = 8, size = null, idat = false;
    while (i + 12 <= bytes.length) {
      const len = dv.getUint32(i);
      const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
      if (i + 12 + len > bytes.length) return null;
      if (size === null) {
        if (type !== 'IHDR' || len !== 13) return null;
        size = { mime: 'image/png', width: dv.getUint32(i + 8), height: dv.getUint32(i + 12) };
      } else if (type === 'IDAT' && len > 0) {
        idat = true;
      } else if (type === 'IEND') {
        return idat && i + 12 === bytes.length ? size : null;
      }
      i += 12 + len;
    }
    return null;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let i = 2, size = null;
    while (i + 4 <= bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      if (marker === 0xd8 || marker === 0xd9) return null;
      const len = dv.getUint16(i + 2);
      if (len < 2 || i + 2 + len > bytes.length) return null;
      // SOF0-SOF15 except DHT, JPG and DAC (CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (len < 8) return null;
        size = { mime: 'image/jpeg', width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) };
      }
      if (marker === 0xda) {
        // Entropy-coded data follows; require an EOI somewhere after the scan header.
        const scanEnd = i + 2 + len;
        for (let j = bytes.length - 2; j > scanEnd; j--) {
          if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) return size;
        }
        return null;
      }
      i += 2 + len;
    }
  }
  return null;
}

/**
 * Fully decodes image bytes in the browser and returns { width, height }, or throws.
 * The app passes this as validateProjectFile's decodeImage option and uses it for
 * every pasted or chosen file, so nothing undecodable reaches the project.
 */
export async function decodeImageInBrowser(bytes, mime) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/**
 * Validates an imported project file in its own schema version (1, 2 or 3) and returns it
 * unchanged. `raw` is the file text; `rawBytes` its UTF-8 size.
 * Returns { ok: true, project } or { ok: false, errors: [...] }. Never mutates app state.
 * `decodeImage(bytes, mime)` must resolve to { width, height } or throw; the browser app
 * passes decodeImageInBrowser. Without it (Node), image checks are structural only.
 * The app opens files with openProjectFile, which also migrates v1 and v2.
 */
export async function validateProjectFile(raw, rawBytes, { decodeImage } = {}) {
  const parsed = parseProjectFile(raw, rawBytes);
  if (!parsed.ok) return parsed;
  return validateProjectData(parsed.data, { decodeImage });
}

/** Validates a native schema v4 file in full (every image included) and refuses any other
 * version (used by the fixtures and the exporter tests). */
export async function validateProjectFileV4(raw, rawBytes, { decodeImage } = {}) {
  if (rawBytes > LIMITS_V7.fileBytes) return fileTooLarge(rawBytes, LIMITS_V7.fileBytes);
  let data;
  try { data = JSON.parse(raw); } catch { return { ok: false, errors: ['File is not valid JSON.'] }; }
  if (!isObject(data) || data.format !== FORMAT) return { ok: false, errors: ['Not a project file (missing format marker).'] };
  if (data.schemaVersion !== 4) return { ok: false, errors: ['Not a schema v4 project file.'] };
  return validateProjectData(data, { decodeImage });
}

/** Validates a native schema v7 file in full and refuses any other version. */
export async function validateProjectFileV7(raw, rawBytes, { decodeImage } = {}) {
  if (rawBytes > LIMITS_V7.fileBytes) return fileTooLarge(rawBytes, LIMITS_V7.fileBytes);
  let data;
  try { data = JSON.parse(raw); } catch { return { ok: false, errors: ['File is not valid JSON.'] }; }
  if (!isObject(data) || data.format !== FORMAT) return { ok: false, errors: ['Not a project file (missing format marker).'] };
  if (data.schemaVersion !== 7) return { ok: false, errors: ['Not a schema v7 project file.'] };
  return validateProjectData(data, { decodeImage });
}

/** Validates a native schema v8 file in full and refuses any other version. */
export async function validateProjectFileV8(raw, rawBytes, { decodeImage } = {}) {
  if (rawBytes > LIMITS_V8.fileBytes) return fileTooLarge(rawBytes, LIMITS_V8.fileBytes);
  let data;
  try { data = JSON.parse(raw); } catch { return { ok: false, errors: ['File is not valid JSON.'] }; }
  if (!isObject(data) || data.format !== FORMAT) return { ok: false, errors: ['Not a project file (missing format marker).'] };
  if (data.schemaVersion !== 8) return { ok: false, errors: ['Not a schema v8 project file.'] };
  return validateProjectData(data, { decodeImage });
}

/** Validates a native schema v6 file in full and refuses any other version. */
export async function validateProjectFileV6(raw, rawBytes, { decodeImage } = {}) {
  if (rawBytes > LIMITS_V7.fileBytes) return fileTooLarge(rawBytes, LIMITS_V7.fileBytes);
  let data;
  try { data = JSON.parse(raw); } catch { return { ok: false, errors: ['File is not valid JSON.'] }; }
  if (!isObject(data) || data.format !== FORMAT) return { ok: false, errors: ['Not a project file (missing format marker).'] };
  if (data.schemaVersion !== 6) return { ok: false, errors: ['Not a schema v6 project file.'] };
  return validateProjectData(data, { decodeImage });
}

/** Validates a native schema v5 file in full and refuses any other version. */
export async function validateProjectFileV5(raw, rawBytes, { decodeImage } = {}) {
  if (rawBytes > LIMITS_V7.fileBytes) return fileTooLarge(rawBytes, LIMITS_V7.fileBytes);
  let data;
  try { data = JSON.parse(raw); } catch { return { ok: false, errors: ['File is not valid JSON.'] }; }
  if (!isObject(data) || data.format !== FORMAT) return { ok: false, errors: ['Not a project file (missing format marker).'] };
  if (data.schemaVersion !== 5) return { ok: false, errors: ['Not a schema v5 project file.'] };
  return validateProjectData(data, { decodeImage });
}

/**
 * Opens a project file for editing: validates it in its own version, converts v1 to v6
 * on to v7, and reports whether the converted project is over the 25 MB budget.
 * Returns { ok: false, errors, newer? } or
 * { ok: true, project, migratedFrom: 1 | 2 | 3 | 4 | 5 | 6 | null, overBudgetBytes }.
 * overBudgetBytes > 0 happens only for a converted v1-v6 file that was within the
 * limit before conversion (v4 rule 7 recovery state). A v7 file is refused if the file
 * this app would save for it (with this appVersion and its savedAt format) exceeds the
 * limit, even when the raw file fits, so an opened v7 project can always be saved again.
 */
/** Removes hidden metadata from every screenshot of an opened project. Images in older
 * project files were kept byte for byte, so re-saved projects and Chrome/Edge PDFs would
 * carry it. Returns the number cleaned, or an error when one cannot be checked. */
async function cleanProjectImages(project) {
  let cleaned = 0;
  for (const im of project.images) {
    const bytes = base64ToBytes(parseImageDataUrl(im.dataUrl).base64);
    const clean = stripImageMetadata(bytes, im.mime);
    if (!clean) return { error: `${im.id}: the screenshot could not be checked for hidden data. Add it again from the original file.` };
    if (clean === bytes) continue;
    im.dataUrl = `data:${im.mime};base64,${bytesToBase64(clean)}`;
    im.bytes = clean.length;
    im.sha256 = await sha256Hex(clean);
    cleaned++;
  }
  return { cleaned };
}

export async function openProjectFile(raw, rawBytes, { appVersion, decodeImage, onProgress } = {}) {
  const parsed = parseProjectFile(raw, rawBytes);
  if (!parsed.ok) return parsed;
  const checked = await validateProjectData(parsed.data, { decodeImage, onProgress });
  if (!checked.ok) return checked;
  const from = checked.project.schemaVersion;
  const images = await cleanProjectImages(checked.project);
  if (images.error) return { ok: false, errors: [images.error] };
  const cleanedImages = images.cleaned;
  if (from === SCHEMA_VERSION) {
    const size = savedSize(appVersion === undefined ? checked.project : { ...checked.project, appVersion });
    if (size > LIMITS.fileBytes) {
      return { ok: false, errors: [`Saved by this version the project would be ${size} bytes; the limit is ${LIMITS.fileBytes} (${megabytes(LIMITS.fileBytes)}).`] };
    }
    return { ok: true, project: checked.project, migratedFrom: null, overBudgetBytes: 0, cleanedImages };
  }
  const v2 = from === 1 ? migrateV1toV2(checked.project, { appVersion }) : checked.project;
  const v3 = from <= 2 ? migrateV2toV3(v2, { appVersion }) : checked.project;
  const v4 = from <= 3 ? migrateV3toV4(v3, { appVersion }) : checked.project;
  const v5 = from <= 4 ? migrateV4toV5(v4, { appVersion }) : checked.project;
  const v6 = from <= 5 ? migrateV5toV6(v5, { appVersion }) : checked.project;
  const v7 = from <= 6 ? migrateV6toV7(v6, { appVersion }) : checked.project;
  const project = migrateV7toV8(v7, { appVersion });
  // Images were fully checked in the file's own version; the v8 pass checks only the
  // converted structure. skipImageData is internal and cannot be set by callers or files.
  const again = await validateProjectData(project, { skipImageData: true });
  if (!again.ok) return { ok: false, errors: ['The file could not be converted to the current format.', ...again.errors] };
  return { ok: true, project, migratedFrom: from, overBudgetBytes: Math.max(0, savedSize(project) - LIMITS.fileBytes), cleanedImages };
}

function parseProjectFile(raw, rawBytes) {
  // Before parsing, the largest cap of any version; after, the cap of the file's own version,
  // so an older file never becomes valid just because it could convert to a larger format.
  if (rawBytes > LIMITS_V8.fileBytes) return fileTooLarge(rawBytes, LIMITS_V8.fileBytes);
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ['File is not valid JSON.'] };
  }
  if (!isObject(data) || data.format !== FORMAT) {
    return { ok: false, errors: ['Not a project file (missing format marker).'] };
  }
  if (Number.isInteger(data.schemaVersion) && data.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, errors: [`File was saved by a newer version (schema ${data.schemaVersion}); this build reads schema ${SCHEMA_VERSION}.`], newer: true };
  }
  const own = limitsForVersion(data.schemaVersion);
  if (own && rawBytes > own.fileBytes) return fileTooLarge(rawBytes, own.fileBytes);
  return { ok: true, data };
}

async function validateProjectData(data, { decodeImage, skipImageData = false, onProgress } = {}) {
  const errors = [];
  const v = data.schemaVersion;
  const L = limitsForVersion(v);
  if (!L) return { ok: false, errors: ['Unsupported schemaVersion.'] };

  // At most 100 messages (5 are shown): a hostile file with millions of bad entries must not
  // build millions of strings.
  // `failures` counts every error, also past the 100 kept: an image is decoded only when its own
  // checks added none, which the capped list cannot tell once it is full.
  let failures = 0;
  const err = (path, msg) => { failures++; if (errors.length < 100) errors.push(`${path}: ${msg}`); };
  const checkKeys = (obj, allowed, path) => {
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) err(path, `unknown field "${k}"`);
  };
  const line = (val, path, required) => {
    if (val === undefined) { if (required) err(path, 'missing'); return; }
    if (typeof val !== 'string') return err(path, 'must be text');
    if (val.length > LIMITS.line) err(path, `longer than ${LIMITS.line} characters`);
    if (/[\r\n]/.test(val)) err(path, 'must be a single line');
  };
  const text = (val, path) => {
    if (val === undefined) return;
    if (typeof val !== 'string') return err(path, 'must be text');
    if (val.length > LIMITS.text) err(path, `longer than ${LIMITS.text} characters`);
  };
  const label = (val, path) => {
    if (typeof val !== 'string') return err(path, 'must be text');
    if (val.length > LIMITS.label) err(path, `longer than ${LIMITS.label} characters`);
    if (/[\r\n]/.test(val)) err(path, 'must be a single line');
    if (!/\S/.test(val)) err(path, 'must not be empty');
  };
  const bool = (val, path) => { if (typeof val !== 'boolean') err(path, 'must be true or false'); };
  // Checks an object with exactly `keys` (all required); false if it is not an object.
  const object = (val, path, keys) => {
    if (!isObject(val)) { err(path, 'missing'); return false; }
    checkKeys(val, keys, path);
    for (const k of keys) if (val[k] === undefined) err(`${path}.${k}`, 'missing');
    return true;
  };

  checkKeys(data, ['format', 'schemaVersion', 'appVersion', 'createdAt', 'savedAt', 'project', 'findings', 'images'], 'file');
  if (data.appVersion !== undefined && (typeof data.appVersion !== 'string' || data.appVersion.length > 32)) err('appVersion', 'invalid');
  for (const k of ['createdAt', 'savedAt']) {
    if (typeof data[k] !== 'string' || !DATE_TIME.test(data[k])) err(k, 'must be an ISO date-time');
  }

  const p = data.project;
  const logos = new Map(); // logo role -> image id
  if (!isObject(p)) {
    err('project', 'missing');
  } else {
    checkKeys(p, v === 1 ? PROJECT_KEYS_V1 : v >= 6 ? PROJECT_KEYS_V6 : v === 5 ? PROJECT_KEYS_V5 : v === 4 ? PROJECT_KEYS_V4 : PROJECT_KEYS_V2, 'project');
    line(p.title, 'project.title', true);
    for (const k of ['client', 'testerName', 'organisation', 'classification']) line(p[k], `project.${k}`);
    if (p.reportVersion !== undefined && (typeof p.reportVersion !== 'string' || p.reportVersion.length > 32)) err('project.reportVersion', 'invalid');
    for (const k of ['startDate', 'endDate', 'reportDate']) {
      if (p[k] !== undefined && (typeof p[k] !== 'string' || !DATE.test(p[k]))) err(`project.${k}`, 'must be YYYY-MM-DD or empty');
    }
    text(p.scope, 'project.scope');
    text(p.executiveSummary, 'project.executiveSummary');
    if (p.paperSize !== 'A4' && p.paperSize !== 'Letter') err('project.paperSize', 'must be A4 or Letter');
    if (p.accentColor !== undefined && (typeof p.accentColor !== 'string' || !COLOR.test(p.accentColor))) err('project.accentColor', 'must be #RRGGBB');
    if (!Number.isInteger(p.nextFindingNumber) || p.nextFindingNumber < 1 || p.nextFindingNumber > 999) err('project.nextFindingNumber', 'must be 1-999');
    if (!Number.isInteger(p.nextImageNumber) || p.nextImageNumber < 1 || p.nextImageNumber > 9999) err('project.nextImageNumber', 'must be 1-9999');
    if (v === 1) {
      if (p.logoImageId !== undefined && p.logoImageId !== null && !(typeof p.logoImageId === 'string' && IMAGE_ID.test(p.logoImageId))) err('project.logoImageId', 'invalid image id');
      if (typeof p.logoImageId === 'string') logos.set('logo', p.logoImageId);
    } else {
      validateSettingsV2(p, { err, line, text, label, bool, object, logos, v });
    }
  }

  const findings = Array.isArray(data.findings) ? data.findings : (err('findings', 'must be a list'), []);
  const images = Array.isArray(data.images) ? data.images : (err('images', 'must be a list'), []);
  const maxImages = v === 1 ? V1_MAX_IMAGES : L.images;
  if (findings.length > L.findings) err('findings', `more than ${L.findings}`);
  if (images.length > maxImages) err('images', `more than ${maxImages}`);
  // Over the limit, the lists are not walked at all (a 24 MB file can hold 12 million entries).
  if (findings.length > L.findings || images.length > maxImages) return { ok: false, errors };

  const findingIds = new Set();
  const evidenceRefs = new Map();
  let evidenceCount = 0;
  let maxFinding = 0;
  findings.forEach((f, i) => {
    const path = `findings[${i}]`;
    if (!isObject(f)) return err(path, 'must be an object');
    checkKeys(f, v === 1 ? FINDING_KEYS_V1 : v >= 6 ? FINDING_KEYS_V6 : v >= 4 ? FINDING_KEYS_V4 : FINDING_KEYS_V2, path);
    if (typeof f.id !== 'string' || !FINDING_ID.test(f.id)) err(`${path}.id`, 'must look like F-001');
    else if (findingIds.has(f.id)) err(`${path}.id`, `duplicate ${f.id}`);
    else { findingIds.add(f.id); maxFinding = Math.max(maxFinding, Number(f.id.slice(2))); }
    line(f.title, `${path}.title`, true);
    if (v === 1) {
      if (!(f.severity === null || SEVERITIES.includes(f.severity))) err(`${path}.severity`, 'invalid severity');
      for (const k of ['description', 'reproduction', 'impact', 'recommendation']) text(f[k], `${path}.${k}`);
    } else {
      if (!(f.rating === null || SEVERITIES.includes(f.rating))) err(`${path}.rating`, 'invalid rating');
      // Versions 1-6 accept only CVSS 3.1; v7 also accepts a canonical CVSS 4.0 Base vector.
      if (!(f.cvss === null || (typeof f.cvss === 'string' && (CVSS31.test(f.cvss) || (v >= 7 && CVSS40.test(f.cvss)))))) {
        err(`${path}.cvss`, v >= 7 ? 'must be a canonical CVSS 3.1 or 4.0 Base vector, or empty' : 'must be a CVSS 3.1 Base vector (CVSS:3.1/AV:_/AC:_/PR:_/UI:_/S:_/C:_/I:_/A:_) or empty');
      }
      const formatKeys = v === 2 ? TEXT_SECTIONS : FORMAT_KEYS;
      for (const k of formatKeys) text(f[k], `${path}.${k}`);
      if (object(f.formats, `${path}.formats`, formatKeys)) {
        for (const k of formatKeys) if (f.formats[k] !== undefined && f.formats[k] !== 'plain' && f.formats[k] !== 'code') err(`${path}.formats.${k}`, 'must be plain or code');
      }
      if (v >= 3 && f.details !== undefined) validateDetailBlocks(f.details, `${path}.details`, err);
      if (v >= 4) {
        if (!Object.hasOwn(f, 'status')) err(`${path}.status`, 'missing');
        else if (!(f.status === null || FINDING_STATUSES.includes(f.status))) err(`${path}.status`, `must be one of ${FINDING_STATUSES.join(', ')} or null`);
        if (f.references !== undefined) validateReferences(f.references, `${path}.references`, err);
      }
      if (v >= 6) {
        if (f.cwe === undefined) err(`${path}.cwe`, 'missing');
        else for (const m of cweErrors(f.cwe)) err(`${path}.cwe`, m);
        if (f.vulnerabilityType === undefined) err(`${path}.vulnerabilityType`, 'missing');
        else for (const m of vulnerabilityTypeErrors(f.vulnerabilityType)) err(`${path}.vulnerabilityType`, m);
      }
    }
    if (f.affectedAssets !== undefined) {
      if (!Array.isArray(f.affectedAssets) || f.affectedAssets.length > LIMITS.assets) err(`${path}.affectedAssets`, `must be a list of at most ${LIMITS.assets}`);
      else f.affectedAssets.forEach((a, j) => line(a, `${path}.affectedAssets[${j}]`, true));
    }
    if (!Array.isArray(f.evidence)) return err(`${path}.evidence`, 'must be a list');
    if (f.evidence.length > L.evidence) return err(`${path}.evidence`, `more than ${L.evidence}`);
    f.evidence.forEach((id, j) => { if (typeof id !== 'string' || !IMAGE_ID.test(id)) err(`${path}.evidence[${j}]`, 'invalid image id'); });
    // Rule 6/8: gallery entries and (v3) image blocks are one pool of screenshot references.
    for (const ref of (v >= 3 ? screenshotRefs(f) : f.evidence.map((imageId) => ({ imageId })))) {
      if (typeof ref.imageId !== 'string' || !IMAGE_ID.test(ref.imageId)) continue;
      evidenceCount++;
      evidenceRefs.set(ref.imageId, (evidenceRefs.get(ref.imageId) || 0) + 1);
    }
  });
  if (evidenceCount > L.evidence) err('findings', `${evidenceCount} screenshot references; the limit is ${L.evidence}`);

  const imageIds = new Set();
  let maxImage = 0;
  // Screenshots are decoded a few at a time (the browser decodes off the main thread); at most
  // four are in flight, so only their bytes are held.
  const decoding = new Set();
  const decodeOne = async (path, bytes, mime, sniff) => {
    try {
      const d = await decodeImage(bytes, mime);
      if (d.width !== sniff.width || d.height !== sniff.height) err(path, 'decoded size does not match the image header');
    } catch {
      err(path, 'image data cannot be decoded');
    }
  };
  for (let i = 0; i < images.length; i++) {
    onProgress?.(i + 1, images.length);
    const im = images[i];
    const path = `images[${i}]`;
    const failuresBefore = failures;
    if (!isObject(im)) { err(path, 'must be an object'); continue; }
    checkKeys(im, IMAGE_KEYS, path);
    if (typeof im.id !== 'string' || !IMAGE_ID.test(im.id)) err(`${path}.id`, 'must look like IMG-0001');
    else if (imageIds.has(im.id)) err(`${path}.id`, `duplicate ${im.id}`);
    else { imageIds.add(im.id); maxImage = Math.max(maxImage, Number(im.id.slice(4))); }
    line(im.caption, `${path}.caption`, true);
    if (v === 1 && im.tallMode !== 'fit' && im.tallMode !== 'split') err(`${path}.tallMode`, 'must be fit or split');
    if (v >= 2 && !['auto', 'fit', 'split'].includes(im.tallMode)) err(`${path}.tallMode`, 'must be auto, fit or split');
    if (im.originalName !== undefined && (typeof im.originalName !== 'string' || im.originalName.length > 255)) err(`${path}.originalName`, 'invalid');
    if (skipImageData) continue;
    if (im.mime !== 'image/png' && im.mime !== 'image/jpeg') { err(`${path}.mime`, 'must be image/png or image/jpeg'); continue; }
    const m = typeof im.dataUrl === 'string' ? parseImageDataUrl(im.dataUrl, Math.ceil(LIMITS.imageBytes / 3) * 4) : null;
    if (m?.tooLarge) { err(`${path}`, 'image larger than 2 MB'); continue; }
    if (!m) { err(`${path}.dataUrl`, 'must be a base64 PNG or JPEG data URL'); continue; }
    if (`image/${m.type}` !== im.mime) err(`${path}.dataUrl`, 'type does not match mime');
    let bytes;
    try { bytes = base64ToBytes(m.base64); } catch { err(`${path}.dataUrl`, 'invalid base64'); continue; }
    if (bytes.length > LIMITS.imageBytes) err(path, 'image larger than 2 MB');
    if (im.bytes !== bytes.length) err(`${path}.bytes`, 'does not match the image data');
    const sniff = sniffImage(bytes);
    if (!sniff || sniff.mime !== im.mime) { err(path, 'image data is not a valid ' + im.mime); continue; }
    if (sniff.width < 1 || sniff.height < 1 || sniff.width > LIMITS.imageSide || sniff.height > LIMITS.imageSide ||
        sniff.width * sniff.height > LIMITS.imagePixels) err(path, 'image header declares invalid or oversized dimensions');
    if (sniff.width !== im.width || sniff.height !== im.height) err(path, 'width/height do not match the image data');
    if (!Number.isInteger(im.width) || !Number.isInteger(im.height) || im.width < 1 || im.height < 1 ||
        im.width > LIMITS.imageSide || im.height > LIMITS.imageSide) err(path, 'invalid dimensions');
    else if (im.width * im.height > LIMITS.imagePixels) err(path, 'image larger than 16 megapixels');
    if (typeof im.sha256 !== 'string' || !SHA256.test(im.sha256)) err(`${path}.sha256`, 'invalid');
    else if (await sha256Hex(bytes) !== im.sha256) err(`${path}.sha256`, 'does not match the image data');
    // Decode only an image that passed every cheaper check, so a hostile header
    // cannot make the browser allocate a raster we already know is oversized.
    if (decodeImage && failures === failuresBefore) {
      const job = decodeOne(path, bytes, im.mime, sniff).finally(() => decoding.delete(job));
      decoding.add(job);
      if (decoding.size >= 4) await Promise.race(decoding);
    }
  }
  await Promise.all(decoding);

  // Rule 6. v1: every reference (evidence or logo) at most once. v2: evidence at most
  // once; the two logo roles may share an image but never use an evidence image.
  if (v === 1) {
    const references = new Map(evidenceRefs);
    for (const id of logos.values()) references.set(id, (references.get(id) || 0) + 1);
    for (const [id, n] of references) {
      if (!imageIds.has(id)) err('references', `${id} is referenced but not present`);
      if (n > 1) err('references', `${id} is used more than once`);
    }
    for (const id of imageIds) if (!references.has(id)) err('images', `${id} is not used by any finding or the logo`);
  } else {
    for (const [id, n] of evidenceRefs) {
      if (!imageIds.has(id)) err('references', `${id} is referenced but not present`);
      if (n > 1) err('references', `${id} is used more than once`);
    }
    for (const [role, id] of logos) {
      if (!imageIds.has(id)) err(`project.branding.${role}`, `${id} is referenced but not present`);
      if (evidenceRefs.has(id)) err(`project.branding.${role}`, `${id} is also used as a screenshot`);
    }
    const logoIds = new Set(logos.values());
    for (const id of imageIds) if (!evidenceRefs.has(id) && !logoIds.has(id)) err('images', `${id} is not used by any finding or logo`);
  }

  if (isObject(p)) {
    if (Number.isInteger(p.nextFindingNumber) && p.nextFindingNumber <= maxFinding) err('project.nextFindingNumber', 'must be greater than the highest finding id');
    if (Number.isInteger(p.nextImageNumber) && p.nextImageNumber <= maxImage) err('project.nextImageNumber', 'must be greater than the highest image id');
  }

  const bad = findXmlInvalid(data);
  if (bad) err(bad, 'contains characters that cannot be written to Word (control characters or broken Unicode)');

  return failures ? { ok: false, errors } : { ok: true, project: data };
}

// v3 rule 16: at most 100 blocks, unique ids, summed text within the old details bound.
function validateDetailBlocks(blocks, path, err) {
  if (!Array.isArray(blocks) || blocks.length > LIMITS.detailBlocks) return err(path, `must be a list of at most ${LIMITS.detailBlocks} blocks`);
  const ids = new Set();
  let total = 0;
  blocks.forEach((b, i) => {
    const at = `${path}[${i}]`;
    if (!isObject(b)) return err(at, 'must be an object');
    if (typeof b.id !== 'string' || !BLOCK_ID.test(b.id)) err(`${at}.id`, 'must be 1-64 letters, digits, _ or -');
    else if (ids.has(b.id)) err(`${at}.id`, `duplicate ${b.id}`);
    else ids.add(b.id);
    if (b.type === 'text') {
      for (const k of Object.keys(b)) if (!['id', 'type', 'text', 'format'].includes(k)) err(at, `unknown field "${k}"`);
      if (typeof b.text !== 'string') err(`${at}.text`, 'must be text');
      else total += b.text.length;
      if (b.format !== 'plain' && b.format !== 'code') err(`${at}.format`, 'must be plain or code');
    } else if (b.type === 'image') {
      for (const k of Object.keys(b)) if (!['id', 'type', 'imageId'].includes(k)) err(at, `unknown field "${k}"`);
      if (typeof b.imageId !== 'string' || !IMAGE_ID.test(b.imageId)) err(`${at}.imageId`, 'invalid image id');
    } else err(`${at}.type`, 'must be text or image');
  });
  if (total > LIMITS.text) err(path, `text blocks total ${total} characters; the limit is ${LIMITS.text}`);
}

function validateSettingsV2(p, { err, line, text, label, bool, object, logos, v }) {
  const sources = v >= 4 ? ENGAGEMENT_SOURCES_V4 : ENGAGEMENT_SOURCES;
  const labelKeys = v >= 6 ? LABEL_KEYS_V6 : v >= 4 ? LABEL_KEYS_V4 : LABEL_KEYS;
  // v6: custom sections, each with exactly one report row whose label is its title.
  const customIds = new Set();
  if (v >= 6) {
    const list = p.customSections;
    if (!Array.isArray(list) || list.length > CUSTOM_LIMITS.sections) err('project.customSections', `must be a list of at most ${CUSTOM_LIMITS.sections}`);
    else list.forEach((c, i) => {
      const path = `project.customSections[${i}]`;
      if (!object(c, path, ['id', 'title', 'text', 'format'])) return;
      if (typeof c.id !== 'string' || !CUSTOM_SECTION_ID.test(c.id)) err(`${path}.id`, 'must be a letter then up to 23 letters, digits or _');
      else if (customIds.has(c.id)) err(`${path}.id`, `duplicate ${c.id}`);
      else customIds.add(c.id);
      if (c.title !== undefined) for (const m of customTitleErrors(c.title)) err(`${path}.title`, m);
      if (c.text !== undefined) { if (typeof c.text !== 'string') err(`${path}.text`, 'must be text'); else text(c.text, `${path}.text`); }
      if (c.format !== undefined && c.format !== 'plain' && c.format !== 'code') err(`${path}.format`, 'must be plain or code');
    });
    if (object(p.classificationDisplay, 'project.classificationDisplay', CLASSIFICATION_DISPLAY_KEYS)) {
      for (const k of CLASSIFICATION_DISPLAY_KEYS) if (p.classificationDisplay[k] !== undefined) bool(p.classificationDisplay[k], `project.classificationDisplay.${k}`);
    }
  }
  if (v >= 5 && object(p.ratingMethod, 'project.ratingMethod', ['text'])) {
    if (typeof p.ratingMethod.text !== 'string') err('project.ratingMethod.text', 'must be text');
    else text(p.ratingMethod.text, 'project.ratingMethod.text');
  }
  if (v >= 4) {
    if (!Object.hasOwn(p, 'engagementStatus')) err('project.engagementStatus', 'missing');
    else if (!(p.engagementStatus === null || ENGAGEMENT_STATUSES.includes(p.engagementStatus))) err('project.engagementStatus', `must be one of ${ENGAGEMENT_STATUSES.join(', ')} or null`);
    if (object(p.findingStatusDisplay, 'project.findingStatusDisplay', STATUS_DISPLAY_KEYS)) {
      for (const k of STATUS_DISPLAY_KEYS) if (p.findingStatusDisplay[k] !== undefined) bool(p.findingStatusDisplay[k], `project.findingStatusDisplay.${k}`);
    }
  }
  line(p.subtitle, 'project.subtitle');
  line(p.engagementId, 'project.engagementId', true);
  if (typeof p.findingPrefix !== 'string') err('project.findingPrefix', 'must be text');
  else if (p.findingPrefix.length > LIMITS.prefix || /[\r\n\t]/.test(p.findingPrefix)) err('project.findingPrefix', `must be one line of at most ${LIMITS.prefix} characters without tabs`);
  if (object(p.cover, 'project.cover', ['enabled'])) bool(p.cover.enabled, 'project.cover.enabled');
  if (object(p.branding, 'project.branding', ['testerLogo', 'clientLogo'])) {
    for (const role of ['testerLogo', 'clientLogo']) {
      const r = p.branding[role];
      const path = `project.branding.${role}`;
      if (!object(r, path, ['imageId', 'front', 'header', 'footer'])) continue;
      if (r.imageId !== null && !(typeof r.imageId === 'string' && IMAGE_ID.test(r.imageId))) err(`${path}.imageId`, 'invalid image id');
      else if (r.imageId !== null) logos.set(role, r.imageId);
      for (const k of ['front', 'header', 'footer']) if (r[k] !== undefined) bool(r[k], `${path}.${k}`);
    }
  }
  if (object(p.scoring, 'project.scoring', v >= 7 ? ['mode', 'cvssVersion'] : ['mode'])) {
    if (!SCORING_MODES.includes(p.scoring.mode)) err('project.scoring.mode', `must be one of ${SCORING_MODES.join(', ')}`);
    // v7: the CVSS version the report uses. Validation never rewrites stored vectors; a vector in
    // the other version is kept (to be rescored) and blocks a CVSS export until resolved.
    if (v >= 7 && !CVSS_VERSIONS.includes(p.scoring.cvssVersion)) err('project.scoring.cvssVersion', 'must be 3.1 or 4.0');
  }
  if (object(p.engagement, 'project.engagement', ['rows'])) {
    const rows = p.engagement.rows;
    if (!Array.isArray(rows) || rows.length > LIMITS.engagementRows) err('project.engagement.rows', `must be a list of at most ${LIMITS.engagementRows}`);
    else {
      const bound = new Set();
      rows.forEach((r, i) => {
        const path = `project.engagement.rows[${i}]`;
        if (!isObject(r)) return err(path, 'must be an object');
        if (!sources.includes(r.source)) return err(`${path}.source`, 'unknown source');
        object(r, path, r.source === 'custom' ? ['source', 'label', 'enabled', 'value', 'format'] : ['source', 'label', 'enabled']);
        if (r.label !== undefined) label(r.label, `${path}.label`);
        if (r.enabled !== undefined) bool(r.enabled, `${path}.enabled`);
        if (r.source === 'custom') {
          text(r.value, `${path}.value`);
          if (r.format !== undefined && r.format !== 'plain' && r.format !== 'code') err(`${path}.format`, 'must be plain or code');
        } else if (bound.has(r.source)) err(`${path}.source`, `${r.source} appears more than once`);
        else bound.add(r.source);
      });
    }
  }
  if (object(p.sections, 'project.sections', ['report', 'finding'])) {
    for (const [group, builtIn] of v >= 4 ? [['report', v >= 5 ? REPORT_SECTIONS_V5 : REPORT_SECTIONS_V4], ['finding', FINDING_SECTIONS_V4]] : [['report', REPORT_SECTIONS], ['finding', FINDING_SECTIONS]]) {
      // v6: the report order also lists one custom-<id> row per custom section.
      const custom = v >= 6 && group === 'report' && Array.isArray(p.customSections) ? p.customSections.filter((c) => isObject(c) && typeof c.id === 'string') : [];
      const keys = [...builtIn, ...custom.map((c) => customKey(c.id))];
      const list = p.sections[group];
      const path = `project.sections.${group}`;
      if (!Array.isArray(list) || list.length !== keys.length) { err(path, `must list each of ${keys.join(', ')} exactly once`); continue; }
      for (const c of custom) {
        const row = list.find((s) => isObject(s) && s.key === customKey(c.id));
        if (row && row.label !== c.title) err(`${path}`, `the row for custom section ${c.id} must be labelled with its title`);
      }
      const seen = new Set();
      list.forEach((s, i) => {
        if (!object(s, `${path}[${i}]`, ['key', 'label', 'enabled'])) return;
        if (!keys.includes(s.key) || seen.has(s.key)) err(`${path}[${i}].key`, `must list each of ${keys.join(', ')} exactly once`);
        seen.add(s.key);
        if (s.label !== undefined) label(s.label, `${path}[${i}].label`);
        if (s.enabled !== undefined) bool(s.enabled, `${path}[${i}].enabled`);
      });
    }
  }
  if (object(p.labels, 'project.labels', labelKeys)) {
    for (const k of labelKeys) if (p.labels[k] !== undefined) label(p.labels[k], `project.labels.${k}`);
  }
  if (p.backToSummaryLinks === undefined) err('project.backToSummaryLinks', 'missing');
  else bool(p.backToSummaryLinks, 'project.backToSummaryLinks');
}

// Iterative so deeply nested hostile JSON cannot overflow the call stack.
function findXmlInvalid(root) {
  const stack = [[root, 'file']];
  while (stack.length) {
    const [value, path] = stack.pop();
    if (typeof value === 'string') {
      if (XML_INVALID.test(value)) return path;
    } else if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) stack.push([value[i], `${path}[${i}]`]);
    } else if (isObject(value)) {
      const keys = Object.keys(value);
      for (let i = keys.length - 1; i >= 0; i--) {
        if (XML_INVALID.test(keys[i])) return path;
        stack.push([value[keys[i]], `${path}.${keys[i]}`]);
      }
    }
  }
  return null;
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ---- New report from settings ----

/** What "New report from settings" keeps and leaves behind, as shown to the user first. */
export const SETTINGS_KEPT = Object.freeze(['your name and organisation', 'paper size, colour and classification', 'cover on/off and your logo',
  'scoring mode and where finding status is shown', 'report layout (sections, order, names) and labels', 'engagement table rows (names only)',
  'the "How findings are rated" text', 'your own report sections (names and order; their text starts empty)', 'where CWE and vulnerability type are shown']);
export const SETTINGS_DROPPED = Object.freeze(['title, subtitle and client', 'engagement ID and finding prefix', 'dates, scope and executive summary',
  'engagement table values', 'the text of your own report sections', 'findings and screenshots', 'each finding\'s CWE and vulnerability type', 'the client logo', 'the engagement status (a new report starts as Draft)']);

/**
 * A new, empty v3 project that copies an allowlist of layout and branding settings from
 * `doc`, never client or finding text. The tester logo is copied as the only image.
 */
export function projectFromSettings(doc, now = new Date()) {
  const next = createEmptyProject(now);
  const from = doc.project;
  const to = next.project;
  for (const k of ['testerName', 'organisation', 'classification', 'paperSize', 'accentColor']) to[k] = from[k];
  to.cover = structuredClone(from.cover);
  to.scoring = structuredClone(from.scoring);
  to.findingStatusDisplay = structuredClone(from.findingStatusDisplay);
  to.sections = structuredClone(from.sections);
  to.labels = structuredClone(from.labels);
  to.backToSummaryLinks = from.backToSummaryLinks;
  // The rating explanation describes the tester's method, not the client: kept, and listed in SETTINGS_KEPT.
  if (from.ratingMethod) to.ratingMethod = structuredClone(from.ratingMethod);
  // Own sections are layout: names, order and format come along, but their text often names
  // the client (a conclusion, a retest plan), so it starts empty, like engagement row values.
  // Classification display is a layout preference; the findings' CWE and type never come along.
  if (from.customSections) to.customSections = from.customSections.map((c) => ({ ...c, text: '' }));
  if (from.classificationDisplay) to.classificationDisplay = structuredClone(from.classificationDisplay);
  to.engagement = { rows: from.engagement.rows.map((r) => (r.source === 'custom' ? { ...r, value: '' } : { ...r })) };
  const logo = from.branding.testerLogo;
  const image = logo.imageId && doc.images.find((im) => im.id === logo.imageId);
  if (image) {
    const id = imageId(to.nextImageNumber++);
    next.images.push({ ...structuredClone(image), id, caption: '' });
    to.branding.testerLogo = { ...logo, imageId: id };
  } else {
    to.branding.testerLogo = { ...logo, imageId: null };
  }
  return next;
}
