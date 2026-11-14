// Editor UI: report details, layout settings, findings, screenshots, save/open, checklist
// and export. All state lives in one project object that matches schema v2 at every
// moment (older files are converted on open).
// Async work (image decode, project validation, export) never writes to state it
// captured earlier: it re-reads the current project when it commits, and `generation`
// (bumped by New/Open) and `revision` (bumped by every edit) detect changes meanwhile.
import {
  createEmptyProject, openProjectFile, openProjectData, decodeImageInBrowser, sanitizeText, sanitizeLine, savedSize,
  findingId, imageId, resolveFindingPrefix, defaultFormats, screenshotRefs, textBlock, imageBlock, detailsTextLength,
  LIMITS, megabytes, SEVERITIES, SCORING_MODES, LABEL_KEYS_V6, projectFromSettings, SETTINGS_KEPT, SETTINGS_DROPPED,
  CUSTOM_LIMITS, customKey, newCustomSectionId, cweErrors, capUnits,
  FINDING_STATUSES, ENGAGEMENT_STATUSES, REFERENCE_LIMITS, referenceTitleErrors, referenceUrlErrors,
} from '../app/project.js';
import { h, icon, confirmDialog, choiceDialog, textDialog, downloadBytes, readFileBytes, setRuntimeStyle } from './dom.js';
import { createEmptyLibrary, openLibraryFile, checkLibrary, serializeLibrary, entryFromFinding, findingFromEntry, mergeLibraries, capEntryName, LIBRARY_LIMITS, LIBRARY_VERSION } from '../app/library.js';
import { STARTER_LIBRARY, countPrompts } from '../app/starter-library.js';
import { importImageBytes, imageFilesFrom, imageTooLarge } from './images.js';
import { editImage } from './redact.js';
import { scanHandle, scanFileList, projectSummary, planBatch, folderNameProblem } from './engagements.js';
import { findingsCsv } from '../app/csv.js';
import { checklist } from './checklist.js';
import { canPickSaveLocation, pickSaveFile, writeToHandle, saveErrorText } from './save.js';
import { parseCvss, cvssVersion, cvssLabel, cvssExportProblem, cvssSuggestions, switchedCvssLabel, reportCvssVersion, formatFindingStatus, formatEngagementStatus } from '../scoring/index.js';
import { createReportPlan, resolveEngagementValue } from '../export-docx/plan.js';
import { findingText } from '../app/finding-text.js';
import { reportMarkdown } from '../app/report-markdown.js';
import { defaultRatingMethodText } from '../app/rating-method.js';
import { ratingBadge, cvssBadge } from '../export-docx/design.js';
import { renderPreview } from './preview.js';
import { readDraftState, enableDrafts, disableDrafts, writeDraft, discardDraft, draftText, sameDraft } from './draft.js';
import { projectParts, partsToBlob, partsToProject, plainDataUrl } from '../app/serialize.js';

const DECODE_BATCH = 4;
const CVSS_METRICS = [
  ['AV', 'Attack vector', [['N', 'Network'], ['A', 'Adjacent'], ['L', 'Local'], ['P', 'Physical']]],
  ['AC', 'Attack complexity', [['L', 'Low'], ['H', 'High']]],
  ['PR', 'Privileges required', [['N', 'None'], ['L', 'Low'], ['H', 'High']]],
  ['UI', 'User interaction', [['N', 'None'], ['R', 'Required']]],
  ['S', 'Scope', [['U', 'Unchanged'], ['C', 'Changed']]],
  ['C', 'Confidentiality', [['N', 'None'], ['L', 'Low'], ['H', 'High']]],
  ['I', 'Integrity', [['N', 'None'], ['L', 'Low'], ['H', 'High']]],
  ['A', 'Availability', [['N', 'None'], ['L', 'Low'], ['H', 'High']]],
];
// CVSS 4.0 Base metrics in FIRST order (src/scoring/cvss40.js scores them).
const HLN = [['H', 'High'], ['L', 'Low'], ['N', 'None']];
const CVSS40_METRICS = [
  ['AV', 'Attack vector', [['N', 'Network'], ['A', 'Adjacent'], ['L', 'Local'], ['P', 'Physical']]],
  ['AC', 'Attack complexity', [['L', 'Low'], ['H', 'High']]],
  ['AT', 'Attack requirements', [['N', 'None'], ['P', 'Present']]],
  ['PR', 'Privileges required', [['N', 'None'], ['L', 'Low'], ['H', 'High']]],
  ['UI', 'User interaction', [['N', 'None'], ['P', 'Passive'], ['A', 'Active']]],
  ['VC', 'Vulnerable system confidentiality', HLN],
  ['VI', 'Vulnerable system integrity', HLN],
  ['VA', 'Vulnerable system availability', HLN],
  ['SC', 'Subsequent system confidentiality', HLN],
  ['SI', 'Subsequent system integrity', HLN],
  ['SA', 'Subsequent system availability', HLN],
];
const CVSS_EXAMPLE = { '3.1': 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', '4.0': 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N' };

const SCORING_MODE_TEXT = {
  severity: 'Severity', risk: 'Risk', cvss: 'CVSS Base', 'severity+cvss': 'Severity and CVSS Base', 'risk+cvss': 'Risk and CVSS Base',
};
const ENGAGEMENT_SOURCE_TEXT = {
  engagementId: 'Engagement ID', client: 'Client', testerName: 'Tester', organisation: 'Organisation',
  testingPeriod: 'Test start – end', reportVersion: 'Report version', reportDate: 'Report date', classification: 'Classification',
  engagementStatus: 'Engagement status',
};
const LABEL_TEXT = {
  findings: 'Findings chapter heading', idColumn: 'Summary: ID column', titleColumn: 'Summary: finding column',
  severity: 'Severity rating name', risk: 'Risk rating name', cvss: 'CVSS name', unscored: 'Unscored rating',
  figure: 'Figure caption word', part: 'Split screenshot: "part"', partOf: 'Split screenshot: "of"',
  page: 'Footer: "Page"', pageOf: 'Footer: "of"', backToSummary: 'Back-to-summary link',
  client: 'Cover: client caption', version: 'Cover: version caption', date: 'Cover: date caption',
  status: 'Finding status name', statusNotSet: 'Status not set',
  cwe: 'CWE name', vulnerabilityType: 'Vulnerability type name', classification: 'Summary: classification column',
};
// Reproduction scaffold: what triage guidance asks every finding to state. Newly
// written prompts; Check & export lists any left unfilled.
export const REPRO_PROMPTS = [
  'Conditions: [[account or role used, relevant settings, version or test date]]',
  '',
  '1. [[first step]]',
  '2. [[next step; add or remove steps as needed]]',
  '',
  'Expected: [[what should have happened]]',
  'Observed: [[what happened instead; the request or screenshot follows]]',
  '',
  'Not tested: [[what you did not try or could not confirm, or delete this paragraph]]',
].join('\n');
const SECTION_HELP = {
  executiveSummary: 'Edited in Details & cover.', engagement: 'Rows edited in Details & cover.', scope: 'Edited in Details & cover.',
  findingsSummary: 'Generated from the findings.', assets: '', description: '', details: '', impact: '', threat: '', recommendation: '', evidence: 'The screenshots of each finding.',
  ratingMethod: 'Edited in Details & cover.',
  contents: 'Always placed right after the cover. Linked list of the report sections and findings (no page numbers).', references: 'Titles and addresses, printed as text.',
};

export function createEditor(root, { exportDocx, appVersion, maxFindings = LIMITS.findings, edition = null }) {
  let doc = createEmptyProject();
  let view = 'start'; // first run: the start screen, until the user picks a way in
  // which setting groups the user has opened, and whether the engagement table
  // is being designed (names, order, rows) or filled in. Kept across redraws, not saved.
  const disclosed = new Set();
  let customizeRows = false;
  // The optional live page beside a finding. In memory only.
  let livePane = true;
  let liveTimer = null;
  let draftReady = false; // set once the recovery-draft section below has run
  // Finding library state (see the library section below).
  let library = createEmptyLibrary();
  let libraryDirty = false;
  let libraryHandle = null;
  // libraryGen changes when another library replaces this one; libraryRev on every edit.
  // A save clears "unsaved" only if neither changed while it was being written.
  let libraryGen = 0;
  let libraryRev = 0;
  let librarySaving = false;
  let libraryFilter = '';
  let libraryTab = 'mine'; // 'mine' or 'starter'
  const libraryLinks = new Map(); // finding id -> library entry id, for "Replace entry"
  let dirty = false;
  let generation = 0;
  let formatNotice = false; // the first save of a converted project says older versions cannot open it
  let revision = 0;
  let exporting = false;
  let opening = false;
  let saving = false;
  // Save-dialog handles, in memory only. projectHandle is the file the current project was
  // last saved to (Save writes there again); folderHint opens the next dialog in the
  // folder used last.
  let projectHandle = null;
  // Engagement folders (Engagements\Customer\Engagement\). The
  // chosen folder, in memory only, and the engagement the open project came from: with a
  // writable folder, Save and the exports go there.
  let engagementRoot = null; // { root, write, tree, summaries: Map(file -> summary), rest: [] }
  let engagement = null; // { customer, name, dir }
  let folderHint = null;
  // Set while a converted older file is over the project size limit: { name, bytes } of the
  // original file, which stays downloadable unchanged. Edits may only shrink the project,
  // and Save and Export are refused, until it fits.
  let recovery = null;

  // Visible status line (polite), plus a visually hidden assertive region that repeats
  // errors, because changing a live region's role on the fly is unreliable in readers.
  const status = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  // The status line is pinned under the header; the sticky nav and live page sit below it.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => document.documentElement.style.setProperty('--status-h', `${status.offsetHeight}px`)).observe(status);
  }
  const alertRegion = h('div', { class: 'sr-only', role: 'alert' });
  const dirtyBadge = h('span', { class: 'dirty', hidden: true }, 'Unsaved changes');
  // What the project file holds, in words that never overstate it: a
  // picker write that finished, a download the browser was asked for, or nothing yet.
  const fileState = h('span', { class: 'file-state', 'data-testid': 'file-state', hidden: true });
  let fileInfo = null; // { kind: 'saved' | 'opened' | 'download', at }
  const docTitle = h('span', { class: 'doc-title', 'data-testid': 'doc-title' });
  const crumbView = h('b', { class: 'crumb-view', 'data-testid': 'crumb-view' });
  // A view change moves keyboard focus to the new view's heading, never to the page body.
  const focusView = () => { const t = main.querySelector('h1') || main; t.tabIndex = -1; t.focus({ preventScroll: true }); };
  // On a phone (narrow(), below) every view change also closes the section list and starts at the top.
  const go = (key) => { view = key; const phone = narrow(); if (phone) navOpen = false; render(); if (phone) window.scrollTo(0, 0); focusView(); };
  const topPreview = h('button', { type: 'button', class: 'ghost', 'data-testid': 'top-preview', onclick: () => go('preview') }, icon('eye'), 'Preview report');
  const topExport = h('button', { type: 'button', 'data-testid': 'top-export', onclick: () => go('export') }, icon('check'), 'Check & export');
  const topActions = h('span', { class: 'top-actions' }, topPreview,
    h('button', { type: 'button', class: 'secondary', 'data-testid': 'save', onclick: () => saveProject() }, icon('file'), 'Save'),
    topExport);
  const nav = h('nav', { class: 'nav', id: 'report-nav', 'aria-label': 'Sections' });
  // Phones: the section list folds behind one button, and choosing
  // a section closes it and shows that section from its top.
  const narrow = () => window.matchMedia('(max-width: 760px), (max-height: 480px) and (max-width: 1000px)').matches; // same query as style.css
  let navOpen = false;
  const navToggle = h('button', { type: 'button', class: 'nav-toggle secondary', 'aria-controls': 'report-nav', 'aria-expanded': 'false', 'data-testid': 'nav-toggle',
    onclick: () => { navOpen = !navOpen; syncNav(); if (navOpen) (nav.querySelector('.navitem.active') || nav.querySelector('.navitem'))?.focus(); } });
  const syncNav = () => {
    nav.classList.toggle('open', navOpen);
    navToggle.setAttribute('aria-expanded', String(navOpen));
    navToggle.replaceChildren(h('span', {}, navOpen ? 'Close contents' : 'Report contents'), h('span', { class: 'nav-toggle-view' }, navOpen ? '' : VIEW_NAMES[view] ?? (doc.findings.find((f) => f.id === view)?.title || 'Finding')));
  };
  const main = h('main', { class: 'main' });
  const recoveryBanner = h('div', { class: 'recovery', role: 'region', 'aria-label': 'Size limit', hidden: true });
  const openInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'data-testid': 'open-input', onchange: onOpenFile });
  const live = h('aside', { class: 'live', 'aria-label': 'Live page', 'data-testid': 'live-pane', hidden: true });
  const layout = h('div', { class: 'layout' }, navToggle, nav, main, live);

  const topBar = h('header', { class: 'top' },
      h('strong', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), 'Rootnote', h('span', { class: 'brand-by' }, 'by Unravel Networks')),
      h('span', { class: 'crumb' }, docTitle, h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '·'), crumbView),
      edition ? h('span', { class: 'edition', title: `Limited to ${maxFindings} findings per project` }, `${edition} · ${maxFindings} findings`) : null,
      dirtyBadge,
      fileState,
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'ghost start-about', onclick: () => showNotices() }, 'About & licences'),
      topActions,
      moreMenu(),
      openInput);
  root.replaceChildren(
    topBar,
    recoveryBanner,
    status,
    alertRegion,
    layout);
  // The bar wraps on phones, so what sits under it follows its real height.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', `${topBar.offsetHeight}px`)).observe(topBar);
  }

  /** A labelled "⋯" disclosure of action buttons (not an ARIA menu, so no arrow-key contract). Each item is [label, onclick, attrs] or null. It opens
   * by click, Enter or Space, closes with Escape (focus returns to it) or a click outside. */
  function menuOf(name, testid, items) {
    const menu = h('details', { class: 'menu', 'data-testid': testid });
    const close = (focus = false) => { menu.open = false; if (focus) menu.querySelector('summary').focus(); };
    menu.append(
      h('summary', { class: 'iconbtn', 'aria-label': name, title: name }, h('span', { 'aria-hidden': 'true' }, '⋯')),
      h('div', { class: 'menu-list' }, ...items.filter(Boolean).map(([label, onclick, attrs = {}]) => attrs.href
        // A plain link (user navigation in a new tab); it carries nothing from the report.
        ? h('a', { class: 'menu-item', target: '_blank', rel: 'noopener noreferrer', ...attrs, onclick: () => close(true) }, label)
        : h('button', { type: 'button', class: 'menu-item', ...attrs, onclick: () => { close(true); onclick(); } }, label))));
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.open) { e.stopPropagation(); close(true); } });
    // Tabbing out of an open menu closes it.
    menu.addEventListener('focusout', (e) => { if (menu.open && e.relatedTarget && !menu.contains(e.relatedTarget)) close(); });
    return menu;
  }

  applyTheme(savedTheme());

  // One listener for every disclosure menu, so redraws add none: a click
  // outside an open menu closes it.
  document.addEventListener('click', (e) => {
    for (const m of root.querySelectorAll('details.menu[open]')) if (!m.contains(e.target)) m.open = false;
  });

  // Light, as in the agreed mockups, unless the user chose dark here. The choice is a display
  // preference kept in this browser only; it never goes into a project file.
  function savedTheme() { try { return localStorage.getItem('fieldnote-theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } }
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    root.querySelector('[data-testid=theme-toggle]')?.setAttribute('aria-pressed', String(t === 'dark'));
  }
  function toggleTheme() {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(t);
    try { localStorage.setItem('fieldnote-theme', t); } catch { /* the choice lasts until the page closes */ }
  }

  /** Secondary file actions and About, in one labelled menu. */
  function moreMenu() {
    return menuOf('More: new, open, save copies and about', 'more-menu', [
      ['New report', newProject, { 'data-testid': 'new-project' }],
      ['Open…', () => openInput.click(), { 'data-testid': 'open-project' }],
      // Download stays available beside the save dialog, because a browser can offer the
      // dialog and still block it (policy, permissions).
      canPickSaveLocation() ? ['Save as…', () => saveProject({ saveAs: true }), { 'data-testid': 'save-as' }] : null,
      canPickSaveLocation() ? ['Download project file', () => saveProject({ download: true }), { 'data-testid': 'download-project' }] : null,
      ['Dark theme', toggleTheme, { 'data-testid': 'theme-toggle', 'aria-pressed': String(savedTheme() === 'dark') }],
      ['Guide (online, new tab)', null, { href: 'https://rootnote.unravelnetworks.com/guide/', 'data-testid': 'guide-link' }],
      ['About & licences', showNotices, { 'data-testid': 'licences' }]]);
  }

  // Text boxes grow with their content, up to a cap, so short
  // text takes little room and long text needs no inner scrolling.
  const fitHeight = (t) => { t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight + 2, 720)}px`; };
  document.addEventListener('input', (e) => { if (e.target.matches?.('textarea.autogrow')) fitHeight(e.target); });
  const fitAll = () => requestAnimationFrame(() => main.querySelectorAll('textarea.autogrow').forEach(fitHeight));
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { fitAll(); if (liveFinding()) drawLive(); }, 150); });

  function renderFileState() {
    const at = fileInfo && fileInfo.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    fileState.hidden = dirty || !fileInfo;
    fileState.dataset.kind = fileInfo?.kind || '';
    fileState.textContent = !fileInfo ? '' : fileInfo.kind === 'saved' ? `Saved to file · ${at}` : fileInfo.kind === 'opened' ? `Opened from file · ${at}` : `Download requested · ${at}`;
    fileState.title = fileInfo?.kind === 'download' ? 'The browser was asked to download the project file. Check that the download finished.' : '';
  }

  window.addEventListener('beforeunload', (e) => {
    if (dirty || libraryDirty) { e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('paste', onPaste);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault(); // instead of the browser saving this HTML page
      if (!document.querySelector('dialog[open]')) saveProject();
    }
  });

  // ---- state helpers ----
  function markDirty() {
    revision++;
    if (undoOffer && undoOffer.rev !== revision) endUndo();
    dirty = true;
    dirtyBadge.hidden = false;
    renderFileState();
    refreshDerived();
    scheduleLive();
    if (recovery) renderRecovery();
    if (draftReady) scheduleDraft();
  }
  function markClean() {
    // Once saved, a blacked-out screenshot is not brought back by Undo.
    if (undoOffer?.endOnSave) endUndo();
    dirty = false;
    dirtyBadge.hidden = true;
    renderFileState();
  }
  // Errors and anything that asks the user to check or redo something stay until the next
  // message. A plain confirmation ({ fade: true }) clears itself after a while.
  let sayTimer = null;
  function say(message, kind = 'info', { fade = false } = {}) {
    clearTimeout(sayTimer);
    status.textContent = message;
    status.dataset.kind = kind;
    alertRegion.textContent = kind === 'error' ? message : '';
    if (fade && kind !== 'error') sayTimer = setTimeout(() => { if (status.textContent === message) status.textContent = ''; }, 8000);
  }
  const findingById = (id) => doc.findings.find((f) => f.id === id);
  const imageById = (id) => doc.images.find((im) => im.id === id);
  const evidenceCount = () => doc.findings.reduce((n, f) => n + screenshotRefs(f).length, 0);

  /** Replaces the whole project. Any import or open still in flight becomes stale. */
  function replaceProject(next, original = null, { converted = false } = {}) {
    doc = next;
    formatNotice = converted;
    libraryLinks.clear(); // finding ids restart in another project
    generation++;
    projectHandle = null;
    engagement = null;
    recovery = original;
    view = 'details';
    fileInfo = null;
    endUndo();
    markClean();
  }

  // Schema v1 caps the counters at 999 and 9999 and they must stay above every id,
  // so the last ids that can be issued are F-998 and IMG-9998.
  const canIssueFinding = () => doc.project.nextFindingNumber < 999;
  const canIssueImage = () => doc.project.nextImageNumber < 9999;

  // ---- project size budget (LIMITS.fileBytes, shown as CAP) ----
  const CAP = megabytes(LIMITS.fileBytes);
  const SCREENSHOTS_FULL = `This report uses ${LIMITS.evidence} screenshots, the most Rootnote is tested to handle. Remove one you no longer need, or split the engagement into two reports.`;
  const FINDINGS_FULL = `This report has ${LIMITS.findings} findings, the most Rootnote is tested to handle. Nothing has been removed. To write more, split the engagement into two reports.`;
  // Every change is checked against the exact size of the file Save would write, and
  // undone if it would not fit, so the current work can always be saved.

  /** Exact UTF-8 size of the file Save would write (project.js savedSize). */
  const savedBytes = () => savedSize({ ...doc, appVersion });
  const fits = (before = 0) => { const after = savedBytes(); return after <= LIMITS.fileBytes || after <= before; };
  const BUDGET_MESSAGE = `This change would take the project over ${CAP}, the most Rootnote is tested to save and reopen. The change was not made and nothing else has changed. Removing a screenshot you no longer need is usually the quickest fix.`;

  /** Sets obj[key]; keeps it if the project still fits, or if it does not grow a project
   * that was already over the limit (so shrinking edits always work). */
  function setField(obj, key, value) {
    const had = Object.prototype.hasOwnProperty.call(obj, key);
    const prev = obj[key];
    const before = savedBytes();
    obj[key] = value;
    if (!fits(before)) {
      if (had) obj[key] = prev; else delete obj[key];
      say(BUDGET_MESSAGE, 'error');
      return false;
    }
    markDirty();
    return true;
  }

  /** Adds an image under the next id if the project still fits; otherwise changes nothing
   * and throws. `attach(id)` links it into the project and returns its undo function.
   * Synchronous, so concurrent imports cannot share an id. */
  function commitImage(record, attach) {
    if (!canIssueImage()) throw new Error('Image numbering is exhausted for this project; start a new project for more screenshots.');
    const full = { id: imageId(doc.project.nextImageNumber), ...record };
    const images = doc.images;
    doc.images = [...images, full];
    doc.project.nextImageNumber++;
    const undoAttach = attach(full.id);
    if (!fits()) {
      undoAttach();
      doc.images = images;
      doc.project.nextImageNumber--;
      throw new Error(`Adding ${record.originalName ? `"${record.originalName}"` : 'this screenshot'} would take the project over ${CAP}, the most Rootnote is tested to save and reopen. The screenshot was not added and nothing else has changed. Use a smaller image, remove a screenshot you no longer need, or split the engagement into two reports.`);
    }
    return full;
  }

  // ---- navigation ----
  /** The ID shown for a finding: <prefix>-<position>, recomputed whenever the order or
   * prefix changes (schema v2 rule 14). The stored F-NNN id is never shown. */
  const displayId = (f) => `${resolveFindingPrefix(doc.project)}-${doc.findings.indexOf(f) + 1}`;
  const findingName = (f) => `${displayId(f)} "${f.title || 'untitled'}"`;

  function render() {
    renderRecovery();
    renderNav();
    renderMain();
  }

  // Shows or clears the over-budget banner for a converted older file.
  function renderRecovery() {
    if (recovery && savedBytes() <= LIMITS.fileBytes) {
      recovery = null;
      say(`The converted project now fits the ${CAP} limit and can be saved and exported.`);
    }
    recoveryBanner.hidden = !recovery;
    if (!recovery) { recoveryBanner.replaceChildren(); return; }
    const over = savedBytes() - LIMITS.fileBytes;
    recoveryBanner.replaceChildren(
      h('p', {}, h('strong', {}, `Over the ${CAP} limit. `),
        `This project was converted from an older version and is now ${(over / 1024).toFixed(1)} KB too large. Remove a screenshot or some text to save or export it. Until then, changes that would make it larger are refused.`),
      h('button', { type: 'button', class: 'secondary', 'data-testid': 'download-original', onclick: () => downloadBytes(recovery.bytes, recovery.name, 'application/json') }, 'Download original file'));
  }

  function renderNav() {
    docTitle.textContent = doc.project.title || 'Untitled report';
    // The dot follows what the report shows: the manual rating, or in CVSS-only reports
    // the CVSS band (a hidden rating never colours it). Unscored has no colour, not zero.
    const ratingDot = (f) => {
      const { mode } = doc.project.scoring;
      const labels = doc.project.labels;
      let badge, title;
      if (mode === 'cvss') {
        const parsed = f.cvss ? parseCvss(f.cvss) : null;
        const score = parsed?.score ?? null;
        badge = cvssBadge(score);
        const shown = parsed && parsed.version === reportCvssVersion(doc) ? score.toFixed(1) : parsed ? `${score.toFixed(1)} (${parsed.version})` : labels.unscored;
        title = `${cvssLabel(labels.cvss, reportCvssVersion(doc))}: ${shown}`;
      } else {
        badge = ratingBadge(f.rating);
        title = `${mode.startsWith('risk') ? labels.risk : labels.severity}: ${f.rating || labels.unscored}`;
      }
      return h('span', { class: 'sev', title, 'aria-label': title, 'data-testid': 'rating-dot', ...(badge ? { style: `background: #${badge.fill}; color: #${badge.textColor}`, 'data-rated': '1' } : {}) },
        badge ? badge.level[0] : '–');
    };
    const item = (key, ...content) => h('li', {},
      h('button', { type: 'button', class: view === key ? 'navitem active' : 'navitem', 'aria-current': view === key ? 'page' : null, onclick: () => {
        if (narrow()) go(key);
        else { view = key; render(); nav.querySelector('.navitem.active')?.focus(); }
      } },
        ...content));
    nav.replaceChildren(
      h('ul', {}, item('engagements', 'Engagements')),
      h('p', { class: 'navhead' }, 'Report'),
      h('ul', {},
        item('details', 'Details & cover'),
        item('layout', 'Sections & scoring'),
      ),
      h('p', { class: 'navhead' }, 'Findings', h('span', {}, `${doc.findings.length} of ${maxFindings}`)),
      h('ul', {},
        ...doc.findings.map((f, k) => sortable(item(f.id, ratingDot(f), h('span', { class: 'fname' }, h('span', { class: 'ftitle' }, f.title || '(untitled)'), h('span', { class: 'fid sr-only' }, `, ${displayId(f)}`))), doc.findings, k, 'finding', render)),
      ),
      h('button', { type: 'button', class: 'add', 'data-testid': 'add-finding', disabled: doc.findings.length >= maxFindings || !canIssueFinding(), onclick: addFinding },
        ...(doc.findings.length >= maxFindings ? [`Limit of ${maxFindings} findings reached`] : [icon('plus'), 'New finding'])),
      doc.findings.length >= maxFindings && maxFindings === LIMITS.findings ? h('p', { class: 'hint' }, FINDINGS_FULL) : null,
      h('ul', {}, item('library', 'Finding library', h('span', { class: 'fid' }, `${library.entries.length}${libraryDirty ? ' •' : ''}`))),
      h('p', { class: 'navhead' }, 'Output'),
      h('ul', {}, item('preview', 'Preview report'), item('export', 'Check & export')),
      h('p', { class: 'meta' }, `${evidenceCount()} of ${LIMITS.evidence} screenshots used`));
    // The finding's tag follows its rating, score and status.
    const shown = findingById(view);
    const tag = main.querySelector('[data-testid=finding-tag]');
    if (shown && tag) tag.replaceWith(findingTag(shown));
  }

  const VIEW_NAMES = { engagements: 'Engagements', details: 'Details & cover', layout: 'Sections & scoring', preview: 'Preview', export: 'Check & export', library: 'Finding library' };
  function renderMain() {
    syncNav();
    layout.classList.toggle('starting', view === 'start');
    root.classList.toggle('at-start', view === 'start');
    crumbView.textContent = VIEW_NAMES[view] ?? 'Findings';
    topPreview.hidden = view === 'preview';
    topExport.hidden = view === 'export';
    if (view === 'start') main.replaceChildren(startView());
    else if (view === 'details') main.replaceChildren(detailsView());
    else if (view === 'layout') main.replaceChildren(layoutView());
    else if (view === 'preview') previewView();
    else if (view === 'export') main.replaceChildren(exportView());
    else if (view === 'library') main.replaceChildren(libraryView());
    else if (view === 'engagements') main.replaceChildren(engagementsView());
    else {
      const f = findingById(view);
      if (!f) { view = 'details'; return render(); }
      main.replaceChildren(findingView(f));
    }
    fitAll();
    showLive();
  }

  // ---- live page ----
  // The whole report is laid out with the same plan and renderer as Preview, so figure
  // numbers, page numbers and page breaks match it; only the pages of the finding being
  // edited are shown, read-only. It follows edits after a short pause.
  const liveFinding = () => (livePane && view !== 'start' && findingById(view)) || null;
  const setLive = (on) => { livePane = on; showLive(); };
  const liveHead = h('div', { class: 'live-head' }, icon('eye'), h('span', {}, 'Live page'), h('span', { class: 'live-where', 'data-testid': 'live-where' }),
    h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'linkish', 'data-testid': 'live-full', onclick: () => { view = 'preview'; render(); } }, 'Open full preview'),
    h('button', { type: 'button', class: 'ghost live-hide', 'data-testid': 'live-hide', 'aria-label': 'Hide the live page', title: 'Hide the live page', onclick: () => setLive(false) }, '×'));
  let liveKey = '';
  function showLive() {
    const f = liveFinding();
    layout.classList.toggle('with-live', !!f);
    live.hidden = !f;
    main.querySelector('.live-show')?.toggleAttribute('hidden', !!f || view === 'start' || !findingById(view));
    fitAll(); // the editor column changed width
    if (!f) { clearTimeout(liveTimer); live.replaceChildren(); liveKey = ''; return; }
    // Drawn right after the editor is shown, so moving to a finding is not held up by it.
    clearTimeout(liveTimer);
    liveTimer = setTimeout(drawLive, 0);
  }
  function scheduleLive() {
    if (!liveFinding()) return;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(drawLive, 400);
  }
  // The live page lays out only the shown finding (renderPreview `only`). Page numbers come
  // from remembered page counts of the front matter and of every other finding, keyed by the
  // content that decides them, so editing one finding recounts only that finding. Missing
  // counts are filled in small slices after the live page is shown; until then it shows the
  // finding without page numbers. Laying out the whole report on every keystroke pause and
  // every finding change took seconds in large reports.
  // One remembered count per finding (and one for the front matter), each with the content key
  // it was counted for, so edits replace a finding's entry instead of adding to it. Cleared when
  // another project is opened.
  let pageCounts = { gen: -1, front: null, findings: new Map() }; // findings: id -> { key, n }
  const counts = () => {
    if (pageCounts.gen !== generation) { clearTimeout(countJob); pageCounts = { gen: generation, front: null, findings: new Map() }; }
    return pageCounts;
  };
  const getFront = (plan) => { const c = counts().front; return c && c.key === frontCountKey(plan) ? c.n : undefined; };
  const setFront = (plan, n) => { counts().front = { key: frontCountKey(plan), n }; };
  const getCount = (plan, j) => { const c = counts().findings.get(plan.findings[j].id); return c && c.key === findingCountKey(plan, j) ? c.n : undefined; };
  const setCount = (plan, j, n) => { counts().findings.set(plan.findings[j].id, { key: findingCountKey(plan, j), n }); };
  let countJob = null;
  const findingCountKey = (plan, k) => JSON.stringify([plan.findings[k], k === 0, plan.geometry, plan.design, plan.labels, plan.running, plan.findingsAnchor]);
  const frontCountKey = (plan) => JSON.stringify({ ...plan, findings: plan.findings.length, imageAssets: plan.imageAssets.map((a) => [a.id, a.width, a.height]) });
  function countPages(plan, options) {
    const tmp = h('div', { class: 'pv live-pv', 'aria-hidden': 'true', style: 'position: absolute; left: -100000px; top: 0; visibility: hidden' });
    document.body.append(tmp);
    try { return renderPreview(tmp, plan, { images: new Map(doc.images.map((im) => [im.id, im])), onTallMode: () => {}, imagesFor: new Set(), ...options }).bodyPages; }
    finally { tmp.remove(); }
  }
  /** Body pages before finding k and in the whole report, given finding k's own count, or
   * null while another count is missing. */
  function pageNumbers(plan, k, own) {
    const front = getFront(plan);
    if (front === undefined) return null;
    let before = front, total = front + own;
    for (let j = 0; j < plan.findings.length; j++) {
      if (j === k) continue;
      const n = getCount(plan, j);
      if (n === undefined) return null;
      if (j < k) before += n;
      total += n;
    }
    return { before, total };
  }
  // The counts a plan is missing (except finding `skip`, which the live page lays out itself).
  function missingCounts(plan, skip = -1) {
    const jobs = [];
    if (getFront(plan) === undefined) jobs.push(() => setFront(plan, countPages(plan, { frontOnly: true })));
    plan.findings.forEach((x, j) => { if (j !== skip && getCount(plan, j) === undefined) jobs.push(() => setCount(plan, j, countPages(plan, { only: { findingId: x.id, bodyOffset: null } }))); });
    return jobs;
  }
  // Counts what is missing, one finding per task, then redraws once with page numbers.
  function scheduleCounts(plan, gen, rev) {
    clearTimeout(countJob);
    const jobs = missingCounts(plan);
    if (!jobs.length) return;
    const next = () => {
      if (gen !== generation || rev !== revision) return; // a newer draw schedules its own counts
      jobs.shift()();
      if (jobs.length) countJob = setTimeout(next, 0);
      else {
        // Forget findings that are no longer in the report.
        const ids = new Set(plan.findings.map((x) => x.id));
        for (const id of [...counts().findings.keys()]) if (!ids.has(id)) counts().findings.delete(id);
        drawLive();
      }
    };
    countJob = setTimeout(next, 0);
  }
  function drawLive() {
    clearTimeout(liveTimer);
    const f = liveFinding();
    if (!f) return;
    const { plan, reason } = currentPlan();
    // The header stays the same element across redraws, so focus on Full preview survives
    //. The scroll position is kept only while the same finding of the same
    // project is shown.
    if (!liveHead.isConnected) live.replaceChildren(liveHead);
    const key = `${generation}:${f.id}`;
    const top = key === liveKey ? live.scrollTop : 0;
    liveKey = key;
    live.querySelector('.live-body')?.remove();
    const where = liveHead.querySelector('[data-testid=live-where]');
    if (!plan) { where.textContent = ''; live.append(h('p', { class: 'hint live-body' }, reason)); return; }
    const k = plan.findings.findIndex((x) => x.id === f.id);
    // A report of ordinary size is counted at once (it takes a moment); a large one in the background.
    if (plan.findings.length <= 30) for (const job of missingCounts(plan, k)) job();
    if (k < 0) { where.textContent = '· This finding is not in the report'; live.append(h('p', { class: 'hint live-body' }, 'This finding is not in the report.')); return; }
    const host = h('div', { class: 'pv live-pv live-body' });
    live.append(host);
    const shown = new Set();
    JSON.stringify(plan.findings[k], (key2, v) => { if (key2 === 'imageId' && typeof v === 'string') shown.add(v); return v; });
    const { bodyPages } = renderPreview(host, plan, { images: new Map(doc.images.map((im) => [im.id, im])), onTallMode: () => {}, imagesFor: shown,
      only: { findingId: f.id, bodyOffset: null } });
    // The page count comes from a layout off screen at the page's real size (the pane may be
    // hidden on a narrow window, where nothing can be measured); the footers are numbered from
    // it and the remembered counts of everything else.
    let own = getCount(plan, k);
    if (own === undefined) { own = live.offsetParent ? bodyPages : countPages(plan, { only: { findingId: f.id, bodyOffset: null } }); setCount(plan, k, own); }
    // Forget findings that are no longer in the report (deleted ones would otherwise stay until a background pass).
    if (counts().findings.size > plan.findings.length) { const ids = new Set(plan.findings.map((x) => x.id)); for (const id of [...counts().findings.keys()]) if (!ids.has(id)) counts().findings.delete(id); }
    const numbers = pageNumbers(plan, k, own);
    if (numbers) host.querySelectorAll('.pv-running-footer > span:last-child').forEach((sp, i) => { sp.textContent = `${plan.labels.page} ${numbers.before + i + 1} ${plan.labels.pageOf} ${numbers.total}`; });
    // Read-only: no screenshot layout controls and no approximation banner here (the header says where it is).
    host.querySelectorAll('.pv-control, .pv-note').forEach((e) => e.remove());
    host.querySelectorAll('[id^=pv-]').forEach((e) => e.removeAttribute('id')); // ids belong to the full Preview
    host.querySelectorAll('a.pv-link').forEach((a) => { a.removeAttribute('href'); a.onclick = null; });
    const width = host.querySelector('.pv-page')?.getBoundingClientRect().width || 1;
    // Numbered as the report's footer numbers them: body pages only, not the cover.
    const first = (numbers?.before ?? 0) + 1, last = first + own - 1;
    where.textContent = numbers
      ? `· ${doc.project.paperSize} · page ${first}${last > first ? `–${last}` : ''} of ${numbers.total}`
      : `· ${doc.project.paperSize} · counting pages…`;
    // Fit the page width to the pane.
    host.style.zoom = String(Math.min(1, (live.clientWidth - 24) / width));
    live.scrollTop = top;
    markLive(false);
    if (!numbers) scheduleCounts(plan, generation, revision);
  }
  // What the cursor is in (a block, a screenshot or a finding section) is marked on the live
  // page, and brought into view there when it changes (agreed mockup).
  let liveFocus = null; // { block } | { image } | { section }
  function markLive(scroll) {
    live.querySelectorAll('.pv-hl').forEach((e) => e.classList.remove('pv-hl'));
    if (!liveFocus || live.hidden) return;
    const sel = liveFocus.image ? `.pv-page:not([hidden]) [data-image="${liveFocus.image}"]`
      : liveFocus.block ? `.pv-page:not([hidden]) [data-block="${liveFocus.block}"]`
        : `.pv-page:not([hidden]) [data-section="${liveFocus.section}"]`;
    const marked = [...live.querySelectorAll(sel)];
    marked.forEach((e) => e.classList.add('pv-hl'));
    if (!scroll || !marked.length) return;
    const r = marked[0].getBoundingClientRect();
    const box = live.getBoundingClientRect();
    if (r.top < box.top + 40 || r.bottom > box.bottom) live.scrollTop += r.top - box.top - box.height / 3;
  }
  main.addEventListener('focusin', (e) => {
    if (!liveFinding()) return;
    const card = e.target.closest('[data-image]');
    const block = e.target.closest('[data-block]');
    const section = e.target.closest('[data-section]');
    const next = card ? { image: card.dataset.image } : block?.dataset.block ? { block: block.dataset.block }
      : section && section.dataset.section !== 'details' ? { section: section.dataset.section } : null;
    if (JSON.stringify(next) === JSON.stringify(liveFocus)) return;
    liveFocus = next;
    markLive(true);
  });

  // ---- fields ----
  function field(label, input, hint) {
    return h('label', { class: 'field' }, h('span', { class: 'label' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
  }
  function lineInput(obj, key, { onChange, maxLength = LIMITS.line, ...attrs } = {}) {
    return h('input', {
      type: 'text', value: obj[key] || '', maxlength: maxLength, ...attrs,
      oninput: (e) => {
        const clean = sanitizeLine(e.target.value).slice(0, maxLength);
        if (!setField(obj, key, clean)) { e.target.value = obj[key] || ''; return; }
        if (clean !== e.target.value) e.target.value = clean;
        onChange?.();
      },
    });
  }
  /** A label that may not be empty (schema v2 labels): an emptied box keeps the old value. */
  function labelInput(obj, key, attrs = {}) {
    return h('input', {
      type: 'text', value: obj[key], maxlength: LIMITS.label, ...attrs,
      oninput: (e) => {
        const clean = sanitizeLine(e.target.value).slice(0, LIMITS.label);
        if (!/\S/.test(clean)) return; // kept until the user types a non-empty name
        if (!setField(obj, key, clean)) { e.target.value = obj[key]; return; }
        if (clean !== e.target.value) e.target.value = clean;
      },
      onblur: (e) => { e.target.value = obj[key]; },
    });
  }
  function textArea(obj, key, { rows = 5, code = false, ...attrs } = {}) {
    return h('textarea', {
      rows, class: code ? 'code autogrow' : 'autogrow', maxlength: LIMITS.text, spellcheck: code ? 'false' : null, value: obj[key] || '', ...attrs,
      oninput: (e) => {
        const clean = sanitizeText(e.target.value).slice(0, LIMITS.text);
        if (!setField(obj, key, clean)) { e.target.value = obj[key] || ''; return; }
        if (clean !== e.target.value) e.target.value = clean;
      },
    });
  }
  function checkbox(obj, key, label, { onChange, ...attrs } = {}) {
    return h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: obj[key], ...attrs, onchange: (e) => { if (!setField(obj, key, e.target.checked)) e.target.checked = obj[key]; else onChange?.(); } }),
      ' ', label);
  }
  function formatSelect(obj, key, onChange) {
    return h('select', { class: 'format', 'aria-label': 'Text format', onchange: (e) => { if (!setField(obj, key, e.target.value)) e.target.value = obj[key]; else onChange?.(); } },
      h('option', { value: 'plain', selected: obj[key] === 'plain' }, 'Plain text'),
      h('option', { value: 'code', selected: obj[key] === 'code' }, 'Code (verbatim, monospace)'));
  }
  /** Up/down buttons that swap list[k] with a neighbour; reordering never changes the size. */
  function moveIn(list, k, delta, after) {
    const j = k + delta;
    if (j < 0 || j >= list.length) return;
    [list[k], list[j]] = [list[j], list[k]];
    markDirty();
    after();
  }
  /** A block's ⋯ menu (agreed mockup): its own items, then move up and down, then Remove. */
  function blockMenu(name, list, k, what, after, items, remove) {
    return menuOf(`More actions for this ${what}`, 'block-menu', [
      ...items,
      k > 0 ? ['Move up', () => moveIn(list, k, -1, after), { 'aria-label': `Move ${what} up` }] : null,
      k < list.length - 1 ? ['Move down', () => moveIn(list, k, 1, after), { 'aria-label': `Move ${what} down` }] : null,
      ['Remove', remove, { class: 'menu-item danger-item', 'aria-label': `Remove ${what}` }]]);
  }
  /** Copies text to the clipboard; says whether it worked (file pages may not allow it). */
  async function copyText(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      say(`Copied ${what}.`, 'info', { fade: true });
    } catch {
      say(`The browser did not allow copying. Select the ${what} and press Ctrl+C instead.`, 'error');
    }
  }
  function moveButtons(list, k, what, after) {
    const move = (delta) => moveIn(list, k, delta, after);
    return [
      h('button', { type: 'button', class: 'secondary', disabled: k === 0, onclick: () => move(-1), 'aria-label': `Move ${what} up` }, '↑'),
      h('button', { type: 'button', class: 'secondary', disabled: k === list.length - 1, onclick: () => move(1), 'aria-label': `Move ${what} down` }, '↓'),
    ];
  }
  // Drag and drop reordering. The handle starts the drag; any row of the same
  // list accepts the drop and the item moves to that row's position. The arrow buttons
  // stay for keyboard users.
  const listIds = new WeakMap();
  let dragging = null; // { list, from }
  function sortable(row, list, k, what, after) {
    if (!listIds.has(list)) listIds.set(list, listIds.size + 1);
    const handle = h('span', { class: 'drag-handle', draggable: 'true', title: `Drag to reorder (${what})`, 'data-testid': 'drag-handle' }, '⠿');
    const clear = () => document.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
    handle.addEventListener('dragstart', (e) => {
      dragging = { list, from: k };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', what);
      e.dataTransfer.setDragImage?.(row, 16, 16);
      row.classList.add('dragging');
    });
    handle.addEventListener('dragend', () => { dragging = null; row.classList.remove('dragging'); clear(); });
    row.addEventListener('dragover', (e) => {
      if (dragging?.list !== list) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!row.classList.contains('drop-target')) { clear(); row.classList.add('drop-target'); }
    });
    row.addEventListener('drop', (e) => {
      if (dragging?.list !== list) return;
      e.preventDefault();
      e.stopPropagation();
      const from = dragging.from;
      dragging = null;
      clear();
      if (from === k) return;
      const [item] = list.splice(from, 1);
      list.splice(k, 0, item);
      markDirty();
      after();
    });
    row.classList.add('sortable');
    row.prepend(handle);
    return row;
  }
  const sectionConfig = (group, key) => doc.project.sections[group].find((s) => s.key === key);
  const hiddenNote = (group, key) => (sectionConfig(group, key).enabled ? null : h('span', { class: 'badge' }, 'Hidden in the report'));

  // ---- report details ----
  /** First run: three ways in, no wizard. Opening a file or a recovery
   * draft leaves it on its own; New report keeps the empty project already open. */
  function startView() {
    const choice = (testid, glyph, title, text, button, onclick, primary = false) => h('div', { class: primary ? 'choice main' : 'choice' },
      h('span', { class: 'ic' }, icon(glyph)), h('h2', {}, title), h('p', {}, text),
      h('button', { type: 'button', class: primary ? 'big' : 'secondary big', 'data-testid': testid, onclick }, button));
    const begin = () => { view = 'details'; render(); main.querySelector('input')?.focus(); };
    return h('section', { class: 'start', 'data-testid': 'start' },
      h('h1', {}, 'Write the report. Rootnote handles the Word file.'),
      h('p', { class: 'lede' }, 'Findings, screenshots and scoring in one place, exported as a clean Word report. Everything stays on this computer.'),
      h('p', { class: 'phone-note', 'data-testid': 'phone-note' }, 'On a phone, explore Rootnote and its sample report. To write and save reports, use a computer.'),
      h('div', { class: 'choices' },
        choice('start-new', 'plus', 'New report', 'Start with an empty report: details and cover first, then your findings.', 'New report', begin, true),
        choice('start-open', 'folder', 'Open a project', h('span', {}, 'Continue a saved ', h('code', {}, '.rootnote.json'), ' project file.'), 'Open…', () => openInput.click()),
        choice('start-sample', 'book', 'Explore the sample', 'An eight-finding example report with a fictional client and synthetic evidence. Explore the editor, preview the layout and export a Word report.', 'Open the sample', openSample)),
      h('p', { class: 'start-more' }, h('button', { type: 'button', class: 'linkish', 'data-testid': 'start-engagements', onclick: () => go('engagements') }, 'Or browse your engagement folders')),
      h('ul', { class: 'promise' },
        h('li', {}, icon('wifioff'), 'Works offline, makes no network requests'),
        h('li', {}, icon('lock'), 'The app uploads nothing; you choose where files go'),
        h('li', {}, icon('word'), 'Exports a .docx you can edit in Word')));
  }

  const card = (title, ...children) => h('div', { class: 'xcard' }, h('h2', {}, ...[title].flat()), ...children);
  function detailsView() {
    const p = doc.project;
    const date = (key) => h('input', { type: 'date', value: p[key] || '', oninput: (e) => { if (!setField(p, key, e.target.value)) e.target.value = p[key] || ''; } });
    const prefixHint = h('span', {});
    const updatePrefixHint = () => {
      const prefix = resolveFindingPrefix(p);
      prefixHint.textContent = `Findings are numbered ${prefix}-1, ${prefix}-2, … by their order in the report.` +
        (p.findingPrefix.trim() && prefix !== p.findingPrefix.trim() ? ' (The prefix cannot contain tabs or exceed 40 characters.)' : '');
      renderNav();
    };
    updatePrefixHint();
    const rs = (key) => sectionConfig('report', key);
    return h('section', { class: 'panel settings' },
      h('h1', {}, 'Details & cover'),
      h('p', { class: 'sub' }, 'What the cover and the opening pages of the report say.'),
      card('About the report', h('div', { class: 'grid2' },
        field('Report title', lineInput(p, 'title', { 'data-testid': 'title', onChange: renderNav })),
        field('Subtitle', lineInput(p, 'subtitle', { 'data-testid': 'subtitle' })),
        field('Client', lineInput(p, 'client')),
        field('Tester', lineInput(p, 'testerName')),
        field('Organisation', lineInput(p, 'organisation')),
        field('Report version', lineInput(p, 'reportVersion', { maxLength: 32 })),
        field('Engagement status', h('select', { 'data-testid': 'engagement-status', onchange: (e) => { const v = e.target.value || null; if (!setField(p, 'engagementStatus', v)) e.target.value = p.engagementStatus ?? ''; } },
          h('option', { value: '', selected: p.engagementStatus === null }, formatEngagementStatus(null, { notSet: p.labels.statusNotSet })),
          ...ENGAGEMENT_STATUSES.map((st) => h('option', { value: st, selected: p.engagementStatus === st }, formatEngagementStatus(st)))),
          'Your record. Nothing changes it automatically.'),
        field('Engagement ID', lineInput(p, 'engagementId', { 'data-testid': 'engagement-id', onChange: updatePrefixHint })),
        field('Finding ID prefix (optional)', lineInput(p, 'findingPrefix', { maxLength: LIMITS.prefix, 'data-testid': 'finding-prefix', placeholder: 'Defaults to the engagement ID', onChange: updatePrefixHint }), prefixHint),
        field('Classification', lineInput(p, 'classification'), 'Shown in the page footer when filled in, e.g. "Confidential".'),
        field('Report date', date('reportDate')),
        field('Test start', date('startDate')),
        field('Test end', date('endDate')))),
      disclose('branding', 'Page, cover and logos', brandingSummary(),
        h('div', { class: 'grid2' },
          field('Paper size', h('select', { 'data-testid': 'paper', onchange: (e) => { if (!setField(p, 'paperSize', e.target.value)) e.target.value = p.paperSize; } },
            ...['A4', 'Letter'].map((s) => h('option', { value: s, selected: p.paperSize === s }, s)))),
          field('Accent colour', h('input', { type: 'color', value: p.accentColor || '#1f5f8b', oninput: (e) => { if (!setField(p, 'accentColor', e.target.value)) e.target.value = p.accentColor || '#1f5f8b'; } }))),
        checkbox(p.cover, 'enabled', 'Start the report with a cover page', { 'data-testid': 'cover' }),
        h('div', { class: 'grid2 logos' },
          logoEditor('testerLogo', 'Your logo'),
          logoEditor('clientLogo', 'Client logo'))),
      card([rs('executiveSummary').label, ' ', hiddenNote('report', 'executiveSummary')],
        field('Text', textArea(p, 'executiveSummary', { rows: 8, 'aria-label': rs('executiveSummary').label }), 'Plain text. A blank line starts a new paragraph; a line starting with "- " is a bullet.')),
      card([rs('engagement').label, ' ', hiddenNote('report', 'engagement')], engagementEditor()),
      card([rs('scope').label, ' ', hiddenNote('report', 'scope')],
        field('Text', textArea(p, 'scope', { rows: 5, 'aria-label': rs('scope').label }))),
      card([rs('ratingMethod').label, ' ', hiddenNote('report', 'ratingMethod')], ratingMethodEditor(rs('ratingMethod'))),
      card('Your own sections', customSectionsEditor()));
  }

  // ---- custom report sections (schema v6) ----
  /** The user's own report sections: a title (also its name in the report order), text in
   * plain or code format, at most 10. Removing one that has text asks first. */
  function customSectionsEditor() {
    const p = doc.project;
    const box = h('div', { class: 'custom-sections', 'data-testid': 'custom-sections' });
    const rowOf = (c) => p.sections.report.find((s) => s.key === customKey(c.id));
    const redraw = () => { box.replaceChildren(...content()); fitAll(); };
    const add = () => {
      if (p.customSections.length >= CUSTOM_LIMITS.sections) return;
      const c = { id: newCustomSectionId(), title: 'New section', text: '', format: 'plain' };
      const row = { key: customKey(c.id), label: c.title, enabled: true };
      const list = p.sections.report;
      const before = list.findIndex((s) => s.key === 'findingsSummary');
      const at = before < 0 ? list.length : before;
      if (!change(() => { p.customSections.push(c); list.splice(at, 0, row); },
        () => { p.customSections.splice(p.customSections.indexOf(c), 1); list.splice(list.indexOf(row), 1); })) return;
      redraw();
      const input = box.querySelector(`[data-custom="${c.id}"] [data-testid=custom-title]`);
      input?.focus();
      input?.select();
    };
    const remove = async (c) => {
      const gen = generation;
      const rev = revision;
      if (c.text.trim() && !await confirmDialog(`Remove the section "${c.title}" and its text?`, 'Remove section')) return;
      if (gen !== generation || rev !== revision) return; // the project changed while the question was open
      const list = p.sections.report;
      const k = p.customSections.indexOf(c);
      const row = rowOf(c);
      const at = list.indexOf(row);
      if (k < 0 || at < 0) return;
      if (!change(() => { p.customSections.splice(k, 1); list.splice(at, 1); }, () => { p.customSections.splice(k, 0, c); list.splice(at, 0, row); })) return;
      redraw();
      focusIn(box.querySelectorAll('[data-custom]')[Math.min(k, p.customSections.length - 1)] || box.querySelector('[data-testid=custom-add]'));
    };
    const content = () => [
      h('p', { class: 'hint' }, 'Sections you write yourself, such as Methodology or Conclusion. Each is placed where it is in Sections & scoring and listed in Contents. An empty section is left out of the report.'),
      ...p.customSections.map((c) => h('div', { class: 'custom-section', dataset: { custom: c.id } },
        h('div', { class: 'row' },
          customTitleInput(c, { 'aria-label': 'Section title', 'data-testid': 'custom-title', class: 'custom-title' }),
          formatSelect(c, 'format', redraw),
          rowOf(c)?.enabled ? null : h('span', { class: 'badge' }, 'Hidden in the report'),
          h('button', { type: 'button', class: 'secondary', 'data-testid': 'custom-remove', onclick: () => remove(c) }, 'Remove')),
        textArea(c, 'text', { rows: 3, code: c.format === 'code', 'aria-label': 'Section text', 'data-testid': 'custom-text' }))),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'secondary', 'data-testid': 'custom-add', disabled: p.customSections.length >= CUSTOM_LIMITS.sections, onclick: add }, '+ Add a section'),
        p.customSections.length >= CUSTOM_LIMITS.sections ? h('span', { class: 'hint' }, `Limit of ${CUSTOM_LIMITS.sections} sections.`) : null)];
    redraw();
    return box;
  }
  /** A custom section's title is also its name in the report order: one edit sets both,
   * or neither. An emptied box keeps the old title until something is typed. */
  function customTitleInput(c, attrs = {}) {
    return h('input', {
      type: 'text', value: c.title, maxlength: CUSTOM_LIMITS.title, ...attrs,
      oninput: (e) => {
        const t = capUnits(sanitizeLine(e.target.value), CUSTOM_LIMITS.title).trim();
        const row = doc.project.sections.report.find((s) => s.key === customKey(c.id));
        const prev = c.title;
        if (!t || !row || t === prev) return;
        if (!change(() => { c.title = t; row.label = t; }, () => { c.title = prev; row.label = prev; })) e.target.value = prev;
      },
      onblur: (e) => { e.target.value = c.title; },
    });
  }

  /** A labelled group of settings that opens on request and stays open across redraws. */
  function disclose(key, title, summary, ...children) {
    const d = h('details', { class: 'disclose', 'data-testid': `disclose-${key}`, open: disclosed.has(key) },
      h('summary', {}, h('span', { class: 'disclose-title' }, title), summary ? h('span', { class: 'hint', 'data-summary': key }, summary) : null),
      h('div', { class: 'disclose-body' }, ...children));
    d.addEventListener('toggle', () => { if (d.open) disclosed.add(key); else disclosed.delete(key); });
    return d;
  }

  /** Text on screen that is computed from other fields follows each edit without a redraw,
   * so focus and typing are not disturbed. */
  function refreshDerived() {
    if (view !== 'details') return;
    for (const el of main.querySelectorAll('[data-bound]')) el.textContent = resolveEngagementValue({ source: el.dataset.bound }, doc.project).trim() || '(empty)';
    const summary = main.querySelector('[data-summary=branding]');
    if (summary) summary.textContent = brandingSummary();
  }

  function brandingSummary() {
    const p = doc.project;
    const logos = ['testerLogo', 'clientLogo'].filter((r) => p.branding[r].imageId).length;
    return `${p.paperSize} · ${p.cover.enabled ? 'cover page' : 'no cover page'} · ${logos ? `${logos} logo${logos > 1 ? 's' : ''}` : 'no logos'}`;
  }

  // "How findings are rated" (schema v5, R5 B2): authored text. The default for the current
  // scoring mode is filled only when asked, and replacing written text asks first; changing
  // the scoring mode never rewrites it.
  function ratingMethodEditor(section) {
    const p = doc.project;
    const area = textArea(p.ratingMethod, 'text', { rows: 10, 'aria-label': section.label, 'data-testid': 'rating-method' });
    const fill = async () => {
      const text = defaultRatingMethodText(p.scoring.mode, p.labels);
      const mode = SCORING_MODE_TEXT[p.scoring.mode];
      const gen = generation;
      const rev = revision;
      if (p.ratingMethod.text.trim() && p.ratingMethod.text !== text
        && !await confirmDialog(`Replace your text with the default explanation for ${mode}?`, 'Replace')) return;
      if (gen !== generation || rev !== revision) return; // the project changed while the question was open
      if (!setField(p.ratingMethod, 'text', text)) return;
      if (!section.enabled) setField(section, 'enabled', true);
      render();
      say(`Filled with the default explanation for ${mode}. Edit it to match how you rate findings.`);
    };
    return h('div', { class: 'field' },
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'secondary', 'data-testid': 'rating-method-fill', onclick: fill }, `Fill with the default for ${SCORING_MODE_TEXT[p.scoring.mode]}`),
        h('span', { class: 'hint' }, section.enabled ? '' : 'Off in Sections & scoring; filling it switches it on.')),
      area,
      h('span', { class: 'hint' }, 'Plain text, printed as its own section. Empty text prints nothing. It is not updated when you change the scoring mode.'));
  }

  function logoEditor(role, title) {
    const r = doc.project.branding[role];
    const im = r.imageId ? imageById(r.imageId) : null;
    const where = h('div', { class: 'row small' },
      checkbox(r, 'front', 'Cover / title'), checkbox(r, 'header', 'Page header'), checkbox(r, 'footer', 'Page footer'));
    return h('fieldset', { class: 'logo-role', 'data-testid': `logo-${role}` },
      h('legend', {}, title),
      h('div', { class: 'row' },
        h('div', { class: 'logo-tile' }, im ? h('img', { class: 'logo', src: im.dataUrl, alt: title }) : h('span', { class: 'hint' }, 'No logo')),
        // The real file input stays inside the label, focusable and named, so keyboard and
        // assistive technology use it directly; only its "No file chosen" text is hidden.
        h('label', { class: 'filebtn' },
          h('input', { type: 'file', accept: 'image/png,image/jpeg', 'aria-label': `Choose ${title.toLowerCase()}`, 'data-testid': `logo-input-${role}`, onchange: (e) => onLogoFile(e, role) }),
          im ? 'Replace…' : 'Choose image…'),
        im ? h('button', { type: 'button', class: 'secondary', onclick: () => removeLogo(role) }, 'Remove') : null),
      h('p', { class: 'hint' }, 'Show it on:'), where);
  }

  /** Images used only by logo roles are removed when no role uses them any more. */
  function dropUnusedLogoImage(id) {
    if (!id) return;
    const { testerLogo, clientLogo } = doc.project.branding;
    const usedAsEvidence = doc.findings.some((f) => screenshotRefs(f).some((r) => r.imageId === id));
    if (testerLogo.imageId !== id && clientLogo.imageId !== id && !usedAsEvidence) doc.images = doc.images.filter((im) => im.id !== id);
  }

  async function onLogoFile(e, role) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > LIMITS.imageBytes) { say(`${file.name}: over the 2 MB limit.`, 'error'); return; }
    const gen = generation;
    try {
      const record = await importImageBytes(await readFileBytes(file), { name: file.name });
      if (gen !== generation) { say('The project was replaced while the logo was being checked; the logo was not added.', 'error'); return; }
      record.caption = role === 'clientLogo' ? 'Client logo' : 'Logo';
      record.tallMode = 'fit';
      const r = doc.project.branding[role];
      const previous = r.imageId;
      commitImage(record, (id) => {
        const images = doc.images;
        r.imageId = id;
        dropUnusedLogoImage(previous);
        return () => { doc.images = images; r.imageId = previous; };
      });
      markDirty();
      say('Logo added.');
      render();
    } catch (err) {
      say(err.message, 'error');
    }
  }
  function removeLogo(role) {
    const r = doc.project.branding[role];
    const previous = r.imageId;
    r.imageId = null;
    dropUnusedLogoImage(previous);
    markDirty();
    render();
  }

  function engagementEditor() {
    const rows = doc.project.engagement.rows;
    const box = h('div', { class: 'engagement', 'data-testid': 'engagement' });
    const redraw = () => { box.replaceChildren(...content()); fitAll(); };
    const unusedSources = () => Object.keys(ENGAGEMENT_SOURCE_TEXT).filter((s) => !rows.some((r) => r.source === s));
    const add = (row) => {
      if (rows.length >= LIMITS.engagementRows) return;
      rows.push(row);
      if (!fits()) { rows.pop(); say(BUDGET_MESSAGE, 'error'); return; }
      markDirty();
      redraw();
    };
    // a custom row with text is recoverable, or
    // asks first where Undo is not available; a row that shows a report detail loses nothing.
    const remove = async (r) => {
      const populated = r.source === 'custom' && /\S/.test(r.value);
      const offer = await confirmRemoval(populated, `Remove the row "${r.label}" and its text?`, 'Remove row');
      if (offer === null) return;
      const k = rows.indexOf(r);
      if (k < 0) return;
      const copy = structuredClone(r);
      rows.splice(k, 1);
      markDirty();
      redraw();
      const left = box.querySelectorAll('.erow');
      const back = left[Math.min(k, left.length - 1)] || box.querySelector('[data-testid=add-row]');
      focusIn(back?.querySelector?.('button[aria-label^="Remove row"]') || back);
      if (!populated || !offer) return;
      offerUndo(`Removed the row "${short(copy.label)}".`, () => {
        const list = doc.project.engagement.rows;
        if (list.length >= LIMITS.engagementRows) return `the table holds at most ${LIMITS.engagementRows} rows.`;
        const row = structuredClone(copy);
        return change(() => list.splice(Math.min(k, list.length), 0, row), () => list.splice(list.indexOf(row), 1)) || BUDGET_REASON;
      }, () => { showRestored('details', `[data-testid=engagement] [aria-label="${CSS.escape(`${copy.label} value`)}"]`); }, back);
    };
    const modeButton = () => h('button', { type: 'button', class: 'secondary', 'data-testid': 'engagement-customize', 'aria-pressed': String(customizeRows),
      onclick: () => { customizeRows = !customizeRows; redraw(); box.querySelector('[data-testid=engagement-customize]').focus(); } }, customizeRows ? 'Done' : 'Customize rows…');
    // Filling in: each row's name and text; rows that show a report detail
    // say which one and its current value. Names, order and rows change in Customize rows.
    const write = () => [
      h('p', { class: 'hint' }, 'A two-column table in the report. Rows that show a report detail always show its current value; empty rows are left out.'),
      ...rows.map((r) => h('div', { class: r.enabled ? 'ewrite' : 'ewrite off' },
        h('div', { class: 'ewrite-label' }, r.label, r.enabled ? null : h('span', { class: 'badge' }, 'Hidden')),
        r.source === 'custom'
          ? textArea(r, 'value', { rows: 2, code: r.format === 'code', 'aria-label': `${r.label} value` })
          : h('p', { class: 'ewrite-bound' }, h('span', { 'data-bound': r.source }, resolveEngagementValue(r, doc.project).trim() || '(empty)'), h('span', { class: 'hint' }, ` · from ${ENGAGEMENT_SOURCE_TEXT[r.source]}`)))),
      h('div', { class: 'row' }, modeButton())];
    const content = () => !customizeRows ? write() : [
      h('p', { class: 'hint' }, 'Rename, reorder, hide, add or remove rows. Rows that show a report detail always show its current value. Empty rows are left out.'),
      ...rows.map((r, k) => sortable(h('div', { class: 'erow', dataset: { row: String(k) } },
        h('div', { class: 'row' },
          checkbox(r, 'enabled', 'Show', { 'aria-label': `Show row ${k + 1}` }),
          h('input', { type: 'text', class: 'elabel', value: r.label, maxlength: LIMITS.label, 'aria-label': `Row ${k + 1} name`,
            oninput: (e) => { const clean = sanitizeLine(e.target.value).slice(0, LIMITS.label); if (/\S/.test(clean) && !setField(r, 'label', clean)) e.target.value = r.label; },
            onblur: (e) => { e.target.value = r.label; } }),
          r.source === 'custom' ? formatSelect(r, 'format', redraw) : h('span', { class: 'hint' }, `Shows: ${ENGAGEMENT_SOURCE_TEXT[r.source]}`),
          h('span', { class: 'spacer' }),
          ...moveButtons(rows, k, `row ${k + 1}`, redraw),
          h('button', { type: 'button', class: 'secondary', onclick: () => remove(r), 'aria-label': `Remove row ${k + 1}` }, 'Remove')),
        r.source === 'custom' ? textArea(r, 'value', { rows: 2, code: r.format === 'code', 'aria-label': `${r.label} value` }) : null), rows, k, `row ${k + 1}`, redraw)),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'secondary', 'data-testid': 'add-row', disabled: rows.length >= LIMITS.engagementRows,
          onclick: () => add({ source: 'custom', label: 'New row', enabled: true, value: '', format: 'plain' }) }, '+ Add row'),
        unusedSources().length ? h('select', { 'aria-label': 'Add a row that shows a report detail', disabled: rows.length >= LIMITS.engagementRows,
          onchange: (e) => { const s = e.target.value; if (s) add({ source: s, label: ENGAGEMENT_SOURCE_TEXT[s], enabled: true }); } },
          h('option', { value: '' }, '+ Add a report detail…'),
          ...unusedSources().map((s) => h('option', { value: s }, ENGAGEMENT_SOURCE_TEXT[s]))) : null,
        rows.length >= LIMITS.engagementRows ? h('span', { class: 'hint' }, `Limit of ${LIMITS.engagementRows} rows.`) : null,
        h('span', { class: 'spacer' }), modeButton()),
    ];
    redraw();
    return box;
  }

  // ---- report layout ----
  function layoutView() {
    const p = doc.project;
    const sectionList = (group, title) => {
      const list = p.sections[group];
      // Contents always prints right after the cover, so it is pinned first and never
      // moves; the others reorder among themselves and are stored after it.
      const pinned = group === 'report' ? list.find((s) => s.key === 'contents') : null;
      const order = pinned ? list.filter((s) => s !== pinned) : list;
      const box = h('ol', { class: 'sections', 'data-testid': `sections-${group}` });
      const customOf = (s) => (p.customSections ?? []).find((c) => customKey(c.id) === s.key);
      const fields = (s, k) => [
        checkbox(s, 'enabled', 'Show', { 'aria-label': `Show ${s.label}` }),
        customOf(s) ? customTitleInput(customOf(s), { 'aria-label': `Name of section ${k + 1}`, 'data-key': s.key })
          : labelInput(s, 'label', { 'aria-label': `Name of section ${k + 1}`, 'data-key': s.key }),
        customOf(s) ? h('span', { class: 'hint' }, 'Your own section. Text edited in Details & cover.')
          : SECTION_HELP[s.key] ? h('span', { class: 'hint' }, SECTION_HELP[s.key]) : null,
        h('span', { class: 'spacer' })];
      const moved = () => { if (pinned) list.splice(0, list.length, pinned, ...order); redraw(); };
      const redraw = () => box.replaceChildren(
        ...(pinned ? [h('li', { class: 'row pinned', 'data-testid': 'pinned-contents' }, ...fields(pinned, 0))] : []),
        ...order.map((s, k) => sortable(h('li', { class: 'row' }, ...fields(s, k + (pinned ? 1 : 0)),
          ...moveButtons(order, k, s.label, moved)), order, k, s.label, moved)));
      redraw();
      return card(title, box);
    };
    return h('section', { class: 'panel settings' },
      h('h1', {}, 'Sections & scoring'),
      h('p', { class: 'sub' }, 'How findings are rated, what the report shows, and in which order.'),
      card('Scoring', h('div', { class: 'grid2' },
        field('Scoring', h('select', { 'data-testid': 'scoring-mode', onchange: (e) => { if (!setField(p.scoring, 'mode', e.target.value)) e.target.value = p.scoring.mode; else renderNav(); } },
          ...SCORING_MODES.map((m) => h('option', { value: m, selected: p.scoring.mode === m }, SCORING_MODE_TEXT[m]))),
        'Shown in the findings summary and in each finding. Risk is the rating you assign; it is not calculated. Values you hide stay saved.'),
        field('This report uses', h('select', { 'data-testid': 'cvss-report-version', onchange: (e) => switchCvssVersion(e.target) },
          ...['3.1', '4.0'].map((v) => h('option', { value: v, selected: p.scoring.cvssVersion === v }, `CVSS ${v} Base`))),
        'Every finding is scored in this version. Changing it keeps every score: findings in the other version are marked pending until you apply a new assessment. Rootnote does not convert scores.'),
        h('div', { class: 'field' }, checkbox(p, 'backToSummaryLinks', 'Add a link back to the findings summary under each finding')))),
      card('Finding status in the report', h('div', { class: 'field', 'data-testid': 'status-display' },
        checkbox(p.findingStatusDisplay, 'keyFacts', 'Show the status in each finding\'s key facts'),
        checkbox(p.findingStatusDisplay, 'summaryColumn', 'Add a status column to the findings summary'),
        checkbox(p.findingStatusDisplay, 'counts', 'Count findings by status in the findings summary'),
        h('span', { class: 'hint' }, 'Status is your record of each finding; the tool does not verify it. It never hides findings or changes the rating counts.'))),
      card('CWE and vulnerability type in the report', h('div', { class: 'field', 'data-testid': 'classification-display' },
        checkbox(p.classificationDisplay, 'keyFacts', 'Show them in each finding\'s key facts'),
        checkbox(p.classificationDisplay, 'summaryColumn', 'Add a classification column to the findings summary'),
        h('span', { class: 'hint' }, 'Your own entries, printed as typed. Empty values are left out. They do not change the rating or status counts.'))),
      sectionList('report', 'Report sections (in order)'),
      sectionList('finding', 'Sections of each finding (in order)'),
      disclose('labels', 'Rename the words the report uses', 'Headings, captions, cover and footer words',
        h('div', { class: 'grid2', 'data-testid': 'labels' }, ...LABEL_KEYS_V6.map((k) => field(LABEL_TEXT[k], labelInput(p.labels, k, { 'data-key': k }))))));
  }

  // ---- preview ----
  /** The shared report plan for the current project, or null with the reason. */
  function currentPlan() {
    if (recovery) return { plan: null, reason: `The preview is not available while the project is over the ${CAP} limit.` };
    try {
      return { plan: createReportPlan(doc, { paperSize: doc.project.paperSize }), reason: null };
    } catch (err) {
      return { plan: null, reason: `The preview could not be built: ${err.message}` };
    }
  }

  function previewView() {
    const host = h('div', { class: 'pv', 'data-testid': 'preview' });
    const paper = h('select', { 'aria-label': 'Paper size', 'data-testid': 'preview-paper', onchange: (e) => { if (setField(doc.project, 'paperSize', e.target.value)) draw(); else e.target.value = doc.project.paperSize; } },
      ...['A4', 'Letter'].map((p) => h('option', { value: p, selected: doc.project.paperSize === p }, p)));
    let actualSize = false;
    const zoom = h('button', { type: 'button', class: 'secondary pv-zoom', 'data-testid': 'preview-zoom', 'aria-pressed': 'false',
      onclick: () => { actualSize = !actualSize; fit(); } });
    main.replaceChildren(h('section', { class: 'panel' },
      h('div', { class: 'row pv-toolbar' }, h('h1', {}, 'Preview'), h('span', { class: 'spacer' }), jumpList(), h('label', { class: 'row small' }, 'Paper ', paper),
        zoom,
        h('button', { type: 'button', class: 'secondary', 'data-testid': 'print-pdf', onclick: printReport }, 'Print / Save as PDF…')),
      host));
    // Screen only: each page keeps its real size and pagination and is scaled into a wrapper that
    // reserves the scaled size. Print CSS removes the scaling (style.css, @media print).
    const fit = () => {
      const pages = [...host.querySelectorAll('.pv-page')];
      const avail = host.clientWidth;
      const needed = Math.max(0, ...pages.map((pg) => pg.offsetWidth));
      // Phones only: on a computer the preview is unchanged (pages at their real size).
      const phone = narrow();
      const scale = phone && !actualSize && needed > avail && avail > 0 ? avail / needed : 1;
      zoom.hidden = !phone || needed <= avail;
      zoom.textContent = actualSize ? 'Fit width' : 'Actual size';
      zoom.setAttribute('aria-pressed', String(actualSize));
      host.classList.toggle('pv-scroll', phone && actualSize && needed > avail);
      for (const pg of pages) {
        let wrap = pg.parentElement.classList.contains('pv-fit') ? pg.parentElement : null;
        if (scale === 1) {
          if (wrap) { wrap.replaceWith(pg); }
          pg.style.transform = '';
          continue;
        }
        if (!wrap) { wrap = h('div', { class: 'pv-fit' }); pg.replaceWith(wrap); wrap.append(pg); }
        pg.style.transform = `scale(${scale})`;
        wrap.style.width = `${pg.offsetWidth * scale}px`;
        wrap.style.height = `${pg.offsetHeight * scale}px`;
      }
    };
    previewFit = fit;
    const draw = () => {
      const { plan, reason } = currentPlan();
      if (!plan) { host.replaceChildren(h('p', { class: 'hint' }, reason)); return; }
      const y = window.scrollY;
      renderPreview(host, plan, {
        images: new Map(doc.images.map((im) => [im.id, im])),
        onTallMode: (id, mode) => { const im = imageById(id); if (im && setField(im, 'tallMode', mode)) draw(); },
      });
      fit();
      window.scrollTo(0, y);
    };
    draw();
  }
  let previewFit = null;
  window.addEventListener('resize', () => { if (view === 'preview') previewFit?.(); });

  /** Go to a section or finding in the full Preview. */
  function jumpList() {
    const { plan } = currentPlan();
    if (!plan) return null;
    const targets = [
      ...plan.reportSections.filter((x) => x.anchor || x.kind === 'summary').map((x) => [x.anchor ?? plan.summary.anchor, x.label]),
      ...plan.findings.map((x) => [x.anchor, `${x.displayId} ${x.title || '(untitled)'}`])];
    return h('label', { class: 'row small' }, 'Go to ',
      h('select', { 'data-testid': 'preview-jump', onchange: (e) => { main.querySelector(`#pv-${e.target.value}`)?.scrollIntoView({ block: 'start' }); } },
        h('option', { value: '' }, 'Choose a section…'), ...targets.map(([a, t]) => h('option', { value: a }, t))));
  }

  // Print / Save as PDF: the browser prints the preview pages, one page box per sheet at
  // the report's paper size. Pagination follows the preview, not Word.
  /** Why an export is refused: CVSS scores in another version than the report's. `withCvss`
   * is whether the output carries CVSS scores (always for the CSV). */
  const cvssExportBlock = (withCvss) => cvssExportProblem(doc, withCvss);

  async function printReport() {
    if (recovery) { say(`Printing is not available while the project is over the ${CAP} limit.`, 'error'); return; }
    const blockedBy = cvssExportBlock();
    if (blockedBy) { say(`Not printed: ${blockedBy}`, 'error'); return; }
    if (view !== 'preview') { view = 'preview'; render(); }
    const pages = main.querySelector('.pv-pages');
    if (!pages) { say(currentPlan().reason ?? 'The preview could not be built.', 'error'); return; }
    try {
      await Promise.all([...pages.querySelectorAll('img')].map((im) => im.decode()));
    } catch (err) {
      say(`A screenshot could not be prepared for printing: ${err.message}`, 'error');
      return;
    }
    const size = doc.project.paperSize === 'Letter' ? '8.5in 11in' : '210mm 297mm';
    setRuntimeStyle('print', `@page { size: ${size}; margin: 0; }`);
    window.addEventListener('afterprint', () => setRuntimeStyle('print', null), { once: true });
    say('In the print window choose "Save as PDF" as the printer. Page breaks follow the preview, which can differ slightly from Word.');
    window.print();
  }

  // ---- findings ----
  function addFinding() {
    if (doc.findings.length >= maxFindings || !canIssueFinding()) return;
    const f = {
      id: findingId(doc.project.nextFindingNumber++), title: '', rating: null, cvss: null, affectedAssets: [],
      description: '', details: [], impact: '', threat: '', recommendation: '', formats: defaultFormats(), evidence: [], status: 'open',
      cwe: '', vulnerabilityType: '',
    };
    doc.findings.push(f);
    if (!fits()) {
      doc.findings.pop();
      doc.project.nextFindingNumber--;
      say(BUDGET_MESSAGE, 'error');
      return;
    }
    view = f.id;
    markDirty();
    render();
    main.querySelector('input')?.focus();
  }

  function moveFinding(f, delta) {
    const i = doc.findings.indexOf(f);
    const j = i + delta;
    if (j < 0 || j >= doc.findings.length) return;
    [doc.findings[i], doc.findings[j]] = [doc.findings[j], doc.findings[i]];
    markDirty();
    render(); // visible IDs follow the order
  }

  async function deleteFinding(f) {
    const ids = screenshotRefs(f).map((r) => r.imageId);
    const n = ids.length;
    const name = findingName(f);
    const gen = generation;
    const rev = revision;
    const ok = await confirmDialog(`Delete ${name}${n ? ` and its ${n} screenshot${n > 1 ? 's' : ''}` : ''}? This cannot be undone. Later findings are renumbered.`, 'Delete finding');
    // A question answered after the project changed (an Open finishing meanwhile) deletes
    // nothing: its image ids could name another project's images.
    if (!ok || gen !== generation || rev !== revision || !doc.findings.includes(f)) return;
    doc.findings = doc.findings.filter((x) => x !== f);
    doc.images = doc.images.filter((im) => !ids.includes(im.id));
    view = 'details';
    markDirty();
    say(`${name} deleted.`);
    render();
    nav.querySelector('.navitem.active')?.focus();
  }

  function scoringFields(f) {
    const mode = doc.project.scoring.mode;
    const labels = doc.project.labels;
    const ratingLabel = mode.startsWith('risk') ? labels.risk : labels.severity;
    const showRating = mode !== 'cvss';
    const showCvss = mode.endsWith('cvss');
    const rating = h('select', { 'data-testid': 'rating', onchange: (e) => { if (!setField(f, 'rating', e.target.value || null)) e.target.value = f.rating || ''; else renderNav(); } },
      h('option', { value: '', selected: f.rating === null }, labels.unscored),
      ...SEVERITIES.map((s) => h('option', { value: s, selected: f.rating === s }, s)));
    const cvssNote = h('span', { class: 'hint', id: 'cvss-note', 'data-testid': 'cvss-note' });
    // The report uses one CVSS version (Sections & scoring); every calculator follows it. A
    // stored vector in the other version (kept when the report switched, or from a library)
    // stays until the tester applies an assessment in the report's version or clears it, and
    // until then blocks exports that show CVSS. Its calculator is a draft seeded with
    // suggestions that carry over (cvssSuggestions); nothing is stored until Apply.
    const version = reportCvssVersion(doc);
    const metricsFor = version === '4.0' ? CVSS40_METRICS : CVSS_METRICS;
    const count = metricsFor.length === 8 ? 'eight' : 'eleven';
    const mismatch = () => !!f.cvss && cvssVersion(f.cvss) !== version;
    const old = mismatch() ? parseCvss(f.cvss) : null;
    const draft = old ? cvssDraft(f, version) : null;
    // The note always describes the stored vector, plus whichever pending state applies:
    // invalid typed text (kept until replaced by a valid vector or cleared), an incomplete
    // calculator (the stored vector stays until every metric is chosen), or a pending draft.
    let typedError = null;
    const stored = () => {
      if (!f.cvss) return `Not scored. Open the CVSS ${version} calculator and pick every metric, or paste a CVSS ${version} vector.`;
      const parsed = parseCvss(f.cvss);
      return `Score ${parsed.score.toFixed(1)} (CVSS ${parsed.version} Base, calculated from the vector).`;
    };
    const chosen = () => metricsFor.filter(([k]) => picked[k]).length;
    const draftVector = () => (chosen() === metricsFor.length ? parseCvss(`CVSS:${version}/${metricsFor.map(([k]) => `${k}:${picked[k]}`).join('/')}`) : null);
    const pendingNote = () => {
      const head = `Existing CVSS ${old.version} score: ${old.score.toFixed(1)}. CVSS ${version} assessment pending.`;
      const d = draftVector();
      return d
        ? `${head} Draft CVSS ${version} score ${d.score.toFixed(1)}, not applied. Apply it to replace the CVSS ${old.version} score.`
        : `${head} ${chosen()} of ${metricsFor.length} metrics chosen. Menus marked "suggested" come from the CVSS ${old.version} vector and are not a CVSS ${version} assessment: review every metric. Draft choices are not saved in the project file.`;
    };
    // The calculator button's hint follows the stored score: it says when there is none.
    const calcHint = h('span', { class: 'hint', 'data-testid': 'cvss-calc-hint' });
    const syncHint = () => {
      calcHint.textContent = mismatch() ? `CVSS ${version} assessment pending: review the suggestions and apply`
        : f.cvss ? 'Pick the metrics. The report\'s CVSS version is set in Sections & scoring' : 'Not scored yet: pick the metrics to score this finding';
    };
    const applyButton = h('button', { type: 'button', 'data-testid': 'cvss-apply', disabled: true, onclick: () => { const d = draftVector(); if (d) applyCvss(f, d.vector, version); } }, `Apply CVSS ${version}`);
    // Why Apply is not available yet: the metrics still to choose (shown with a dash).
    const applyReason = h('span', { class: 'hint', 'data-testid': 'cvss-apply-reason' });
    const showCvssNote = (error = typedError, incomplete = false) => {
      typedError = error;
      syncHint();
      applyButton.disabled = !(old && draftVector());
      if (old) {
        const left = metricsFor.filter(([k]) => !picked[k]).map(([, name]) => name);
        applyReason.textContent = left.length ? `Still to choose: ${left.join(', ')}.` : '';
      }
      cvssNote.textContent = error
        ? `${error} Not saved until it is valid, for example ${CVSS_EXAMPLE[version]}. ${f.cvss ? `Still stored: ${f.cvss}.` : ''}`.trim()
        : old
          ? pendingNote()
          : incomplete
            ? `Calculator incomplete: choose all ${count} metrics to change the vector. ${f.cvss ? `Still stored: ${stored()}` : 'Nothing stored yet.'}`
            : stored();
      cvssNote.dataset.kind = error || old ? 'error' : incomplete ? 'pending' : '';
    };
    const cvss = h('input', {
      type: 'text', class: 'mono', value: f.cvss || '', maxlength: 64, spellcheck: 'false', 'data-testid': 'cvss', placeholder: 'Not scored', 'aria-describedby': 'cvss-note',
      oninput: (e) => {
        const v = e.target.value.trim();
        // Clearing a pending finding removes its old score: a deliberate step, with Undo.
        if (v === '') {
          if (old) applyCvss(f, null, version);
          else if (setField(f, 'cvss', null)) { showCvssNote(null); syncCalculator(); renderNav(); }
          return;
        }
        let parsed;
        try { parsed = parseCvss(v); } catch (err) { showCvssNote(err.message); return; }
        // Only vectors in the report's version are entered; the other version is never stored.
        if (parsed.version !== version) {
          showCvssNote(`This report uses CVSS ${version}. Enter a CVSS ${version} vector, or change the report's version in Sections & scoring.`);
          return;
        }
        // A pasted vector replaces a pending finding's old score as an Apply does (with Undo).
        if (old) { applyCvss(f, parsed.vector, version); return; }
        // Only the canonical metric order is stored; the box shows what the user typed until it is re-rendered.
        if (setField(f, 'cvss', parsed.vector)) { showCvssNote(null); syncCalculator(); renderNav(); }
        else {
          // Refused (the size budget): the box and menus go back to what is stored, and the
          // note says the pasted vector was not kept.
          e.target.value = f.cvss || '';
          syncCalculator();
          typedError = null;
          syncHint();
          cvssNote.textContent = `Not saved: the project is at its size limit. ${stored()}`;
          cvssNote.dataset.kind = 'error';
        }
      },
      onblur: (e) => { if (e.target.value.trim() !== (f.cvss || '') && !typedError) e.target.value = f.cvss || ''; },
    });
    // CVSS calculator: pick the Base metrics; the vector and score follow. The arithmetic is
    // src/scoring (CVSS 3.1 specification, FIRST CVSS 4.0 reference); nothing else is stored.
    const picked = draft ? draft.picked : f.cvss ? { ...parseCvss(f.cvss).metrics } : {};
    const selects = metricsFor.map(([key, name, values]) => {
      const tag = h('span', { class: 'suggested', 'data-testid': `cvss-suggested-${key}`, hidden: !draft?.suggested.has(key) }, 'suggested');
      const sel = h('select', { 'data-testid': `cvss-${key}`, 'aria-label': name,
        onchange: (e) => {
          picked[key] = e.target.value;
          if (draft) {
            // A pending finding's calculator is a draft: nothing is stored until Apply.
            draft.suggested.delete(key);
            tag.hidden = true;
            showCvssNote(typedError);
            return;
          }
          if (metricsFor.every(([k]) => picked[k])) {
            const vector = `CVSS:${version}/${metricsFor.map(([k]) => `${k}:${picked[k]}`).join('/')}`;
            // A complete calculator replaces any invalid typed text.
            if (setField(f, 'cvss', parseCvss(vector).vector)) { cvss.value = f.cvss; showCvssNote(null); renderNav(); }
            else { syncCalculator(); showCvssNote(); } // refused (budget): menus show the stored vector again
          } else showCvssNote(typedError, true);
        } },
        h('option', { value: '', selected: !picked[key] }, '–'),
        ...values.map(([v, text]) => h('option', { value: v, selected: picked[key] === v }, text)));
      return h('label', { class: 'field' }, h('span', { class: 'label' }, name, ' ', tag), sel);
    });
    function syncCalculator() {
      const m = f.cvss && !mismatch() ? parseCvss(f.cvss).metrics : {};
      metricsFor.forEach(([key], i) => { picked[key] = m[key]; selects[i].querySelector('select').value = m[key] ?? ''; });
    }
    showCvssNote(null);
    const calculator = h('details', { class: 'cvss-calc', 'data-testid': 'cvss-calculator', open: !!old },
      h('summary', {}, `CVSS ${version} calculator`, calcHint),
      version === '4.0' ? h('p', { class: 'hint' }, 'Base metrics only (CVSS-B). Threat, Environmental and Supplemental metrics are not supported.') : null,
      old ? h('p', { class: 'hint', 'data-testid': 'cvss-previous' }, `Previous assessment, CVSS ${old.version}: ${old.score.toFixed(1)}, ${old.vector}`) : null,
      h('div', { class: 'cvss-grid' }, ...selects),
      old ? h('div', { class: 'row' }, applyButton, applyReason) : null);
    return [
      field(showRating ? ratingLabel : `${ratingLabel} (hidden by the scoring setting)`, rating),
      // A pending finding's box holds its old score: the label names that version.
      field(old ? `${cvssLabel(labels.cvss, old.version)} (CVSS ${version} pending)` : showCvss ? labels.cvss : `${labels.cvss} vector (hidden by the scoring setting)`, cvss, cvssNote),
      calculator,
    ];
  }

  // Plan part counts per screenshot, for the "In the report: N parts" hint on each card.
  function partCounts() {
    const { plan } = currentPlan();
    const out = new Map();
    for (const pf of plan ? plan.findings : []) {
      for (const s of pf.sections) {
        if (s.kind === 'evidence') for (const ev of s.images) out.set(ev.imageId, ev.parts.length);
        if (s.kind === 'blocks') for (const b of s.blocks) if (b.kind === 'evidence') out.set(b.image.imageId, b.image.parts.length);
      }
    }
    return out;
  }

  /** Switches the report's CVSS version in one step: the setting, the version number in the
   * score label, and removing every vector in the other version (they cannot be converted).
   * It asks first when scores are removed, refuses if anything changed while the question was
   * open, and offers Undo for the whole switch. */
  async function switchCvssVersion(select) {
    const p = doc.project;
    const from = reportCvssVersion(doc);
    const next = select.value;
    if (next === from) return;
    const before = { doc, gen: generation, rev: revision };
    // Scores are kept: a finding scored in the old version waits for the tester to apply an
    // assessment in the new one (its calculator suggests what carries over). Nothing converts.
    const pending = doc.findings.filter((f) => f.cvss && cvssVersion(f.cvss) !== next).length;
    if (pending) {
      const one = pending === 1;
      const ok = await confirmDialog(`Use CVSS ${next} for this report? ${one ? `1 finding has a CVSS ${from} score. It is kept, and marked as pending a CVSS ${next} assessment.` : `${pending} findings have CVSS ${from} scores. They are kept, and each one is marked as pending a CVSS ${next} assessment.`} Rootnote does not convert scores: in each finding, review the suggested metrics, choose the rest and apply a CVSS ${next} assessment. Until then, exports that show CVSS are blocked.`, `Use CVSS ${next}`);
      if (!ok || generation !== before.gen || revision !== before.rev || doc !== before.doc) { select.value = from; return; }
    }
    const label = p.labels.cvss;
    const newLabel = switchedCvssLabel(label, next);
    const undoable = undoAvailable(); // decided before the change, as for every removal
    const apply = () => { p.scoring.cvssVersion = next; p.labels.cvss = newLabel; };
    const revert = () => { p.scoring.cvssVersion = from; p.labels.cvss = label; };
    if (!change(apply, revert)) { select.value = from; return; }
    renderNav();
    render();
    say(`This report now uses CVSS ${next}.${pending ? ` ${pending} finding${pending === 1 ? ' is' : 's are'} pending a CVSS ${next} assessment; Check & export lists ${pending === 1 ? 'it' : 'them'}.` : ''}`);
    if (pending && undoable) {
      offerUndo(`Switched the report to CVSS ${next}.`,
        () => (change(revert, apply) ? true : BUDGET_REASON), () => { renderNav(); render(); say(`This report uses CVSS ${from} again.`); });
    }
  }

  // Draft calculators for findings pending a new CVSS version, in memory only: keyed by the
  // project, the finding, the target version and the stored vector, so a changed vector or
  // project starts afresh. Seeded with cvssSuggestions; never saved.
  const cvssDrafts = new WeakMap();
  function cvssDraft(f, version) {
    let byDoc = cvssDrafts.get(doc);
    if (!byDoc) cvssDrafts.set(doc, byDoc = new Map());
    const key = `${f.id}|${version}|${f.cvss}`;
    if (!byDoc.has(key)) {
      const picked = cvssSuggestions(f.cvss, version);
      byDoc.set(key, { picked, suggested: new Set(Object.keys(picked)) });
    }
    return byDoc.get(key);
  }
  /** Replaces a pending finding's score in the other version with `vector` (or clears it),
   * as one change with Undo. Whether Undo is offered is decided before the change (a change
   * can end the over-budget recovery state, where a restore could not fit); without Undo it
   * asks first, and does nothing if the project changed while the question was open. */
  async function applyCvss(f, vector, version) {
    const previous = f.cvss;
    const was = cvssVersion(previous);
    const undoable = undoAvailable();
    if (!undoable) {
      const before = { doc, gen: generation, rev: revision };
      const ok = await confirmDialog(`${vector ? `Replace the CVSS ${was} score of "${short(f.title || '(untitled)')}" with this CVSS ${version} assessment` : `Clear the CVSS ${was} score of "${short(f.title || '(untitled)')}"`}? This cannot be undone while the project is over the size limit.`, vector ? 'Replace' : 'Clear');
      if (!ok || doc !== before.doc || generation !== before.gen || revision !== before.rev || findingById(f.id) !== f || f.cvss !== previous) { render(); return; }
    }
    if (!change(() => { f.cvss = vector; }, () => { f.cvss = previous; })) { render(); return; }
    renderNav();
    render();
    say(vector ? `Applied the CVSS ${version} assessment; it replaces the CVSS ${was} score.` : `Cleared the CVSS ${was} score.`);
    if (undoable) {
      offerUndo(vector ? `Applied CVSS ${version} to "${short(f.title || '(untitled)')}".` : `Cleared the CVSS ${was} score of "${short(f.title || '(untitled)')}".`, () => {
        const g = findingById(f.id);
        if (!g) return 'the finding no longer exists.';
        return change(() => { g.cvss = previous; }, () => { g.cvss = vector; }) || BUDGET_REASON;
      }, () => { renderNav(); render(); say(`The CVSS ${was} score is back.`); });
    }
  }

  /** Applies a change; undoes it and says so if the project would no longer fit. */
  function change(apply, undo) {
    const before = savedBytes();
    apply();
    if (!fits(before)) { undo(); say(BUDGET_MESSAGE, 'error'); return false; }
    markDirty();
    return true;
  }

  // ---- Undo for one removal ----
  // One offer at a time, in memory only (never in a file or draft). It ends on the next
  // successful project edit, a project replacement, Undo or Dismiss; it never expires by
  // time. It has its own region, so status messages do not consume it. In the over-budget
  // recovery state a restore could not grow the project, so removals ask first instead.
  let undoOffer = null; // { gen, rev, restore: () => true | reason, after: () => void, back }
  const undoText = h('span', { 'data-testid': 'undo-text' });
  const undoBar = h('div', { class: 'undo-bar', role: 'status', 'aria-live': 'polite', 'data-testid': 'undo-bar', hidden: true },
    undoText,
    h('button', { type: 'button', 'data-testid': 'undo', onclick: () => runUndo() }, 'Undo'),
    h('button', { type: 'button', class: 'secondary', 'data-testid': 'undo-dismiss', onclick: () => { const back = undoOffer?.back; endUndo(); focusIn(back); } }, 'Dismiss'));
  root.append(undoBar);
  const undoAvailable = () => !recovery;
  /** Before a removal: whether Undo will be offered, decided now (a removal can end the
   * recovery state). Where Undo is not available and the removal loses something,
   * it asks first; null means cancelled, or the project changed while the question was open
   *, so nothing may be removed. */
  async function confirmRemoval(loses, text, label) {
    const offer = undoAvailable();
    if (!loses || offer) return offer;
    const gen = generation;
    const rev = revision;
    const ok = await confirmDialog(text, label);
    return ok && gen === generation && rev === revision ? false : null;
  }
  // Focus the item's own text first (its box, then a field), then its first control.
  const firstControl = (el) => (el.matches('textarea, input, select, button') ? el
    : el.querySelector('textarea') || el.querySelector('input') || el.querySelector('select, button'));
  const focusIn = (el) => { const t = el?.isConnected ? firstControl(el) : null; (t || firstControl(main))?.focus(); };
  const short = (t) => (t.length > 60 ? `${t.slice(0, 57)}…` : t);
  function offerUndo(text, restore, after, back, { endOnSave = false } = {}) {
    undoOffer = { gen: generation, rev: revision, restore, after, back, endOnSave };
    undoText.textContent = text;
    undoBar.hidden = false;
  }
  function endUndo() {
    undoOffer = null;
    undoBar.hidden = true;
    undoText.textContent = '';
  }
  function runUndo() {
    const o = undoOffer;
    if (!o) return;
    endUndo();
    if (o.gen !== generation || o.rev !== revision) return; // already ended; nothing restored
    const result = o.restore(); // true, or why it could not be restored (nothing changed)
    if (result !== true) { say(`Not restored: ${result}`, 'error'); focusIn(o.back); return; }
    o.after();
  }
  // Restores must fit every limit as a whole, or change nothing.
  const imageRoom = (image) => (doc.images.some((x) => x.id === image.id) ? 'the screenshot is already in the project.'
    : evidenceCount() + 1 > LIMITS.evidence ? `the report already uses ${LIMITS.evidence} screenshots, the most Rootnote is tested to handle.`
      : doc.images.length + 1 > LIMITS.images ? `the report already holds ${LIMITS.images} images, the most a project can hold.` : null);
  const BUDGET_REASON = `the project would go over ${CAP}, the most Rootnote is tested to save and reopen. Nothing else has changed.`;
  /** Puts a removed Additional details block (and its image) back at its old place. */
  function restoreBlock(fid, at, block, image = null, imageAt = 0) {
    const f = findingById(fid);
    if (!f) return 'the finding no longer exists.';
    if (!roomForBlocks(f)) return `Additional details can hold at most ${LIMITS.detailBlocks} blocks per finding.`;
    if (blocksOf(f).some((x) => x.id === block.id)) return 'it is already there.';
    if (block.type === 'text' && detailsTextLength(f) + block.text.length > LIMITS.text) return `the text of Additional details is limited to ${LIMITS.text} characters per finding.`;
    const room = image && imageRoom(image);
    if (room) return room;
    const created = !f.details;
    const b = structuredClone(block);
    const im = image && structuredClone(image);
    return change(() => {
      if (created) f.details = [];
      f.details.splice(Math.min(at, f.details.length), 0, b);
      if (im) doc.images.splice(Math.min(imageAt, doc.images.length), 0, im);
    }, () => {
      f.details.splice(f.details.indexOf(b), 1);
      if (created) delete f.details;
      if (im) doc.images.splice(doc.images.indexOf(im), 1);
    }) || BUDGET_REASON;
  }
  /** Back to the view that shows the restored item, then focus it. */
  function showRestored(where, selector) {
    if (view !== where) view = where;
    render();
    focusIn(main.querySelector(selector));
  }

  // Additional details is optional in a v3 file: read it as [] and create it
  // only when something is added. Every insertion checks the 100-block cap (rule 16)
  // against the current count, so the project always stays valid.
  const blocksOf = (f) => f.details ?? [];
  const BLOCK_CAP_MESSAGE = `Not added: ${'Additional details'} can hold at most ${LIMITS.detailBlocks} text and screenshot blocks per finding.`;
  const roomForBlocks = (f, n = 1) => blocksOf(f).length + n <= LIMITS.detailBlocks;
  /** Inserts blocks at `at`; refuses (changing nothing) over the cap or the budget. */
  function insertBlocks(f, at, blocks, also = { apply() {}, undo() {} }) {
    if (!roomForBlocks(f, blocks.length)) { say(BLOCK_CAP_MESSAGE, 'error'); return false; }
    const created = !f.details;
    return change(() => { if (created) f.details = []; f.details.splice(at, 0, ...blocks); also.apply(); },
      () => { also.undo(); f.details.splice(at, blocks.length); if (created) delete f.details; });
  }

  // Where new screenshots go: Additional details after a block (after: null = at the
  // start), or the Evidence gallery. Paste uses the details text box last focused.
  let lastDetailsFocus = null; // { fid, blockId }
  let pickTarget = null;
  const pickInput = h('input', {
    type: 'file', accept: 'image/png,image/jpeg', multiple: true, hidden: true, 'data-testid': 'image-input',
    onchange: (e) => {
      const files = [...e.target.files];
      e.target.value = '';
      // Without a chosen place (the input used directly), use the finding's default place.
      const f = findingById(pickTarget?.fid ?? view);
      if (f) addImages(f.id, files, pickTarget ?? defaultTarget(f));
      pickTarget = null;
    },
  });
  root.append(pickInput);
  function pickFiles(fid, target) {
    pickTarget = { fid, ...target };
    pickInput.click();
  }
  /** The default place for pasted or dropped screenshots: a visible section, details first. */
  function defaultTarget(f) {
    const at = lastDetailsFocus?.fid === f.id && blocksOf(f).some((b) => b.id === lastDetailsFocus.blockId)
      ? lastDetailsFocus.blockId : (blocksOf(f).at(-1)?.id ?? null);
    if (sectionConfig('finding', 'details').enabled || !sectionConfig('finding', 'evidence').enabled) return { where: 'details', after: at };
    return { where: 'evidence' };
  }

  function findingView(f) {
    const i = doc.findings.indexOf(f);
    const fs = (key) => sectionConfig('finding', key);
    // Marked as headings so a screen reader can move from section to section; the look is unchanged.
    const heading = (key) => h('span', { class: 'label', role: 'heading', 'aria-level': '2' }, fs(key).label, ' ', hiddenNote('finding', key));
    const assets = h('textarea', {
      rows: 1, class: 'autogrow', value: (f.affectedAssets || []).join('\n'), 'aria-label': fs('assets').label, placeholder: 'One per line', title: 'One per line',
      oninput: (e) => {
        const next = sanitizeText(e.target.value).split(/\r?\n/).map((s) => s.trim().slice(0, LIMITS.line)).filter(Boolean).slice(0, LIMITS.assets);
        if (!setField(f, 'affectedAssets', next)) e.target.value = (f.affectedAssets || []).join('\n');
      },
    });
    const dropZone = (target, ...content) => {
      const zone = h('div', {
        class: 'drop',
        ondragover: (e) => { e.preventDefault(); zone.classList.add('over'); },
        ondragleave: () => zone.classList.remove('over'),
        ondrop: (e) => { e.preventDefault(); zone.classList.remove('over'); addImages(f.id, imageFilesFrom(e.dataTransfer), typeof target === 'function' ? target() : target); },
      }, ...content);
      return zone;
    };

    // ---- Evidence gallery (optional; off by default for new projects) ----
    const evidence = h('div', { class: 'evidence', 'data-testid': 'evidence' });
    const renderEvidence = () => {
      const parts = partCounts();
      evidence.replaceChildren(...f.evidence.map((id, k) => imageCard(f, imageById(id), { list: f.evidence, k, where: 'evidence', rerender: redrawAll, partCount: parts.get(id) })));
    };
    const gallery = () => {
      if (!fs('evidence').enabled && !f.evidence.length) {
        return h('p', { class: 'hint', dataset: { section: 'evidence' } }, `The separate ${fs('evidence').label} section is off (Sections & scoring). Screenshots go in ${fs('details').label}.`);
      }
      renderEvidence();
      return h('div', { dataset: { section: 'evidence' } }, h('h2', {}, fs('evidence').label, ' ', hiddenNote('finding', 'evidence')),
        dropZone({ where: 'evidence' },
          h('p', {}, h('strong', {}, 'Drop PNG/JPEG files here'), ' or ',
            h('button', { type: 'button', class: 'linkish', onclick: () => pickFiles(f.id, { where: 'evidence' }) }, 'choose files'), ' to add them to this section.'),
          h('p', { class: 'hint' }, 'Max 2 MB and 16 megapixels per screenshot. Screenshots taller than a page are split into page-sized parts unless set to "shrink to fit".')),
        evidence);
    };

    // ---- Additional details: text and screenshot blocks in order ----
    const details = h('div', { class: 'field blocks', dataset: { section: 'details' }, 'data-testid': 'details-blocks',
      onfocusin: (e) => { const b = e.target.closest('[data-block]'); if (b) lastDetailsFocus = { fid: f.id, blockId: b.dataset.block }; } });
    const dot = () => h('span', { class: 'insert-sep', 'aria-hidden': 'true' }, '·');
    const insertBar = (after, end = false) => h('div', { class: end ? 'insert end' : 'insert', dataset: { after: after ?? '' } },
      h('span', { class: 'insert-pill', role: 'group', 'aria-label': 'Add here' }, icon('plus', 'icon sm'),
        h('button', { type: 'button', 'data-testid': 'add-text', 'aria-label': 'Add a text block', onclick: () => addTextBlock(after) }, 'Text'), dot(),
        h('button', { type: 'button', 'data-testid': 'add-code', 'aria-label': 'Add a code block', onclick: () => addTextBlock(after, '', 'code') }, 'Code'), dot(),
        h('button', { type: 'button', 'data-testid': 'add-screenshot', 'aria-label': 'Add a screenshot', onclick: () => pickFiles(f.id, { where: 'details', after }) }, 'Screenshot'), dot(),
        h('button', { type: 'button', 'data-testid': 'add-repro', 'aria-label': 'Add reproduction prompts', title: 'A text block of [[prompts]] for conditions, steps, expected and observed results', onclick: () => addTextBlock(after, REPRO_PROMPTS) }, 'Reproduction prompts')));
    const textBox = (b, k) => {
      const allowed = () => LIMITS.text - (detailsTextLength(f) - (b ? b.text.length : 0));
      const area = h('textarea', {
        rows: 1, class: b?.format === 'code' ? 'code autogrow' : 'autogrow', spellcheck: b?.format === 'code' ? 'false' : null, value: b ? b.text : '',
        maxlength: allowed(), 'data-testid': 'details-text', 'aria-label': `${fs('details').label} text${b ? ` ${k + 1}` : ''}`,
        placeholder: b ? null : 'Steps to reproduce, requests, observations…',
        oninput: (e) => {
          let block = b;
          if (!block) { // the empty box becomes the first block on the first keystroke
            block = textBlock('', 'plain');
            if (!insertBlocks(f, 0, [block])) { e.target.value = ''; return; }
            b = block;
            e.target.closest('.block').dataset.block = block.id;
            lastDetailsFocus = { fid: f.id, blockId: block.id };
          }
          const clean = sanitizeText(e.target.value).slice(0, allowed());
          if (!setField(block, 'text', clean)) { e.target.value = block.text; return; }
          if (clean !== e.target.value) e.target.value = clean;
          e.target.maxLength = allowed();
        },
      });
      const remove = async () => {
        const populated = !!b.text.trim();
        const offer = await confirmRemoval(populated, `Remove this text block from ${displayId(f)}?`, 'Remove');
        if (offer === null) return;
        const at = f.details.indexOf(b);
        if (at < 0) return;
        const copy = structuredClone(b);
        if (!change(() => f.details.splice(at, 1), () => f.details.splice(at, 0, b))) return;
        redrawAll();
        const blocks = details.querySelectorAll('[data-block]');
        const back = blocks[Math.min(at, blocks.length - 1)] || details.querySelector('[data-testid=add-text]');
        focusIn(back);
        if (populated && offer) {
          offerUndo(`Removed a text block from ${displayId(f)}.`, () => restoreBlock(f.id, at, copy),
            () => showRestored(f.id, `[data-block="${copy.id}"]`), back);
        }
      };
      // The block's tools are always in the tab order and on screen while the block is
      // focused or hovered; they never depend on hover alone.
      const el = h('div', { class: 'block block-text', dataset: { block: b ? b.id : '' } },
        b ? h('div', { class: 'row small block-head' },
          h('span', { class: 'kind' }, icon(b.format === 'code' ? 'code' : 'text', 'icon sm'), b.format === 'code' ? 'Code · exported exactly as typed' : 'Text'), h('span', { class: 'spacer' }),
          h('span', { class: 'block-tools' },
            h('button', { type: 'button', class: 'ghost iconbtn', 'data-testid': 'block-copy', 'aria-label': 'Copy this block\'s text', title: 'Copy text', onclick: () => copyText(b.text, 'text') }, icon('copy')),
            blockMenu('text block', f.details, k, 'text block', redrawAll, [
              [b.format === 'code' ? 'Change to plain text' : 'Change to code (exactly as typed)', () => { if (setField(b, 'format', b.format === 'code' ? 'plain' : 'code')) { redrawAll(); details.querySelector(`[data-block="${b.id}"] textarea`)?.focus(); } }, { 'data-testid': 'block-format' }]],
              remove))) : null,
        area);
      return b ? sortable(el, f.details, k, 'text block', redrawAll) : el;
    };
    function addTextBlock(after, text = '', format = 'plain') {
      const b = textBlock(text, format);
      const at = after === null ? 0 : blocksOf(f).findIndex((x) => x.id === after) + 1;
      if (!insertBlocks(f, at, [b])) return;
      redrawAll();
      details.querySelector(`[data-block="${b.id}"] textarea`)?.focus();
    }
    const renderDetails = () => {
      const parts = partCounts();
      const items = [];
      blocksOf(f).forEach((b, k) => {
        items.push(b.type === 'text' ? textBox(b, k)
          : imageCard(f, imageById(b.imageId), { list: f.details, k, where: 'details', block: b, rerender: redrawAll, partCount: parts.get(b.imageId) }));
        items.push(insertBar(b.id, k === blocksOf(f).length - 1));
      });
      const texts = blocksOf(f).filter((b) => b.type === 'text').length;
      const shots = blocksOf(f).length - texts;
      const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
      details.replaceChildren(
        h('div', { class: 'row sect-head' }, heading('details'), h('span', { class: 'spacer' }),
          blocksOf(f).length ? h('span', { class: 'fmt' }, `${plural(texts, 'text block')} · ${plural(shots, 'screenshot')}`) : null),
        h('p', { class: 'hint details-help' }, 'How to reproduce it, with screenshots where they belong. Ctrl+V pastes a screenshot after the box you are in.'),
        blocksOf(f).length ? insertBar(null) : null,
        ...(blocksOf(f).length ? items : [textBox(null, 0), insertBar(null, true)]),
        dropZone(() => ({ where: 'details', after: blocksOf(f).at(-1)?.id ?? null }), h('p', { class: 'hint' }, 'Drop PNG or JPEG files here to add them at the end (up to 2 MB and 16 megapixels each).')));
    };

    const textSection = (key) => {
      const box = h('div', { class: 'field', dataset: { section: key } });
      const redraw = () => box.replaceChildren(
        h('div', { class: 'row sect-head' }, heading(key), h('span', { class: 'spacer' }), formatSelect(f.formats, key, () => { redraw(); fitAll(); })),
        textArea(f, key, { rows: 3, code: f.formats[key] === 'code', 'data-testid': key, 'aria-label': fs(key).label }),
        ...(f.formats[key] === 'code' ? [h('span', { class: 'hint' }, 'Exported exactly as typed, in a monospace style.')] : []));
      redraw();
      return box;
    };
    const galleryBox = h('div', {});
    function redrawAll() {
      renderDetails();
      galleryBox.replaceChildren(gallery());
      renderNav();
      fitAll(); // local redraws replace boxes outside renderMain
    }
    redrawAll();
    const sections = doc.project.sections.finding.map((s) => {
      if (s.key === 'assets') return null; // in the key facts (agreed mockup)
      if (s.key === 'details') return details;
      if (s.key === 'evidence') return galleryBox;
      if (s.key === 'references') return referencesEditor(f, s.label);
      return textSection(s.key);
    });

    // the title leads; the display ID is a tag above it;
    // moving and deleting the finding sit in its menu, Delete still asks first.
    const [ratingCell, cvssCell, calculator] = scoringFields(f);
    const assetsOn = doc.project.sections.finding.some((s) => s.key === 'assets');
    const assetsCell = h('label', { class: 'field', dataset: { section: 'assets' } }, heading('assets'), assets);
    return h('section', { class: 'panel finding', dataset: { finding: f.id } },
      h('div', { class: 'row finding-head' },
        findingTag(f),
        h('span', { class: 'spacer' }),
        formattingHelp(),
        h('button', { type: 'button', class: 'ghost live-toggle live-show', 'data-testid': 'live-show', hidden: livePane,
          onclick: () => { setLive(true); live.querySelector('[data-testid=live-hide]')?.focus(); } }, icon('eye'), 'Live page'),
        menuOf(`More actions for ${displayId(f)}`, 'finding-menu', [
          ['Copy as text', () => copyFindingDialog(f), { 'data-testid': 'copy-finding' }],
          ['Save to library', () => saveToLibrary(f), { 'data-testid': 'save-to-library' }],
          i > 0 ? ['Move up', () => moveFinding(f, -1), { 'aria-label': 'Move finding up' }] : null,
          i < doc.findings.length - 1 ? ['Move down', () => moveFinding(f, 1), { 'aria-label': 'Move finding down' }] : null,
          ['Delete', () => deleteFinding(f), { class: 'menu-item danger-item' }]])),
      h('label', { class: 'field title-field' }, h('span', { class: 'sr-only' }, 'Title'),
        lineInput(f, 'title', { 'data-testid': 'finding-title', class: 'title-input', placeholder: 'Finding title', onChange: renderNav })),
      h('div', { class: 'facts', 'data-testid': 'key-facts' }, ratingCell, cvssCell, assetsOn ? assetsCell : null, statusField(f), ...classificationFields(f)),
      calculator,
      ...sections);
  }

  /** How text boxes become report paragraphs, once, on request. */
  function formattingHelp() {
    const pop = h('details', { class: 'menu help-pop', 'data-testid': 'format-help' },
      h('summary', { class: 'iconbtn', 'aria-label': 'Formatting help', title: 'Formatting help' }, h('span', { 'aria-hidden': 'true' }, '?')),
      h('div', { class: 'menu-list help-body' },
        h('strong', {}, 'Formatting help'),
        h('p', {}, 'A blank line starts a new paragraph.'),
        h('p', {}, 'A line starting with "- " becomes a bullet.'),
        h('p', {}, 'Code keeps text exactly as typed, in a monospace style. Choose it in a block\'s ⋯ menu or a section\'s format list.'),
        h('p', {}, 'Ctrl+V pastes a screenshot after the box you are in.')));
    pop.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop.open) { e.stopPropagation(); pop.open = false; pop.querySelector('summary').focus(); } });
    return pop;
  }

  /** The finding's tag: its rating (or CVSS band) in the report's colour, its display ID and
   * its status, as the agreed mockup shows above the title. */
  function findingTag(f) {
    const { mode } = doc.project.scoring;
    const labels = doc.project.labels;
    const parsed = f.cvss ? parseCvss(f.cvss) : null;
    const score = parsed?.score ?? null;
    // As in the report: a score in the report's version is plain, another version is named.
    const scoreText = parsed ? (parsed.version === reportCvssVersion(doc) ? score.toFixed(1) : `${score.toFixed(1)} (${parsed.version})`) : null;
    const badge = mode === 'cvss' ? cvssBadge(score) : ratingBadge(f.rating);
    const level = mode === 'cvss' ? (score === null ? labels.unscored : `${cvssLabel(labels.cvss, reportCvssVersion(doc))} ${scoreText}`) : (f.rating || labels.unscored);
    const band = [level, mode !== 'cvss' && mode.endsWith('cvss') && score !== null ? scoreText : null].filter(Boolean).join(' · ');
    return h('div', { class: 'tag', 'data-testid': 'finding-tag' },
      h('span', { class: badge ? 'tag-band' : 'tag-band unrated', style: badge ? `background: #${badge.fill}; color: #${badge.textColor}` : null }, band),
      h('h1', { class: 'tag-id', 'data-testid': 'finding-id' }, displayId(f)),
      h('span', { class: 'tag-status' }, formatFindingStatus(f.status, { notSet: labels.statusNotSet })));
  }

  /** CWE and vulnerability type (schema v6): the tester's own entries, never looked up. A CWE
   * that does not look like CWE-79 is not stored; the field says so and keeps it on screen
   * until it is fixed or left, when it shows the stored value again. */
  function classificationFields(f) {
    const labels = doc.project.labels;
    const help = 'For example CWE-79. Not looked up.';
    const note = h('span', { class: 'hint', 'data-testid': 'cwe-note' }, help);
    const cwe = h('input', {
      type: 'text', value: f.cwe, maxlength: 9, placeholder: 'CWE-79', spellcheck: 'false', class: 'mono', 'data-testid': 'finding-cwe',
      oninput: (e) => {
        const v = e.target.value; // stored exactly as typed, or not at all (no silent coercion)
        if (cweErrors(v).length) { note.textContent = `Not saved yet: a CWE looks like CWE-79, with no spaces (or leave it empty). Saved value: ${f.cwe || '(empty)'}.`; note.dataset.kind = 'pending'; return; }
        note.textContent = help;
        delete note.dataset.kind;
        if (v !== f.cwe && !setField(f, 'cwe', v)) e.target.value = f.cwe;
      },
      onblur: (e) => { e.target.value = f.cwe; note.textContent = help; delete note.dataset.kind; },
    });
    const type = h('input', {
      type: 'text', value: f.vulnerabilityType, maxlength: CUSTOM_LIMITS.vulnerabilityType, placeholder: 'e.g. Stored cross-site scripting', 'data-testid': 'finding-type',
      oninput: (e) => {
        const v = capUnits(sanitizeLine(e.target.value), CUSTOM_LIMITS.vulnerabilityType).trim();
        if (v !== f.vulnerabilityType && !setField(f, 'vulnerabilityType', v)) e.target.value = f.vulnerabilityType;
      },
      onblur: (e) => { e.target.value = f.vulnerabilityType; },
    });
    return [field(labels.vulnerabilityType, type), field(labels.cwe, cwe, note)];
  }

  function statusField(f) {
    const notSet = doc.project.labels.statusNotSet;
    return field(doc.project.labels.status, h('select', { 'data-testid': 'finding-status', onchange: (e) => { const v = e.target.value || null; if (!setField(f, 'status', v)) e.target.value = f.status ?? ''; else renderNav(); } },
      h('option', { value: '', selected: f.status === null }, formatFindingStatus(null, { notSet })),
      ...FINDING_STATUSES.map((st) => h('option', { value: st, selected: f.status === st }, formatFindingStatus(st)))),
    'Your record; not verified.');
  }

  // References (schema v4 rule 18): the list changes only when it stays valid as a whole, so a
  // half-typed address is never stored. Text only; nothing is fetched.
  function referencesEditor(f, label) {
    const box = h('div', { class: 'field references', dataset: { section: 'references' }, 'data-testid': 'references' });
    const units = (list) => list.reduce((n, r) => n + r.title.length + r.url.length, 0);
    const problems = (r, list) => [
      ...referenceTitleErrors(r.title).map((m) => `Title ${m}.`),
      ...referenceUrlErrors(r.url).map((m) => `Address ${m}.`),
      ...(units(list) > REFERENCE_LIMITS.units ? [`Titles and addresses of one finding are limited to ${REFERENCE_LIMITS.units} characters.`] : []),
    ];
    // True when the list was replaced; false when the size budget refused it (nothing changed).
    const commit = (next) => {
      const prev = f.references;
      const set = () => { if (next.length) f.references = next; else delete f.references; };
      const undo = () => { if (prev === undefined) delete f.references; else f.references = prev; };
      if (!change(set, undo)) return false;
      redraw();
      return true;
    };
    // Stage 5: removed at once and offered for Undo; where Undo is not available, ask.
    const removeReference = async (k) => {
      const list = f.references ?? [];
      const r = list[k];
      if (!r) return;
      const offer = await confirmRemoval(true, `Remove the reference "${r.title}"?`, 'Remove');
      if (offer === null || (f.references ?? [])[k] !== r) return;
      const copy = { ...r };
      if (!commit(list.filter((_, j) => j !== k))) return;
      const rowsLeft = box.querySelectorAll('[data-ref]');
      const back = rowsLeft[Math.min(k, rowsLeft.length - 1)] || box.querySelector('[data-testid=new-reference-title]');
      focusIn(back);
      if (!offer) return;
      const fid = f.id;
      offerUndo(`Removed the reference "${short(copy.title)}".`, () => {
        const g = findingById(fid);
        if (!g) return 'the finding no longer exists.';
        const now = g.references ?? [];
        if (now.length >= REFERENCE_LIMITS.perFinding) return `at most ${REFERENCE_LIMITS.perFinding} references per finding.`;
        if (units(now) + copy.title.length + copy.url.length > REFERENCE_LIMITS.units) return `titles and addresses of one finding are limited to ${REFERENCE_LIMITS.units} characters.`;
        const prev = g.references;
        const next = [...now];
        next.splice(Math.min(k, next.length), 0, { ...copy });
        return change(() => { g.references = next; }, () => { if (prev === undefined) delete g.references; else g.references = prev; }) || BUDGET_REASON;
      }, () => showRestored(fid, `[data-ref="${k}"]`), back);
    };
    const redraw = () => {
      const list = f.references ?? [];
      const note = h('span', { class: 'hint', role: 'alert', 'data-testid': 'reference-error' });
      const rows = list.map((r, k) => {
        const edit = (key) => (e) => {
          const cand = { ...r, [key]: key === 'title' ? sanitizeLine(e.target.value).trim() : e.target.value.trim() };
          const next = list.map((x, j) => (j === k ? cand : x));
          const errs = problems(cand, next);
          if (errs.length) { note.textContent = `Not changed: ${errs.join(' ')}`; e.target.value = r[key]; return; }
          // A budget refusal leaves the stored value, so the field shows it again.
          if (!commit(next)) e.target.value = r[key];
        };
        // Title over address in one column, the row's buttons grouped beside them.
        return h('li', { class: 'reference', dataset: { ref: String(k) } },
          h('div', { class: 'ref-fields' },
            h('input', { type: 'text', value: r.title, maxlength: REFERENCE_LIMITS.title, 'aria-label': `Reference ${k + 1} title`, 'data-testid': 'reference-title', placeholder: 'Title', onchange: edit('title') }),
            h('input', { type: 'text', value: r.url, maxlength: REFERENCE_LIMITS.url, 'aria-label': `Reference ${k + 1} address`, 'data-testid': 'reference-url', placeholder: 'https://… (optional)', spellcheck: 'false', onchange: edit('url') })),
          h('div', { class: 'ref-actions' },
            // Keyboard focus follows the moved reference to its new row.
            ...[[-1, '↑', 'up'], [1, '↓', 'down']].map(([dir, arrow, word], d) => h('button', { type: 'button', class: 'secondary',
              disabled: k + dir < 0 || k + dir >= list.length, 'aria-label': `Move reference ${k + 1} ${word}`,
              onclick: () => moveIn(list, k, dir, () => {
                redraw();
                const row = box.querySelector(`[data-ref="${k + dir}"]`);
                const same = row?.querySelectorAll('.ref-actions button')[d];
                (same && !same.disabled ? same : row?.querySelector('[data-testid=reference-title]'))?.focus();
              }) }, arrow)),
            h('button', { type: 'button', class: 'secondary', 'aria-label': `Remove reference ${k + 1}`, onclick: () => removeReference(k) }, 'Remove')));
      });
      const title = h('input', { type: 'text', maxlength: REFERENCE_LIMITS.title, 'aria-label': 'New reference title', 'data-testid': 'new-reference-title', placeholder: 'Title, e.g. OWASP WSTG v4.2 WSTG-ATHZ-04' });
      const url = h('input', { type: 'text', maxlength: REFERENCE_LIMITS.url, 'aria-label': 'New reference address', 'data-testid': 'new-reference-url', placeholder: 'https://… (optional)', spellcheck: 'false' });
      const add = () => {
        const cand = { title: sanitizeLine(title.value).trim(), url: url.value.trim() };
        const next = [...list, cand];
        const errs = [...(list.length >= REFERENCE_LIMITS.perFinding ? [`At most ${REFERENCE_LIMITS.perFinding} references per finding.`] : []), ...problems(cand, next)];
        if (errs.length) { note.textContent = `Not added: ${errs.join(' ')}`; return; }
        commit(next);
      };
      box.replaceChildren(h('span', { class: 'label' }, label, ' ', hiddenNote('finding', 'references')),
        h('div', { class: 'ref-grid' },
          list.length ? h('ol', { class: 'reference-list' }, ...rows) : null,
          h('div', { class: 'reference reference-new' },
            h('div', { class: 'ref-fields' }, title, url),
            h('div', { class: 'ref-actions' },
              h('button', { type: 'button', class: 'secondary', 'data-testid': 'add-reference', disabled: list.length >= REFERENCE_LIMITS.perFinding, onclick: add }, 'Add reference')))),
        note,
        h('span', { class: 'hint' }, 'Printed as text in the report, not as links. Do not put tokens or passwords in addresses.'));
    };
    redraw();
    return box;
  }

  /** A screenshot card in the gallery (where 'evidence', list = f.evidence of ids) or in
   * Additional details (where 'details', list = f.details, block = its image block). */
  function imageCard(f, im, { list, k, where, block = null, rerender, partCount }) {
    const remove = async () => {
      const offer = await confirmRemoval(true, `Remove screenshot ${im.id} from ${displayId(f)}?`, 'Remove');
      if (offer === null) return;
      const at = where === 'evidence' ? f.evidence.indexOf(im.id) : f.details.indexOf(block);
      const imageAt = doc.images.indexOf(im);
      if (at < 0 || imageAt < 0) return;
      const image = structuredClone(im);
      const blockCopy = block && structuredClone(block);
      if (where === 'evidence') f.evidence = f.evidence.filter((id) => id !== im.id);
      else f.details = f.details.filter((b) => b !== block);
      doc.images = doc.images.filter((x) => x.id !== im.id);
      markDirty();
      rerender();
      const section = main.querySelector(`[data-section=${where}]`);
      const cards = section ? [...section.querySelectorAll(where === 'evidence' ? '[data-image]' : '[data-block]')] : [];
      const back = cards[Math.min(at, cards.length - 1)] || section?.querySelector('[data-testid=add-screenshot], button');
      focusIn(back);
      if (!offer) return;
      const fid = f.id;
      offerUndo(`Removed screenshot ${image.id} from ${displayId(f)}.`, () => {
        if (where !== 'evidence') return restoreBlock(fid, at, blockCopy, image, imageAt);
        const g = findingById(fid);
        if (!g) return 'the finding no longer exists.';
        const room = imageRoom(image);
        if (room) return room;
        const copy = structuredClone(image);
        return change(() => { g.evidence.splice(Math.min(at, g.evidence.length), 0, copy.id); doc.images.splice(Math.min(imageAt, doc.images.length), 0, copy); },
          () => { g.evidence.splice(g.evidence.indexOf(copy.id), 1); doc.images.splice(doc.images.indexOf(copy), 1); }) || BUDGET_REASON;
      }, () => showRestored(fid, `[data-image="${image.id}"]`), back);
    };
    // Moving keeps the same image record: only the reference moves (no copy, no re-encode).
    const move = () => {
      if (where === 'evidence') {
        const at = f.evidence.indexOf(im.id);
        if (!insertBlocks(f, blocksOf(f).length, [imageBlock(im.id)], { apply: () => f.evidence.splice(at, 1), undo: () => f.evidence.splice(at, 0, im.id) })) return;
      } else {
        const at = f.details.indexOf(block);
        if (!change(() => { f.details.splice(at, 1); f.evidence.push(im.id); }, () => { f.evidence.pop(); f.details.splice(at, 0, block); })) return;
      }
      rerender();
    };
    const other = sectionConfig('finding', where === 'evidence' ? 'details' : 'evidence').label;
    return sortable(h('figure', { class: 'card block', dataset: { image: im.id, ...(block ? { block: block.id } : {}) } },
      h('img', { src: im.dataUrl, alt: im.caption || im.id, loading: 'lazy' }),
      h('figcaption', { class: 'shot-body' },
        h('div', { class: 'row small' }, h('span', { class: 'kind' }, icon('image', 'icon sm'), `Screenshot · ${im.id}`)),
        h('label', { class: 'field cap-field' }, h('span', { class: 'sr-only' }, 'Caption'),
          lineInput(im, 'caption', { 'data-testid': 'caption', placeholder: 'Caption: what this screenshot shows' })),
        h('div', { class: 'row small shot-meta' }, h('span', {}, `${im.width} × ${im.height} · ${(im.bytes / 1024).toFixed(0)} KB`),
          partCount ? h('span', { class: 'chip', 'data-testid': 'part-count' }, `In the report on ${doc.project.paperSize}: ${partCount === 1 ? 'one part' : `${partCount} parts`}.`) : null,
          editNotes.has(`${generation}:${im.id}`) ? h('span', { class: 'chip', 'data-testid': 'edit-note' }, editNotes.get(`${generation}:${im.id}`)) : null),
        h('div', { class: 'row small shot-tools' },
          h('label', { class: 'tall' }, 'If taller than a page ',
            h('select', { 'data-testid': 'tall-mode', onchange: (e) => { if (!setField(im, 'tallMode', e.target.value)) e.target.value = im.tallMode; else rerender(); } },
              h('option', { value: 'auto', selected: im.tallMode === 'auto' }, 'automatic (split if taller than a page)'),
              h('option', { value: 'split', selected: im.tallMode === 'split' }, 'split into parts'),
              h('option', { value: 'fit', selected: im.tallMode === 'fit' }, 'shrink to fit'))),
          h('button', { type: 'button', class: 'ghost small-btn', 'data-testid': 'edit-screenshot', onclick: () => editScreenshot(f, im, rerender) }, 'Black out or crop…'),
          h('span', { class: 'spacer' }),
          h('span', { class: 'block-tools' },
            blockMenu('screenshot', list, k, 'screenshot', rerender, [[`Move to ${other}`, move, { 'data-testid': 'move-section' }]], remove))))), list, k, 'screenshot', rerender);
  }

  // What was done to a screenshot in this session, for the card's chip (not saved anywhere).
  const editNotes = new Map(); // `${generation}:${imageId}` -> summary
  async function editScreenshot(f, im, rerender) {
    const gen = generation;
    let result;
    try { result = await editImage(im); } catch { say(`Screenshot ${im.id} could not be opened for editing.`, 'error'); return; }
    if (!result || gen !== generation || !doc.images.includes(im)) return;
    let rec;
    try { rec = await importImageBytes(result.bytes, { name: im.originalName || im.id }); } catch (err) {
      say(`The edited screenshot was not saved: ${err.message} The original is unchanged.`, 'error');
      return;
    }
    if (gen !== generation || !doc.images.includes(im)) return;
    const at = doc.images.indexOf(im);
    const next = { ...im, mime: rec.mime, dataUrl: rec.dataUrl, width: rec.width, height: rec.height, bytes: rec.bytes, sha256: rec.sha256 };
    if (!change(() => { doc.images[at] = next; }, () => { doc.images[at] = im; })) return;
    editNotes.set(`${generation}:${im.id}`, result.summary);
    rerender();
    main.querySelector(`[data-image="${im.id}"] [data-testid=edit-screenshot]`)?.focus();
    const fid = f.id;
    offerUndo(`Edited screenshot ${im.id}: ${result.summary}.`, () => {
      const k = doc.images.indexOf(next);
      if (k < 0) return 'the screenshot has changed since.';
      return change(() => { doc.images[k] = im; }, () => { doc.images[k] = next; }) || BUDGET_REASON;
    }, () => { editNotes.delete(`${generation}:${im.id}`); showRestored(fid, `[data-image="${im.id}"]`); }, main.querySelector(`[data-image="${im.id}"]`), { endOnSave: true });
  }

  // Decodes in parallel, then commits each image against the *current* project, at
  // `target`: { where: 'details', after: blockId | null } or { where: 'evidence' }.
  async function addImages(fid, files, target) {
    if (!files.length) return;
    const gen = generation;
    say(`Checking ${files.length} screenshot${files.length === 1 ? '' : 's'}…`);
    // Files beyond the remaining screenshot slots are refused before anything is read,
    // and at most DECODE_BATCH files are read and decoded at a time.
    const slots = Math.max(0, LIMITS.evidence - evidenceCount());
    const results = [];
    for (let i = 0; i < files.length; i += DECODE_BATCH) {
      results.push(...await Promise.allSettled(files.slice(i, i + DECODE_BATCH).map(async (file, k) => {
        const label = file.name || 'Pasted image';
        if (i + k >= slots) throw new Error(`${label} was not added. ${SCREENSHOTS_FULL}`);
        if (file.size > LIMITS.imageBytes) throw new Error(imageTooLarge(label, file.size));
        return importImageBytes(await readFileBytes(file), { name: file.name });
      })));
      if (gen !== generation) break;
    }
    const errors = [];
    let added = 0;
    if (gen !== generation) {
      say('The project was replaced while screenshots were being checked; they were not added.', 'error');
      return;
    }
    const f = findingById(fid);
    if (!f) {
      say('The finding was deleted while screenshots were being checked; they were not added.', 'error');
      return;
    }
    // The insertion point must still exist (a removed text block cancels the import).
    let after = target.where === 'details' ? target.after : null;
    if (after !== null && !blocksOf(f).some((b) => b.id === after)) {
      say('The place where the screenshots were being added was removed; they were not added.', 'error');
      return;
    }
    for (const [i, r] of results.entries()) {
      const label = files[i].name || 'image';
      if (r.status === 'rejected') { errors.push(r.reason?.message || `${label}: could not be read.`); continue; }
      if (evidenceCount() >= LIMITS.evidence) { errors.push(`Limit of ${LIMITS.evidence} screenshots reached; ${label} was not added.`); continue; }
      // The block cap is checked against the current count before anything is committed.
      if (target.where === 'details' && !roomForBlocks(f)) { errors.push(`${label}: ${BLOCK_CAP_MESSAGE}`); continue; }
      try {
        if (target.where === 'evidence') {
          commitImage(r.value, (id) => { f.evidence.push(id); return () => f.evidence.pop(); });
        } else {
          commitImage(r.value, (id) => {
            const b = imageBlock(id);
            const created = !f.details;
            if (created) f.details = [];
            const at = after === null ? 0 : f.details.findIndex((x) => x.id === after) + 1;
            f.details.splice(at, 0, b);
            const prev = after;
            after = b.id; // the next screenshot follows this one
            return () => { f.details.splice(at, 1); if (created) delete f.details; after = prev; };
          });
        }
        added++;
      } catch (err) {
        errors.push(err.message);
      }
    }
    if (added) markDirty();
    renderNav();
    if (view === fid) renderMain();
    const section = sectionConfig('finding', target.where);
    if (errors.length) say(errors.join(' '), 'error');
    else say(`Added ${added} screenshot${added === 1 ? '' : 's'} to ${section.label} of ${displayId(f)}.${section.enabled ? '' : ` ${section.label} is hidden in the report (Sections & scoring).`}`);
  }

  function onPaste(e) {
    const f = findingById(view);
    if (!f) return;
    const files = imageFilesFrom(e.clipboardData);
    if (!files.length) return; // plain text paste continues normally
    e.preventDefault();
    const inGallery = e.target instanceof Element && e.target.closest('[data-section="evidence"]');
    addImages(f.id, files, inGallery ? { where: 'evidence' } : defaultTarget(f));
  }

  // ---- finding library (text-only templates in their own file; never browser storage) ----
  const libraryInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'data-testid': 'library-input', onchange: onLibraryFile });
  root.append(libraryInput);

  /** Replaces the in-memory library only if the result passes every library rule. */
  function setLibrary(next, message) {
    const errors = checkLibrary(next, appVersion);
    if (errors.length) { say(`The library was not changed: ${errors.slice(0, 3).join(' ')}`, 'error'); return false; }
    library = next;
    libraryDirty = true;
    libraryRev++;
    if (message) say(message);
    renderNav();
    if (view === 'library') renderMain();
    return true;
  }

  // ---- copy one finding as Markdown or plain text ----
  // For a client's issue tracker or a bounty form. Nothing leaves the browser except through
  // the user's own clipboard or a downloaded file; if the browser refuses the clipboard, the
  // text is selected for Ctrl+C and Download still works.
  function copyFindingDialog(f) {
    let markdown = true;
    // The generated text is kept as is: a textarea turns CR and CRLF into LF, so it is only the
    // display, and Copy and Download use `text`.
    let text = '';
    const area = h('textarea', { rows: 18, readonly: true, class: 'code', spellcheck: 'false', 'data-testid': 'copy-text', 'aria-label': 'Finding text' });
    const note = h('span', { class: 'hint', role: 'status', 'data-testid': 'copy-note' });
    // In the over-budget recovery state the report plan refuses the project, as Export does.
    const fill = () => {
      try { text = findingText(doc, doc.findings.indexOf(f), { markdown }); area.value = text; note.textContent = ''; }
      catch { text = ''; area.value = ''; note.textContent = `This project is over the ${CAP} limit, so it cannot be copied as text. Make it smaller first.`; }
    };
    const kind = (value, label) => h('label', {}, h('input', { type: 'radio', name: 'copy-kind', value, checked: (value === 'md') === markdown,
      onchange: () => { markdown = value === 'md'; fill(); } }), ` ${label}`);
    const copy = async () => {
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        note.textContent = 'Copied.';
      } catch {
        area.focus();
        area.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        note.textContent = ok ? 'Copied.' : 'The browser did not allow copying. The text is selected: press Ctrl+C (Cmd+C on a Mac), or use Download.';
      }
    };
    const download = () => {
      if (!text) return;
      const name = displayId(f).replace(/[^A-Za-z0-9._-]+/g, '-') || 'finding';
      downloadBytes(new TextEncoder().encode(text), `${name}.${markdown ? 'md' : 'txt'}`, markdown ? 'text/markdown' : 'text/plain');
    };
    const dialog = h('dialog', { class: 'text copy-finding', 'aria-label': `Copy ${displayId(f)} as text`, 'data-testid': 'copy-dialog' },
      h('div', { class: 'row' }, h('h2', {}, `Copy ${displayId(f)} as text`), h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'secondary', onclick: () => dialog.close() }, 'Close')),
      h('p', { class: 'hint' }, 'For an issue tracker or a bounty form. It follows Sections & scoring: shown sections, names and order, and always includes the status. Screenshots are listed by figure; attach them separately.'),
      h('div', { class: 'row' }, kind('md', 'Markdown'), kind('text', 'Plain text')),
      area,
      h('div', { class: 'row' },
        h('button', { type: 'button', 'data-testid': 'copy-now', onclick: copy }, 'Copy'),
        h('button', { type: 'button', class: 'secondary', 'data-testid': 'copy-download', onclick: download }, 'Download'),
        note));
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    fill();
    dialog.showModal();
  }

  async function saveToLibrary(f) {
    const linked = libraryLinks.get(f.id);
    const existing = linked && library.entries.find((e) => e.id === linked);
    let id;
    if (existing) {
      const choice = await choiceDialog(`"${existing.name}" in the library came from this finding.`, [
        { value: 'replace', label: 'Replace that entry' }, { value: 'new', label: 'Save as a new entry' }]);
      if (!choice) return;
      if (choice === 'replace') id = existing.id;
    }
    const { entry, droppedScreenshots } = entryFromFinding(f, id ? { id, name: existing.name } : {});
    const entries = id ? library.entries.map((e) => (e.id === id ? entry : e)) : [...library.entries, entry];
    const note = droppedScreenshots ? ` ${droppedScreenshots} screenshot${droppedScreenshots > 1 ? 's were' : ' was'} not saved: library entries hold text only.` : '';
    if (setLibrary({ ...library, entries }, `${id ? 'Replaced' : 'Saved'} "${entry.name}" in the finding library.${note} Save the library file to keep it.`)) libraryLinks.set(f.id, entry.id);
  }

  function insertFromLibrary(entry) {
    if (recovery) { say(`Findings cannot be added while the project is over the ${CAP} limit.`, 'error'); return; }
    if (doc.findings.length >= maxFindings) { say(`Not added: the limit is ${maxFindings} findings per project.`, 'error'); return; }
    if (!canIssueFinding()) { say('Not added: finding numbering is exhausted for this project.', 'error'); return; }
    const f = findingFromEntry(entry, doc.project.nextFindingNumber);
    doc.findings.push(f);
    doc.project.nextFindingNumber++;
    if (!fits()) {
      doc.findings.pop();
      doc.project.nextFindingNumber--;
      say(BUDGET_MESSAGE, 'error');
      return;
    }
    libraryLinks.set(f.id, entry.id);
    view = f.id;
    markDirty();
    render();
    say(`Added ${displayId(f)} from the library entry "${entry.name}". Review client-specific details before delivery.`);
  }

  async function onLibraryFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > LIBRARY_LIMITS.fileBytes) { say(`${file.name}: over the 5 MB library limit.`, 'error'); return; }
    let raw;
    try { raw = new TextDecoder('utf-8', { fatal: true }).decode(await readFileBytes(file)); } catch { say(`${file.name} could not be read as UTF-8 text.`, 'error'); return; }
    const r = openLibraryFile(raw, new TextEncoder().encode(raw).length);
    // Also check what Save would write, so an opened library can always be saved and reopened.
    const errors = r.ok ? checkLibrary(r.library, appVersion) : r.errors;
    if (errors.length) { say(`${file.name} is not a usable finding library: ${errors.slice(0, 3).join(' ')}`, 'error'); return; }
    const asked = library;
    let mode = 'replace';
    if (library.entries.length) {
      mode = await choiceDialog(`The library already has ${library.entries.length} entr${library.entries.length === 1 ? 'y' : 'ies'}. Add the ${r.library.entries.length} from "${file.name}", or replace the current library?`, [
        { value: 'merge', label: 'Add (merge)' }, { value: 'replace', label: 'Replace' }]);
      if (!mode) return;
    }
    // Unsaved changes are protected whether or not the library still has entries.
    if (mode === 'replace' && libraryDirty && !await confirmDialog('The current library has unsaved changes. Replace it anyway?', 'Replace')) return;
    if (library !== asked) { say(`"${file.name}" was not added: the library changed while you were deciding.`, 'error'); return; }
    if (mode === 'merge') {
      const m = mergeLibraries(library, r.library);
      if (setLibrary(m.library, `Added ${m.added} entr${m.added === 1 ? 'y' : 'ies'} from "${file.name}"${m.skipped ? `; ${m.skipped} already in the library were skipped` : ''}.`)) libraryHandle = null;
      return;
    }
    library = r.library;
    libraryDirty = false;
    libraryHandle = null;
    libraryGen++;
    libraryLinks.clear();
    say(`Opened the finding library "${file.name}" (${library.entries.length} entr${library.entries.length === 1 ? 'y' : 'ies'}).${r.openedVersion < LIBRARY_VERSION ? ' It is from an older version. Saving writes library format 4, which Rootnote 0.1.x cannot open; keep your original file or save a copy.' : ''}`);
    renderNav();
    if (view === 'library') renderMain();
  }

  async function saveLibrary({ download = false } = {}) {
    if (librarySaving) { say('The library is still being saved.', 'error'); return; }
    // Serialized at the click; the written file is exactly this state.
    const errors = checkLibrary(library, appVersion);
    if (errors.length) { say(`The library was not saved: ${errors.slice(0, 3).join(' ')}`, 'error'); return; }
    const bytes = new TextEncoder().encode(serializeLibrary(library, { appVersion }));
    const name = 'findings.rootnote-library.json';
    const gen = libraryGen;
    const rev = libraryRev;
    if (download || !canPickSaveLocation()) {
      downloadBytes(bytes, name, 'application/json');
      libraryDirty = false;
      say(`Library file "${name}" sent to your browser's downloads. Check that the download finished.`);
      renderNav();
      return;
    }
    librarySaving = true;
    try {
      const handle = libraryHandle ?? await pickSaveFile({ suggestedName: name, description: 'Rootnote finding library', mime: 'application/json', extension: '.json', id: 'fieldnote-library', startIn: folderHint });
      if (!handle) { say('Save cancelled. Nothing was written.'); return; }
      await writeToHandle(handle, bytes);
      if (gen !== libraryGen) { say(`"${handle.name}" was saved with the library as it was when you clicked Save; a different library is open now.`); return; }
      libraryHandle = handle;
      if (rev === libraryRev) {
        libraryDirty = false;
        say(`Saved the finding library "${handle.name}".`);
      } else {
        say(`Saved "${handle.name}", but the library changed while it was being saved. Those changes are not in the file yet; save again.`);
      }
      renderNav();
      if (view === 'library') renderMain();
    } catch (err) {
      say(`The library was not saved: ${saveErrorText(err)}. You can use Download instead.`, 'error');
    } finally {
      librarySaving = false;
    }
  }

  function copyStarterEntry(entry) {
    // The starter id is kept, so a second copy is recognised instead of duplicated.
    if (library.entries.some((e) => e.id === entry.id)) { say(`"${entry.name}" is already in your library.`); return; }
    setLibrary({ ...library, entries: [...library.entries, structuredClone(entry)] }, `Copied "${entry.name}" to your library. Save the library file to keep it.`);
  }

  function starterView(list) {
    const draw = () => {
      const q = libraryFilter.trim().toLowerCase();
      const shown = STARTER_LIBRARY.entries.filter((e) => !q || `${e.name}
${e.title}`.toLowerCase().includes(q));
      list.replaceChildren(...(shown.length ? shown.map((entry) => {
        const prompts = [entry.title, entry.description, entry.impact, entry.threat, entry.recommendation, ...(entry.affectedAssets || []), ...entry.details.map((b) => b.text),
          ...(entry.references || []).flatMap((r) => [r.title, r.url])].reduce((n, t) => n + countPrompts(t), 0);
        const copied = library.entries.some((e) => e.id === entry.id);
        return h('div', { class: 'library-entry', dataset: { entry: entry.id } },
          h('span', { class: 'rdot', title: doc.project.labels.unscored }),
          h('div', { class: 'library-main' }, h('strong', {}, entry.name),
            h('span', { class: 'hint' }, entry.title, prompts ? ` · ${prompts} prompt${prompts > 1 ? 's' : ''} to fill` : '')),
          h('button', { type: 'button', 'data-testid': 'starter-insert', onclick: () => insertFromLibrary(entry), disabled: doc.findings.length >= maxFindings }, 'Add to report'),
          h('button', { type: 'button', class: 'secondary', 'data-testid': 'starter-copy', onclick: () => copyStarterEntry(entry), disabled: copied }, copied ? 'In your library' : 'Copy to my library'));
      }) : [h('p', { class: 'hint' }, STARTER_LIBRARY.entries.length ? 'No entries match.' : 'The starter library is not included in this build.')]));
    };
    draw();
    return draw;
  }

  function libraryView() {
    const list = h('div', { class: 'library-list', 'data-testid': 'library-list' });
    const tabs = h('div', { class: 'seg', role: 'group', 'aria-label': 'Library' },
      ...[['mine', `My library (${library.entries.length})`], ['starter', `OWASP starter (${STARTER_LIBRARY.entries.length})`]].map(([key, text]) =>
        h('button', { type: 'button', 'data-testid': `library-tab-${key}`, 'aria-pressed': String(libraryTab === key), class: libraryTab === key ? 'on' : '', onclick: () => { libraryTab = key; renderMain(); } }, text)));
    let draw;
    const search = () => h('input', { type: 'search', placeholder: 'Search the library', 'aria-label': 'Search the library', value: libraryFilter, class: 'library-search', oninput: (e) => { libraryFilter = e.target.value; draw(); } });
    if (libraryTab === 'starter') {
      draw = starterView(list);
      return h('section', { class: 'panel' },
        h('div', { class: 'row' }, h('h1', {}, 'Finding library'), h('span', { class: 'spacer' }), tabs),
        h('p', { class: 'hint', 'data-testid': 'starter-note' }, 'Ready-made findings for common web and API issues, written for this tool and mapped to OWASP Top 10 2025, OWASP API Security Top 10 2023, the OWASP Web Security Testing Guide 4.2 and CWE. Not affiliated with or endorsed by OWASP. Rating and CVSS are left for you to set. Replace every [[prompt]] with what you observed; Check & export lists any left.'),
        h('div', { class: 'row' }, h('span', { class: 'spacer' }), search()),
        list);
    }
    draw = () => {
      const q = libraryFilter.trim().toLowerCase();
      const shown = library.entries.filter((e) => !q || `${e.name}\n${e.title}`.toLowerCase().includes(q));
      list.replaceChildren(...(shown.length ? shown.map((entry) => {
        const badge = ratingBadge(entry.rating);
        const rename = h('input', { type: 'text', value: entry.name, maxlength: LIBRARY_LIMITS.name, 'aria-label': 'Entry name', 'data-testid': 'library-name',
          onchange: (e) => {
            const name = capEntryName(sanitizeLine(e.target.value));
            if (!name || !setLibrary({ ...library, entries: library.entries.map((x) => (x.id === entry.id ? { ...x, name } : x)) })) e.target.value = entry.name;
          } });
        const remove = async () => {
          const asked = library;
          if (!await confirmDialog(`Delete "${entry.name}" from the library?`, 'Delete')) return;
          if (library !== asked) { say(`"${entry.name}" was not deleted: the library changed meanwhile.`, 'error'); return; }
          setLibrary({ ...library, entries: library.entries.filter((x) => x.id !== entry.id) }, `Deleted "${entry.name}" from the library.`);
        };
        return h('div', { class: 'library-entry', dataset: { entry: entry.id } },
          h('span', { class: 'rdot', title: entry.rating || doc.project.labels.unscored, ...(badge ? { style: `background: #${badge.fill}`, 'data-rated': '1' } : {}) }),
          h('div', { class: 'library-main' }, rename, h('span', { class: 'hint' }, entry.title || '(untitled)', entry.cvss ? ` · CVSS ${parseCvss(entry.cvss).version} ${parseCvss(entry.cvss).score.toFixed(1)}` : '')),
          h('button', { type: 'button', 'data-testid': 'library-insert', onclick: () => insertFromLibrary(entry), disabled: doc.findings.length >= maxFindings }, 'Add to report'),
          h('button', { type: 'button', class: 'danger', onclick: remove, 'aria-label': `Delete ${entry.name}` }, 'Delete'));
      }) : [h('p', { class: 'hint' }, library.entries.length ? 'No entries match.' : 'The library is empty. Open a library file, or use "Save to library" on any finding.')]));
    };
    draw();
    return h('section', { class: 'panel' },
      h('div', { class: 'row' }, h('h1', {}, 'Finding library'), libraryDirty ? h('span', { class: 'dirty' }, 'Unsaved library') : null, h('span', { class: 'spacer' }), tabs),
      h('p', { class: 'hint' }, 'Reusable findings, text only (no screenshots). The library is its own file, separate from projects, and is kept only while this page is open: save it to keep it. Entries keep their text exactly as written, so remove client-specific names, hosts or credentials before reusing them.'),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'secondary', 'data-testid': 'library-open', onclick: () => libraryInput.click() }, 'Open library…'),
        h('button', { type: 'button', 'data-testid': 'library-save', onclick: () => saveLibrary(), disabled: !library.entries.length && !libraryDirty }, canPickSaveLocation() ? 'Save library…' : 'Download library'),
        canPickSaveLocation() ? h('button', { type: 'button', class: 'secondary', onclick: () => saveLibrary({ download: true }) }, 'Download') : null,
        h('span', { class: 'spacer' }),
        h('span', { class: 'hint' }, `${library.entries.length}/${LIBRARY_LIMITS.entries} entries`),
        search()),
      list);
  }

  // ---- checklist and export ----
  function exportView() {
    const warnings = checklist(doc);
    // The paper size is a two-way switch; the select behind it holds the value.
    const paper = h('select', { 'data-testid': 'export-paper', hidden: true, onchange: () => syncSeg() }, ...['A4', 'Letter'].map((s) => h('option', { value: s, selected: doc.project.paperSize === s }, s)));
    const segButtons = ['A4', 'Letter'].map((s) => h('button', { type: 'button', 'aria-pressed': String(paper.value === s), onclick: () => { paper.value = s; syncSeg(); } }, s));
    const syncSeg = () => segButtons.forEach((x) => { x.setAttribute('aria-pressed', String(x.textContent === paper.value)); x.classList.toggle('on', x.textContent === paper.value); });
    syncSeg();
    // one heading says where the report stands; suggestions link to the
    // place that fixes them; facts about saving sit with the actions, details on request.
    const failing = warnings.filter((w) => /export will fail/.test(w.text));
    const fix = (w) => w.go && h('button', { type: 'button', class: 'linkish go', 'aria-label': `Fix: ${w.where}`, onclick: () => go(w.go) }, 'Fix');
    const blocked = recovery || failing.length;
    return h('section', { class: 'panel review' },
      h('h1', { 'data-testid': 'review-state' }, blocked ? 'Cannot export yet' : warnings.length ? 'Almost ready' : 'Ready to export'),
      recovery ? h('p', {}, `The project is over the ${CAP} limit. Remove a screenshot or some text first; the notice at the top says by how much.`) : null,
      warnings.length
        ? h('div', {}, h('p', { class: 'sub' }, `${warnings.length === 1 ? '1 thing' : `${warnings.length} things`} you may want to look at. ${failing.length ? 'Those marked in red stop the export; the others do not.' : 'None of them stop the export.'}`),
          h('ul', { class: 'warnings', 'data-testid': 'warnings' }, ...[...failing, ...warnings.filter((w) => !failing.includes(w))].map((w) =>
            h('li', { class: failing.includes(w) ? 'fails' : '' }, h('span', { class: 'wdot', 'aria-hidden': 'true' }, icon('alert', 'icon sm')), h('span', {}, h('strong', {}, w.where), ': ', w.text), fix(w))),
            passedLine(warnings)))
        : h('p', { class: 'sub', 'data-testid': 'warnings-none' }, 'Nothing to look at. This does not certify the report; read it before you send it.'),
      h('div', { class: 'xcard' },
        h('h2', {}, 'Export'),
        h('div', { class: 'row exportrow' },
          h('span', { class: 'seg', role: 'group', 'aria-label': 'Paper size' }, ...segButtons), paper,
          h('button', { type: 'button', class: 'big', 'data-testid': 'export', onclick: () => runExport(paper.value) }, icon('word'), engagement?.dir ? 'Save Word report' : canPickSaveLocation() ? 'Save Word report…' : 'Export Word report'),
          canPickSaveLocation() ? h('button', { type: 'button', class: 'secondary big', 'data-testid': 'export-download', onclick: () => runExport(paper.value, { download: true }) }, 'Download Word report') : null,
          h('button', { type: 'button', class: 'secondary big', 'data-testid': 'export-csv', onclick: exportCsv }, icon('file'), 'Findings as CSV'),
          h('button', { type: 'button', class: 'secondary big', 'data-testid': 'export-markdown', onclick: exportMarkdown }, icon('file'), 'Report as Markdown'),
          h('button', { type: 'button', class: 'secondary big', 'data-testid': 'export-pdf', onclick: () => { if (setField(doc.project, 'paperSize', paper.value) || doc.project.paperSize === paper.value) printReport(); } }, icon('print'), 'Print or save as PDF')),
        h('p', { class: 'quiet' }, 'The file is made on this computer; the app uploads nothing. Open it in Word once to check page breaks before you send it.'),
        engagement?.dir ? h('p', { class: 'quiet', 'data-testid': 'export-target' }, `Saves into the engagement folder ${engagement.customer} › ${engagement.name}.`) : null,
        h('details', { class: 'more-info' }, h('summary', {}, 'Saving into Google Drive, OneDrive or Dropbox'),
          h('p', { class: 'hint' }, 'If you save into a folder synced by Google Drive, OneDrive or Dropbox, that service uploads the file.'),
          h('p', { class: 'hint', 'data-testid': 'drive-hint' }, 'Google Drive: if you use Google Drive for desktop, choose a folder in your Google Drive when saving. Its sync software uploads that file.'))),
      h('div', { class: 'xcard' }, draftToggle()));
  }

  /** The checks that found nothing, named plainly (only ones the checklist really makes). */
  function passedLine(warnings) {
    const has = (re) => warnings.some((w) => re.test(w.text));
    const ok = [
      !has(/\[\[/) ? 'every fill-in field is filled' : null,
      !has(/placeholder text/) ? 'no example text left' : null,
      !has(/no caption/) ? 'every screenshot has a caption' : null,
      doc.project.sections.report.find((x) => x.key === 'contents')?.enabled ? 'table of contents included' : null].filter(Boolean);
    if (!ok.length) return null;
    return h('li', { class: 'passed', 'data-testid': 'checks-passed' }, h('span', { class: 'wdot ok', 'aria-hidden': 'true' }, icon('check', 'icon sm')),
      h('span', {}, h('strong', {}, 'Passed: '), ok.join(' · ')));
  }

  /** Writes a file into the engagement folder; asks before replacing one. Null when the user
   * keeps the existing file. */
  // An export writes the snapshot taken at the click into the folder it was started for, even
  // if another project is opened meanwhile.
  async function writeIntoEngagement(target, name, bytes) {
    let exists = false;
    try { await target.dir.getFileHandle(name); exists = true; } catch { /* a new file */ }
    if (exists && !await confirmDialog(`Replace "${name}" in ${target.customer} › ${target.name}?`, 'Replace')) return null;
    const where = `${target.customer} › ${target.name}`;
    say(`Writing "${name}" into ${where}…`);
    let handle = null;
    try {
      handle = await target.dir.getFileHandle(name, { create: true });
      await writeToHandle(handle, bytes, { onAsk: () => say(`Your browser is asking whether this page may edit files in ${where}. Answer its prompt at the top of the window to finish writing "${name}".`) });
    } catch (err) {
      // The browser creates the file before writing; a failed write must not leave it empty
      //. A replaced file keeps its old content.
      if (!exists && handle) await removeEntry(target.dir, name);
      throw err;
    }
    rescanEngagements();
    return handle;
  }
  async function removeEntry(dir, name) { try { await dir.removeEntry(name); } catch { /* best effort */ } }
  /** Save and export messages for engagement folders; a lost permission says what to do. */
  function engagementErrorText(err) {
    if ((err?.name === 'NotAllowedError' || err?.name === 'SecurityError') && engagement?.dir) {
      return 'the browser no longer allows writing to this engagement folder. Choose the folder again under Engagements (Choose another folder…), then try again';
    }
    return saveErrorText(err);
  }
  /** Rereads the chosen folder quietly, so new reports and files show in the list. */
  function rescanEngagements() {
    if (engagementRoot?.root) useEngagementsFolder(engagementRoot.root, { quiet: true });
  }

  /** Findings as a spreadsheet: into the engagement folder, a chosen file or the downloads. */
  const exportCsv = () => exportTextFile({ kind: 'CSV', withCvss: true, name: `${fileStem()}-findings.csv`, make: () => findingsCsv(doc),
    description: 'Spreadsheet (CSV)', mime: 'text/csv', extension: '.csv', id: 'fieldnote-csv' });
  /** The whole report as Markdown text; screenshots become placeholders. */
  const exportMarkdown = () => exportTextFile({ kind: 'Markdown', name: `${fileStem()}-report.md`, make: () => reportMarkdown(doc),
    description: 'Markdown text', mime: 'text/markdown', extension: '.md', id: 'rootnote-md' });
  async function exportTextFile({ kind, name, make, description, mime, extension, id, withCvss }) {
    const target = engagement?.dir ? engagement : null;
    if (exporting) return;
    const blockedBy = cvssExportBlock(withCvss);
    if (blockedBy) { say(`Not exported: ${blockedBy}`, 'error'); return; }
    exporting = true;
    try {
      const bytes = new TextEncoder().encode(make());
      if (target) {
        if (await writeIntoEngagement(target, name, bytes) === null) { say(`${kind} export cancelled. Nothing was written.`); return; }
        say(`Saved "${name}" in ${target.customer} › ${target.name}.`);
        return;
      }
      if (canPickSaveLocation()) {
        const handle = await pickSaveFile({ suggestedName: name, description, mime, extension, id, startIn: folderHint });
        if (!handle) { say(`${kind} export cancelled. Nothing was written.`); return; }
        await writeToHandle(handle, bytes);
        say(`Saved "${handle.name}".`);
        return;
      }
      downloadBytes(bytes, name, mime);
      say(`"${name}" sent to your browser's downloads. Check that the download finished.`);
    } catch (err) {
      say(`The ${kind} file was not saved: ${engagementErrorText(err)}. Nothing was changed in your project.`, 'error');
    } finally {
      exporting = false;
    }
  }

  // ---- Engagements screen ----
  const canPickFolder = () => typeof window.showDirectoryPicker === 'function';
  async function pickEngagementsFolder() {
    let root;
    try { root = await window.showDirectoryPicker({ id: 'fieldnote-engagements', mode: 'readwrite' }); } catch (err) {
      if (err?.name !== 'AbortError') say(`The folder could not be opened: ${saveErrorText(err)}.`, 'error');
      return;
    }
    await useEngagementsFolder(root);
  }
  /** Reads a folder handle (Chrome, Edge) as Customer\Engagement\files; it may be written to. */
  let scanToken = 0;
  async function useEngagementsFolder(root, { quiet = false } = {}) {
    const token = ++scanToken;
    if (!quiet) say(`Reading "${root.name}"…`);
    let tree;
    try { tree = await scanHandle(root); } catch (err) { if (token === scanToken) say(`The folder could not be read: ${saveErrorText(err)}.`, 'error'); return; }
    // A slower scan started earlier must not replace a newer folder choice.
    if (token !== scanToken) return;
    engagementRoot = { root, write: true, tree, summaries: new Map(), rest: [] };
    await readSummaries(true, { quiet });
  }
  /** Reads a folder input's files (every browser): a snapshot, never written to. */
  async function useEngagementList(files) {
    if (!files.length) return;
    scanToken++;
    engagementRoot = { root: null, write: false, tree: scanFileList(files), summaries: new Map(), rest: [] };
    await readSummaries(true);
  }
  /** Reads the next batch of project files for their summaries (limits in engagements.js). */
  async function readSummaries(first = false, { quiet = false } = {}) {
    const state = engagementRoot;
    if (!state) return;
    const projects = first ? state.tree.flatMap((c) => c.engagements.flatMap((e) => e.files.filter((f) => f.kind === 'project'))) : state.rest;
    const { read, skipped, rest } = planBatch(projects);
    for (const f of skipped) state.summaries.set(f, `Over the ${CAP} project limit; not read.`);
    for (const f of read) {
      let summary = null;
      try { summary = projectSummary(await (await f.open()).text()); } catch { /* reported below */ }
      if (engagementRoot !== state) return; // another folder was chosen meanwhile
      state.summaries.set(f, summary ?? 'Not a readable project file.');
    }
    state.rest = rest;
    const n = state.tree.reduce((k, c) => k + c.engagements.length, 0);
    if (!quiet) say(`Found ${n} engagement${n === 1 ? '' : 's'} for ${state.tree.length} customer${state.tree.length === 1 ? '' : 's'}.${rest.length ? ` ${rest.length} project files are not read yet.` : ''}`, 'info', { fade: true });
    if (view === 'engagements') renderMain();
  }

  async function openFromEngagement(customer, eng, file) {
    if (opening) { say('Another file is still being opened.', 'error'); return; }
    const gen = generation;
    const rev = revision;
    if (dirty && !await confirmDialog(`Open "${file.name}"? Unsaved changes will be lost.`, 'Discard changes')) return;
    if (gen !== generation || rev !== revision || opening) { say(`"${file.name}" was not opened: the project changed while you were deciding. Your current work is unchanged.`, 'error'); return; }
    const state = engagementRoot;
    opening = true;
    try {
      const ok = await openFile(await file.open());
      if (!ok) return;
      const writable = state?.write && file.handle && eng.dir;
      if (writable) projectHandle = file.handle;
      engagement = { customer: customer.name, name: eng.name, dir: writable ? eng.dir : null, root: state?.root ?? null };
      say(`Opened "${file.name}" from ${customer.name} › ${eng.name}. ${writable ? 'Save and the exports write into that folder.' : 'This browser saves by download; the folder is not changed.'}`, 'info', { fade: true });
      render();
    } catch {
      say(`"${file.name}" could not be read. Your current work is unchanged.`, 'error');
    } finally {
      opening = false;
    }
  }

  /** Saves the open project into an engagement folder and keeps saving there. */
  async function saveIntoEngagement(customerName, eng) {
    if (saving) { say('The project is still being saved. Try again when that has finished.', 'error'); return false; }
    // Its own folder: an ordinary Save to the file it came from, not a second file.
    if (engagement?.dir === eng.dir && projectHandle) return ['saved', 'saved-edited'].includes(await saveProject());
    const gen = generation;
    const name = `${fileStem()}.rootnote.json`;
    let exists = false;
    try { await eng.dir.getFileHandle(name); exists = true; } catch { /* a new file */ }
    if (exists && !await confirmDialog(`Replace "${name}" in ${customerName} › ${eng.name} with the open project?`, 'Replace')) return false;
    if (gen !== generation) { say('The project was not saved there: a different project was opened meanwhile.', 'error'); return false; }
    let handle = null;
    try {
      handle = await eng.dir.getFileHandle(name, { create: true });
    } catch (err) {
      say(`The project was not saved: ${engagementErrorText(err)}.`, 'error');
      return false;
    }
    // The open project and its exports move to the new folder only once the file is written.
    const result = await saveProject({ target: handle });
    if (result !== 'saved' && result !== 'saved-edited') {
      if (!exists) await removeEntry(eng.dir, name);
      return false;
    }
    engagement = { customer: customerName, name: eng.name, dir: eng.dir, root: engagementRoot?.root ?? null };
    // Rescan quietly: the outcome of the save is the message to keep on screen.
    if (engagementRoot?.root) await useEngagementsFolder(engagementRoot.root, { quiet: true });
    if (view === 'engagements') {
      renderMain();
      main.querySelector(`[data-testid=engagement][data-customer="${CSS.escape(customerName)}"][data-engagement="${CSS.escape(eng.name)}"] [data-testid=eng-save-here]`)?.focus();
    }
    renderFileState();
    if (result === 'saved') say(`Saved "${handle.name}" in ${customerName} › ${eng.name}. Save and the exports now write into that folder.`, 'info', { fade: true });
    return true;
  }

  /** New engagement: a customer folder (existing or new) and an engagement folder in it. */
  async function newEngagement() {
    const state = engagementRoot;
    if (!state?.write) return;
    const month = new Date().toISOString().slice(0, 7);
    // The folder the open report came from, not its client field, so a new engagement lands beside it.
    const customer = h('input', { type: 'text', list: 'eng-customers', 'data-testid': 'eng-customer', value: engagement?.customer || doc.project.client || '', maxlength: 100 });
    const name = h('input', { type: 'text', 'data-testid': 'eng-name', value: `${month} ${doc.project.title || 'Engagement'}`.slice(0, 100), maxlength: 100 });
    const problem = h('p', { class: 'hint', 'data-kind': 'error', 'aria-live': 'polite' });
    // Asked every time: a new engagement usually starts a new report, but it can also take the open one.
    const empty = h('button', { type: 'button', 'data-testid': 'eng-create-empty', 'data-confirm': '1' }, 'Start an empty report');
    const create = h('button', { type: 'button', class: 'secondary', 'data-testid': 'eng-create' }, 'Save the open report there');
    const current = doc.project.title.trim() || 'Untitled report';
    const dialog = h('dialog', { class: 'confirm', 'aria-label': 'New engagement' },
      h('h2', {}, 'New engagement'),
      h('p', { class: 'hint' }, `Creates ${state.root.name}\\Customer\\Engagement\\ and saves a report file in it.`),
      h('datalist', { id: 'eng-customers' }, ...state.tree.map((c) => h('option', { value: c.name }))),
      field('Customer folder', customer), field('Engagement folder', name), problem,
      h('p', { 'data-testid': 'eng-which' }, `Which report goes in the new folder: an empty one, or the open report "${current}"?`,
        dirty ? ' The open report has unsaved changes; an empty report replaces it in this window without saving them.' : ''),
      h('div', { class: 'row end' }, h('button', { type: 'button', class: 'secondary', onclick: () => dialog.close('cancel') }, 'Cancel'), create, empty));
    const check = () => {
      const p = folderNameProblem(customer.value) ? `Customer: ${folderNameProblem(customer.value)}` : folderNameProblem(name.value) ? `Engagement: ${folderNameProblem(name.value)}` : '';
      problem.textContent = p;
      create.disabled = empty.disabled = !!p;
    };
    customer.addEventListener('input', check);
    name.addEventListener('input', check);
    create.addEventListener('click', () => dialog.close('open'));
    empty.addEventListener('click', () => dialog.close('empty'));
    check();
    const gen = generation;
    const answer = await new Promise((resolve) => {
      dialog.addEventListener('close', () => { dialog.remove(); resolve(dialog.returnValue); });
      document.body.append(dialog);
      dialog.showModal();
    });
    if ((answer !== 'open' && answer !== 'empty') || engagementRoot !== state) return;
    const stale = () => gen !== generation || engagementRoot !== state;
    if (stale()) { say('No engagement was created: the project or folder changed meanwhile.', 'error'); return; }
    try {
      const cdir = await state.root.getDirectoryHandle(customer.value, { create: true });
      const edir = await cdir.getDirectoryHandle(name.value, { create: true });
      if (stale()) { say(`The folder ${customer.value} › ${name.value} was created, but nothing was saved in it: the project or folder changed meanwhile.`, 'error'); return; }
      if (answer === 'empty') {
        replaceProject(createEmptyProject());
        doc.project.client = customer.value;
        doc.project.title = name.value.replace(/^\d{4}-\d{2}\s+/, '') || name.value;
        markDirty(); // not saved until the write below succeeds
        render();
      }
      await saveIntoEngagement(customer.value, { name: name.value, dir: edir });
    } catch (err) {
      say(`The engagement folder was not created: ${saveErrorText(err)}.`, 'error');
    }
  }

  function engagementsView() {
    const state = engagementRoot;
    const input = h('input', { type: 'file', webkitdirectory: true, multiple: true, 'data-testid': 'engagements-input', onchange: (e) => { const files = [...e.target.files]; e.target.value = ''; useEngagementList(files); } });
    const chooser = canPickFolder()
      ? h('button', { type: 'button', class: 'big', 'data-testid': 'engagements-pick', onclick: pickEngagementsFolder }, icon('folder'), state ? 'Choose another folder…' : 'Choose engagements folder…')
      : h('label', { class: 'filebtn big' }, icon('folder'), state ? 'Choose another folder…' : 'Choose engagements folder…', input);
    const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
    const when = (t) => (t ? new Date(t).toLocaleDateString() : '');
    const summaryLine = (s) => {
      if (typeof s === 'string') return h('span', { class: 'hint' }, s);
      if (!s) return h('span', { class: 'hint' }, 'Not read yet.');
      const order = ['Critical', 'High', 'Medium', 'Low', 'Informational', 'Unscored'];
      const counts = order.filter((r) => s.counts[r]).map((r) => `${s.counts[r]} ${r.toLowerCase()}`).join(', ');
      return h('span', {}, h('strong', {}, s.title || '(untitled)'),
        h('span', { class: 'hint' }, ` · ${s.findings} finding${s.findings === 1 ? '' : 's'}${counts ? `: ${counts}` : ''}${ENGAGEMENT_STATUSES.includes(s.status) ? ` · ${formatEngagementStatus(s.status)}` : ''}`));
    };
    const engagementRow = (c, e) => {
      const projects = e.files.filter((f) => f.kind === 'project');
      const others = e.files.filter((f) => f.kind !== 'project');
      const current = engagement && engagement.root === state.root && engagement.customer === c.name && engagement.name === e.name;
      return h('li', { class: current ? 'eng current' : 'eng', 'data-testid': 'engagement', dataset: { customer: c.name, engagement: e.name } },
        h('div', { class: 'eng-head' }, h('span', { class: 'eng-name' }, icon('folder'), e.name), current ? h('span', { class: 'chip' }, 'Open now') : null,
          h('span', { class: 'spacer' }),
          state.write && e.dir ? h('button', { type: 'button', class: 'ghost small-btn', 'data-testid': 'eng-save-here', onclick: () => saveIntoEngagement(c.name, e) }, 'Save open project here') : null),
        ...projects.map((f) => h('div', { class: 'eng-project' }, icon('file'),
          h('div', { class: 'eng-info' }, h('div', {}, summaryLine(state.summaries.get(f))), h('div', { class: 'hint' }, `${f.name} · ${size(f.size)} · ${when(f.modified)}`)),
          h('button', { type: 'button', class: 'secondary small-btn', 'data-testid': 'eng-open', onclick: () => openFromEngagement(c, e, f) }, 'Open'))),
        projects.length ? null : h('p', { class: 'hint' }, 'No project file in this folder.'),
        others.length ? h('p', { class: 'eng-files' }, ...others.map((f) => h('span', { class: 'chip neutral', title: `${size(f.size)} · ${when(f.modified)}` }, f.kind === 'sheet' ? 'CSV · ' : /\.pdf$/i.test(f.name) ? 'PDF · ' : /\.md$/i.test(f.name) ? 'Markdown · ' : 'Word · ', f.name))) : null);
    };
    return h('section', { class: 'panel settings', 'data-testid': 'engagements' },
      h('h1', {}, 'Engagements'),
      h('p', { class: 'sub' }, 'Your engagement folders: one folder per customer, one folder per engagement inside it, holding the project file and its reports. Nothing is uploaded, and the folder is not remembered when you close the page.'),
      h('div', { class: 'row exportrow' }, chooser,
        state?.write ? h('button', { type: 'button', class: 'secondary big', 'data-testid': 'eng-new', onclick: newEngagement }, icon('plus'), 'New engagement…') : null,
        state?.rest.length ? h('button', { type: 'button', class: 'secondary big', 'data-testid': 'eng-more', onclick: () => readSummaries() }, `Read ${state.rest.length} more project files`) : null),
      h('p', { class: 'quiet' }, canPickFolder()
        ? 'When you open a project from here, Save and the Word, Markdown and CSV exports write into its engagement folder.'
        : 'This browser can read the folders but cannot save into them: Save and exports go to your downloads.'),
      !state ? null : !state.tree.length
        ? h('div', { class: 'xcard' }, h('p', {}, 'No engagement folders found. Expected: the folder you chose › a customer folder › an engagement folder › the project file.'))
        : h('div', {}, ...state.tree.map((c) => h('div', { class: 'xcard', 'data-testid': 'customer' },
          h('h2', {}, c.name, h('span', { class: 'hint' }, ` · ${c.engagements.length} engagement${c.engagements.length === 1 ? '' : 's'}`)),
          h('ul', { class: 'eng-list' }, ...c.engagements.map((e) => engagementRow(c, e)))))));
  }

  async function runExport(paperSize, { download = false } = {}) {
    if (exporting) return;
    if (recovery) { say(`Export is not available while the project is over the ${CAP} limit. Remove a screenshot or some text first.`, 'error'); return; }
    const blockedBy = cvssExportBlock();
    if (blockedBy) { say(`Not exported: ${blockedBy}`, 'error'); return; }
    exporting = true;
    const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    try {
      // Export a snapshot, and name the file from it, so edits or a New made while the
      // export runs cannot produce a mixed document or a mismatched file name.
      const name = `${fileStem()}.docx`;
      const snapshot = structuredClone(doc);
      const target = !download && engagement?.dir ? engagement : null;
      if (target) {
        say('Creating the Word file…');
        const bytes = await exportDocx(snapshot, { paperSize });
        if (await writeIntoEngagement(target, name, bytes) === null) { say('Export cancelled. Nothing was written.'); return; }
        say(`Saved Word file "${name}" in ${target.customer} › ${target.name} (${(bytes.length / 1048576).toFixed(1)} MB).`);
        return;
      }
      let handle = null;
      if (!download && canPickSaveLocation()) {
        // The dialog opens first, while the click still counts as a user gesture.
        try {
          handle = await pickSaveFile({ suggestedName: name, description: 'Word document', mime: DOCX, extension: '.docx', id: 'fieldnote-docx', startIn: folderHint });
        } catch (err) {
          say(`The Word file was not saved: ${saveErrorText(err)}. Nothing was changed in your project. You can use Download Word instead.`, 'error');
          return;
        }
        if (!handle) { say('Export cancelled. Nothing was written.'); return; }
      }
      say('Creating the Word file…');
      const bytes = await exportDocx(snapshot, { paperSize });
      const size = `${(bytes.length / 1048576).toFixed(1)} MB`;
      if (handle) {
        try {
          await writeToHandle(handle, bytes);
        } catch (err) {
          say(`The Word file was not saved: ${saveErrorText(err)}. Nothing was changed in your project. You can use Download Word instead.`, 'error');
          return;
        }
        folderHint = handle;
        say(`Saved Word file "${handle.name}" (${size}).`);
      } else {
        downloadBytes(bytes, name, DOCX);
        say(`Word file "${name}" (${size}) sent to your browser's downloads. Check that the download finished.`);
      }
    } catch (err) {
      say(`Export failed: ${engagementErrorText(err).replace(/\.$/, '')}. Nothing was changed in your project.`, 'error');
    } finally {
      exporting = false;
    }
  }

  // ---- files ----
  function fileStem() {
    const base = (doc.project.title || 'report').normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return base || 'report';
  }

  function takeFormatNotice() {
    if (!formatNotice) return '';
    formatNotice = false;
    return ' It was saved in project format 8, which Rootnote 0.2.x and earlier cannot open.';
  }

  // savedBytes() relies on every toISOString() having the placeholder's length (years 0-9999).
  function serialize(savedAt = new Date().toISOString(), replacer = null) {
    const out = { ...doc, appVersion, savedAt };
    return JSON.stringify(out, replacer);
  }

  /** The project file as of now: string parts (a snapshot; strings do not change) and its
   * exact size in bytes. Same bytes as serialize(savedAt), without one giant string. */
  // Image records whose data URL is known to be written as it is, with that exact string; a
  // record that gets new data is scanned again (plainDataUrl). Filled when a file is opened.
  const plainUrls = new WeakMap();
  const isPlainImage = (im, url) => {
    if (plainUrls.get(im) === url) return true;
    const plain = plainDataUrl(url);
    if (plain) plainUrls.set(im, url);
    return plain;
  };
  const rememberChecked = (result) => { for (const im of doc.images) if (result.checkedImages?.has(im)) plainUrls.set(im, im.dataUrl); };

  function snapshotFile(savedAt) {
    const split = projectParts({ ...doc, appVersion, savedAt }, { isPlain: isPlainImage });
    if (split) return split;
    const text = serialize(savedAt);
    return { parts: [text], bytes: new TextEncoder().encode(text).length };
  }

  /** Saves the project. `target` writes to that file handle instead of the current one (an
   * engagement folder). Returns 'saved', 'saved-edited' (written, but the project changed
   * meanwhile), 'other-project', 'download', 'download-edited', 'cancelled', 'busy',
   * 'too-big' or 'failed'. */
  async function saveProject({ saveAs = false, download = false, target = null } = {}) {
    if (saving) { say('The project is still being saved.', 'error'); return 'busy'; }
    // Take the file synchronously at the moment of the click, so it holds exactly the state
    // the user saved, and remember which edit that was. The bytes are built afterwards in
    // small steps (partsToBlob), so a large project does not hold the page.
    const savedAt = new Date().toISOString();
    const file = snapshotFile(savedAt);
    if (file.bytes > LIMITS.fileBytes) {
      say(`The project is ${(file.bytes / 1048576).toFixed(1)} MB, over the ${CAP} limit. Remove or shrink screenshots before saving.`, 'error');
      return 'too-big';
    }
    const name = `${fileStem()}.rootnote.json`;
    // A file from an engagement folder can be written whether or not a save dialog exists.
    const toDownload = !target && (download || (!canPickSaveLocation() && !(projectHandle && !saveAs)));
    const gen = generation;
    const rev = revision;
    saving = true;
    const build = async () => {
      const blob = await partsToBlob(file.parts);
      if (blob.size !== file.bytes) throw new Error('the project file could not be prepared');
      return blob;
    };
    try {
      if (toDownload) {
        downloadBytes(await build(), name, 'application/json');
        // A browser download cannot be confirmed from the page, so say what actually happened.
        if (gen !== generation) {
          say(`Project file "${name}" sent to your browser's downloads with the project as it was when you clicked Save; a different project is open now.`);
          return 'other-project';
        }
        doc.savedAt = savedAt;
        fileInfo = { kind: 'download', at: new Date() };
        if (rev === revision) {
          markClean();
          say(`Project file "${name}" sent to your browser's downloads. Check that the download finished and keep a backup copy; ${storageClaim()}.${takeFormatNotice()}`);
          return 'download';
        }
        say(`Project file "${name}" sent to your browser's downloads, but you changed the project while it was being prepared. Those changes are not in the file yet; save again.`);
        return 'download-edited';
      }
      let handle = target ?? (saveAs ? null : projectHandle);
      if (!handle) {
        // First await of the gesture: the dialog must open before anything else is awaited.
        handle = await pickSaveFile({ suggestedName: name, description: 'Rootnote project', mime: 'application/json', extension: '.json', id: 'fieldnote-project', startIn: folderHint });
        if (!handle) { say('Save cancelled. Nothing was written.'); return 'cancelled'; }
      }
      const blob = await build();
      await writeToHandle(handle, blob, { onAsk: () => say(`Your browser is asking whether this page may edit "${handle.name}". Answer its prompt at the top of the window to finish saving.`) });
      folderHint = handle;
      if (gen !== generation) {
        say(`"${handle.name}" was saved with the project as it was when you clicked Save; a different project is open now.`);
        return 'other-project';
      }
      projectHandle = handle;
      doc.savedAt = savedAt;
      if (rev === revision) {
        fileInfo = { kind: 'saved', at: new Date() };
        markClean();
        say(`Saved "${handle.name}". Keep a backup copy; ${storageClaim()}.${takeFormatNotice()}`);
        return 'saved';
      }
      say(`Saved "${handle.name}", but you changed the project while it was being saved. Those changes are not in the file yet; save again.`);
      return 'saved-edited';
    } catch (err) {
      say(`The project was not saved: ${engagementErrorText(err)}. Your work is still open${dirty ? ' with unsaved changes' : ''}.${toDownload ? '' : ' You can use Download instead.'}`, 'error');
      return 'failed';
    } finally {
      saving = false;
    }
  }

  function showNotices() {
    const read = (id) => document.getElementById(id)?.content.textContent.trim();
    const own = read('app-licence');
    const text = read('third-party-notices');
    textDialog('About & licences', `${own ? `${own}

---

Third-party software notices

` : ''}${text || 'Notices are missing from this build; see THIRD-PARTY-NOTICES.txt in the release folder.'}`);
  }

  async function newProject() {
    // What is kept is shown before anything is created.
    const list = (items) => h('ul', {}, ...items.map((t) => h('li', {}, t)));
    const choice = await choiceDialog(h('div', { 'data-testid': 'new-dialog' },
      h('p', {}, dirty ? 'Start a new project? Unsaved changes in this one will be lost.' : 'Start a new project?'),
      h('p', {}, h('strong', {}, 'Keep layout and branding'), ' copies:'), list(SETTINGS_KEPT),
      // The copied text values themselves, since a classification can name a customer.
      h('p', { 'data-testid': 'new-copied-values' }, 'Text copied as is: ', [['Your name', 'testerName'], ['Organisation', 'organisation'], ['Classification', 'classification']]
        .map(([label, k]) => `${label}: ${doc.project[k].trim() || '(empty)'}`).join(' · ')),
      h('p', {}, 'It never copies:'), list(SETTINGS_DROPPED)), [
      { value: 'blank', label: 'Blank project' }, { value: 'settings', label: 'Keep layout and branding' }]);
    if (!choice) return;
    replaceProject(choice === 'settings' ? projectFromSettings(doc) : createEmptyProject());
    say(choice === 'settings' ? 'New project with your layout and branding. Client details, findings and screenshots were not copied.' : 'New project.');
    render();
  }

  async function onOpenFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    await openChosenFile(file);
  }

  // The sample project ships inside the page (build.mjs, template#app-sample), so it opens
  // in one click online and offline without a file picker.
  async function openSample() {
    const text = document.getElementById('app-sample')?.content.textContent;
    if (!text) { openInput.click(); return; }
    await openChosenFile(new File([text], 'sample-project.rootnote.json', { type: 'application/json' }));
  }

  async function openChosenFile(file) {
    if (opening) { say('Another file is still being opened.', 'error'); return; }
    const gen = generation;
    const rev = revision;
    if (dirty && !await confirmDialog(`Open "${file.name}"? Unsaved changes will be lost.`, 'Discard changes')) return;
    if (gen !== generation || rev !== revision || opening) { say(`"${file.name}" was not opened: the project changed while you were deciding. Your current work is unchanged.`, 'error'); return; }
    opening = true;
    try {
      await openFile(file);
    } catch {
      say(`"${file.name}" could not be read. Your current work is unchanged.`, 'error');
    } finally {
      opening = false;
    }
  }

  const cleanedNote = (n) => (n ? ` Hidden data (such as camera, location or notes) was removed from ${n === 1 ? '1 screenshot' : `${n} screenshots`}; save to keep the cleaned copy.` : '');

  async function openFile(file) {
    const gen = generation;
    const rev = revision;
    if (file.size > LIMITS.fileBytes) { say(`"${file.name}" is over the ${CAP} project limit. Your current work is unchanged.`, 'error'); return; }
    say(`Checking "${file.name}"…`);
    // The browser decodes the text without holding the page. It replaces invalid UTF-8 with
    // U+FFFD, so a text holding U+FFFD is decoded again strictly: invalid UTF-8 is refused,
    // a real U+FFFD is kept.
    let bytes = null;
    let raw = await file.text();
    if (raw.includes('\uFFFD')) {
      bytes = await readFileBytes(file);
      try {
        raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        say(`"${file.name}" is not a UTF-8 text file. Your current work is unchanged.`, 'error');
        return;
      }
    }
    // Large projects take a while to check: say how far it is, at most a few times a second.
    let shown = 0;
    const onProgress = (n, total) => {
      // Not once another project has replaced this one (gen: taken before the file was read).
      if (generation !== gen || total < 20 || (n < total && performance.now() - shown < 250)) return;
      shown = performance.now();
      say(`Checking "${file.name}": screenshot ${n} of ${total}…`);
    };
    const proofs = new Map();
    const result = await openProjectFile(raw, file.size, { appVersion, decodeImage: decodeImageInBrowser, onProgress, proofs });
    if (result.ok && result.project.findings.length > maxFindings) {
      say(`"${file.name}" has ${result.project.findings.length} findings; this ${edition ? edition.toLowerCase() + ' ' : ''}build opens projects with up to ${maxFindings}. Your current work is unchanged.`, 'error');
      return;
    }
    if (!result.ok) {
      const shown = result.errors.slice(0, 5).join(' · ');
      const more = result.errors.length > 5 ? ` (+${result.errors.length - 5} more)` : '';
      say(`Could not open "${file.name}": ${shown}${more}. Your current work is unchanged.`, 'error');
      return;
    }
    // A New started while the file was checked wins; an edit made meanwhile is confirmed.
    if (gen !== generation) {
      say(`"${file.name}" was not opened because a new project was started meanwhile.`);
      return;
    }
    if (rev !== revision && dirty) {
      const asked = revision;
      if (!await confirmDialog(`You changed the project while "${file.name}" was being checked. Discard those changes and open it?`, 'Discard changes')) {
        say(`"${file.name}" was not opened. Your current work is unchanged.`);
        return;
      }
      // The answer covers the project as it was when asked.
      if (gen !== generation || asked !== revision) { say(`"${file.name}" was not opened: the project changed again meanwhile. Your current work is unchanged.`, 'error'); return; }
    }
    // A converted project over the limit keeps the original file's bytes for Download original.
    if (result.overBudgetBytes > 0 && !bytes) bytes = await readFileBytes(file);
    if (gen !== generation) return;
    replaceProject(result.project, result.overBudgetBytes > 0 ? { name: file.name, bytes } : null, { converted: !!result.migratedFrom });
    adoptProofs(proofs);
    rememberChecked(result);
    if (!result.migratedFrom && !(result.overBudgetBytes > 0)) { fileInfo = { kind: 'opened', at: new Date() }; renderFileState(); }
    const counts = `${doc.findings.length} findings, ${evidenceCount()} screenshots`;
    // Screenshots that still carried hidden data were cleaned on open; saving keeps the clean copy.
    const cleaned = cleanedNote(result.cleanedImages);
    if (cleaned) markDirty();
    if (result.overBudgetBytes > 0) say(`Opened "${file.name}" (${counts}) and converted it from an older version. It is over the ${CAP} limit, so it cannot be saved as it is. Remove a screenshot you no longer need, or split the engagement into two reports. When it does save, it is written as project format 8, which Rootnote 0.2.x and earlier cannot open.${cleaned}`, 'error');
    else if (result.migratedFrom) say(`Opened "${file.name}" (${counts}). Converted from an older version, so it now allows up to ${LIMITS.findings} findings and ${LIMITS.evidence} screenshots. Saving writes project format 8, which Rootnote 0.2.x and earlier cannot open. Keep your original file if you still need it.${cleaned}`);
    else say(`Opened "${file.name}" (${counts}).${cleaned}`, 'info', { fade: !cleaned });
    render();
    return true;
  }

  // ---- opt-in recovery draft (src/editor/draft.js) ----
  // Off by default. When on, the project is kept as a validated draft in this browser
  // profile a few seconds after each change. A draft found at start is offered, never
  // loaded silently, and nothing overwrites it until the user restores or discards it.
  const DRAFT_DELAY = 4000;
  // Screenshots the draft check has decoded successfully in this session, for this project only:
  // a new or opened project starts empty. Content-keyed (see openProjectFile); at most one
  // entry per image the project can hold, then it starts over.
  let draftDecoded = { gen: -1, map: new Map() };
  const decodedForDrafts = () => {
    if (draftDecoded.gen !== generation || draftDecoded.map.size > 2 * LIMITS.images) draftDecoded = { gen: generation, map: new Map() };
    return draftDecoded.map;
  };
  // Screenshots checked completely in this session (opened, restored or by a draft check), for
  // this project only (see openProjectData). The draft check does not check them again while
  // their data and attributes are unchanged; only the project's own screenshots are kept.
  let proofState = { gen: -1, map: new Map() };
  const sessionProofs = () => {
    if (proofState.gen !== generation) proofState = { gen: generation, map: new Map() };
    return proofState.map;
  };
  const adoptProofs = (map) => { proofState = { gen: generation, map }; };
  const newDraftRev = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  // Independent review F3: on a file:// page every local HTML file shares this storage.
  const DRAFT_DISCLOSURE = 'Keep an unencrypted recovery draft in this browser profile. It includes screenshots. Because the app runs from a file on your disk, any other web page or HTML file you open from this computer\'s disk in this browser can read or replace the draft, and anyone with access to this profile may be able to read it. Leave it off if you open HTML files from targets or tools in this browser. Save a project file for your own backup. Turning this off deletes the draft and reports whether that worked.';
  const draftState = { supported: true, enabled: false, epoch: 0, pending: null, timer: null, sessionOff: false, keptAt: null, busy: false, maybeStored: false };
  const draftNote = h('span', { class: 'draft-note', 'data-testid': 'draft-note', hidden: true });
  const draftBanner = h('div', { class: 'recovery', role: 'region', 'aria-label': 'Recovery draft', hidden: true, 'data-testid': 'draft-banner' });
  dirtyBadge.after(draftNote);
  recoveryBanner.after(draftBanner);
  const draftWanted = () => draftState.enabled && !draftState.sessionOff && !draftState.pending;
  // Says only what this tab knows: never claims the browser holds nothing.
  const storageClaim = () => (draftState.enabled ? 'recovery drafts are on, so a draft is also kept in this browser'
    : draftState.maybeStored ? 'a recovery draft may still be stored in this browser (its deletion could not be confirmed)'
      : 'recovery drafts are off in this tab');

  function showDraftNote() {
    draftNote.hidden = !draftState.enabled;
    draftNote.textContent = !draftState.enabled ? ''
      : draftState.pending ? 'Draft paused: an earlier draft is waiting'
        : draftState.sessionOff ? 'Draft paused'
          : draftState.keptAt ? `Draft kept ${draftState.keptAt}` : 'Draft on';
  }

  function scheduleDraft() {
    if (!draftWanted()) return;
    clearTimeout(draftState.timer);
    draftState.timer = setTimeout(writeDraftNow, DRAFT_DELAY);
  }

  async function writeDraftNow() {
    draftState.timer = null;
    if (!draftWanted() || recovery) return;
    if (draftState.busy) { scheduleDraft(); return; }
    const gen = generation;
    const rev = revision;
    const epoch = draftState.epoch;
    draftState.busy = true;
    try {
      // Inside the try: a large project can fail to serialize (memory); that pauses drafts with
      // the same message as a failed write, and the last kept draft stays.
      const savedAt = new Date().toISOString();
      const file = snapshotFile(savedAt);
      if (file.bytes > LIMITS.fileBytes) return;
      // A draft is stored only if it would open in this app as it is. The check reads the
      // snapshot taken above, not the live project. Screenshots already checked completely in
      // this session, with the same data and attributes, are not checked again; this session's
      // decoded screenshots are not decoded again (decodedForDrafts).
      const proofs = sessionProofs();
      const check = await openProjectData(partsToProject(file), file.bytes, { appVersion, decodeImage: decodeImageInBrowser, decodedImages: decodedForDrafts(), proofs, useProofs: true });
      if (!check.ok || check.overBudgetBytes > 0 || check.migratedFrom !== null) return;
      const current = () => gen === generation && rev === revision && epoch === draftState.epoch && draftWanted();
      if (!current()) return; // newer state follows
      const keep = new Set(check.project.images.map((im) => im.dataUrl));
      for (const key of proofs.keys()) if (!keep.has(key)) proofs.delete(key);
      const blob = await partsToBlob(file.parts, { isCurrent: current });
      if (!blob) return;
      if (blob.size !== file.bytes) throw new Error('the draft could not be prepared');
      const result = await writeDraft(epoch, { format: 2, rev: newDraftRev(), savedAt, appVersion, bytes: file.bytes, blob });
      if (result === 'stale') { // turned off or re-enabled in another tab
        draftState.enabled = false;
        say('Recovery drafts were turned off in another tab. Nothing more is kept in this browser.');
      } else if (epoch === draftState.epoch) {
        draftState.keptAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    } catch (err) {
      // The last committed draft stays; this session stops writing.
      draftState.sessionOff = true;
      say(`The recovery draft could not be updated (${err?.message || 'storage error'}). The last kept draft may be older. Save the project to a file.`, 'error');
    } finally {
      draftState.busy = false;
      showDraftNote();
      if (rev !== revision && draftWanted()) scheduleDraft();
    }
  }

  async function setDrafts(on, box) {
    box.disabled = true;
    try {
      if (on) {
        draftState.epoch = await enableDrafts();
        draftState.enabled = true;
        draftState.sessionOff = false;
        say('Recovery drafts are on. A draft of this project is kept in this browser a few seconds after each change.');
        if (dirty) scheduleDraft();
      } else {
        clearTimeout(draftState.timer);
        draftState.timer = null;
        draftState.enabled = false;
        draftState.pending = null;
        draftBanner.hidden = true;
        draftState.epoch = -1; // any write in flight is now stale here too
        draftState.maybeStored = true; // until the deletion is confirmed
        await disableDrafts();
        draftState.maybeStored = false;
        draftState.keptAt = null;
        say('Recovery drafts are off and the draft was deleted from this browser.');
      }
    } catch (err) {
      say(on ? `Recovery drafts could not be turned on: ${err?.message || 'storage error'}.`
        : `Recovery drafts are off, but the stored draft could not be confirmed deleted: ${err?.message || 'storage error'}. Clear this site's data in the browser to remove it.`, 'error');
      if (on) draftState.enabled = false;
    } finally {
      box.disabled = false;
      box.checked = draftState.enabled;
      showDraftNote();
    }
  }

  function draftToggle() {
    const box = h('input', { type: 'checkbox', checked: draftState.enabled, disabled: !draftState.supported, 'data-testid': 'draft-toggle', onchange: (e) => setDrafts(e.target.checked, e.target) });
    box.setAttribute('role', 'switch');
    box.classList.add('switch');
    return h('label', { class: 'toggle' }, box,
      h('span', {}, h('strong', {}, 'Keep a recovery draft in this browser'),
        draftState.supported
          ? h('span', { class: 'quiet' }, 'If the tab closes or the computer restarts, Rootnote offers to continue where you left off. The draft is not encrypted, so leave this off on shared computers. ',
            h('details', { class: 'more-info inline' }, h('summary', {}, 'Privacy details'), h('span', { class: 'quiet' }, DRAFT_DISCLOSURE)))
          : h('span', { class: 'quiet' }, 'Recovery drafts are not available: this browser offers no storage for this page.')));
  }

  function offerDraft(draft, findings) {
    draftState.pending = draft;
    const when = new Date(draft.savedAt).toLocaleString();
    const fits = findings <= maxFindings;
    draftBanner.replaceChildren(
      h('p', {}, h('strong', {}, 'Recovery draft found. '), fits
        ? `A draft from ${when} is kept in this browser. Restore it, or discard it. New drafts are paused until you choose.`
        : `A draft from ${when} with ${findings} findings is kept in this browser, but this ${edition ? `${edition.toLowerCase()} ` : ''}build opens projects with up to ${maxFindings}. It stays stored unchanged; open it in the full version, or discard it. New drafts are paused until you choose.`),
      ...(fits ? [h('button', { type: 'button', 'data-testid': 'draft-restore', onclick: restoreDraft }, 'Restore draft')] : []),
      h('button', { type: 'button', class: 'secondary', 'data-testid': 'draft-discard', onclick: discardPendingDraft }, 'Discard'));
    draftBanner.hidden = false;
    showDraftNote();
  }

  async function restoreDraft() {
    const draft = draftState.pending;
    if (!draft) return;
    // Work typed since the draft was offered is never replaced without asking.
    const askedGen = generation;
    const askedRev = revision;
    if (dirty && !await confirmDialog('Restoring the draft replaces the changes you made since opening the app. Restore anyway?', 'Replace my changes')) return;
    if (draftState.pending !== draft) return;
    if (askedGen !== generation || askedRev !== revision) { say('The draft was not restored: the project changed while you were deciding. It is still offered.', 'error'); return; }
    const gen = generation;
    const rev = revision;
    const epoch = draftState.epoch;
    say('Checking the recovery draft…');
    let stored;
    try { stored = await draftText(draft, LIMITS.fileBytes); } catch (err) {
      say(`The recovery draft cannot be opened (${err?.message || 'storage error'}). It is still stored; discard it to remove it.`, 'error');
      return;
    }
    const proofs = new Map();
    const result = await openProjectFile(stored.text, stored.bytes, { appVersion, decodeImage: decodeImageInBrowser, proofs });
    if (!result.ok || result.overBudgetBytes > 0) {
      say(`The recovery draft cannot be opened (${(result.errors || [`over the ${CAP} limit`]).slice(0, 2).join(' · ')}). It is still stored; discard it to remove it.`, 'error');
      return;
    }
    if (result.project.findings.length > maxFindings) { // same rule as Open
      say(`The recovery draft has ${result.project.findings.length} findings; this ${edition ? `${edition.toLowerCase()} ` : ''}build opens projects with up to ${maxFindings}. The draft is still stored and unchanged.`, 'error');
      return;
    }
    if (gen !== generation || rev !== revision) { // edited or replaced while checking
      say('The draft was not restored because the project changed while it was being checked. It is still offered.', 'error');
      return;
    }
    // Turned off, discarded or replaced (here or in another tab) while checking.
    let now;
    try { now = await readDraftState(); } catch { now = null; }
    if (draftState.pending !== draft || !draftState.enabled || epoch !== draftState.epoch || !now?.enabled || now.epoch !== epoch || !sameDraft(now.draft, draft)) {
      if (draftState.pending === draft) { draftState.pending = null; draftBanner.hidden = true; showDraftNote(); }
      say('The draft was not restored: recovery drafts were changed or turned off meanwhile.', 'error');
      return;
    }
    if (gen !== generation || rev !== revision) {
      say('The draft was not restored because the project changed while it was being checked. It is still offered.', 'error');
      return;
    }
    replaceProject(result.project);
    adoptProofs(proofs);
    rememberChecked(result);
    draftState.pending = null;
    draftBanner.hidden = true;
    markDirty(); // a draft is not a saved file
    say(`Restored the recovery draft (${doc.findings.length} findings). Save it to a file to keep it.${cleanedNote(result.cleanedImages)}`);
    render();
  }

  async function discardPendingDraft() {
    if (!draftState.pending) return;
    try {
      const r = await discardDraft(draftState.epoch);
      draftState.pending = null;
      draftBanner.hidden = true;
      say(r === 'ok' ? 'The recovery draft was discarded.' : 'Recovery drafts were turned off elsewhere; nothing was discarded here.');
      if (dirty) scheduleDraft();
    } catch (err) {
      say(`The recovery draft could not be discarded: ${err?.message || 'storage error'}.`, 'error');
    }
    showDraftNote();
  }

  draftReady = true;
  // Start: read the preference; offer a valid draft only to a clean, empty project.
  readDraftState().then(async (state) => {
    draftState.enabled = state.enabled;
    draftState.epoch = state.epoch;
    if (state.enabled && state.draft && !dirty && revision === 0) {
      const d = state.draft;
      const gen = generation;
      let check = { ok: false };
      try {
        const stored = await draftText(d, LIMITS.fileBytes);
        check = await openProjectFile(stored.text, stored.bytes, { appVersion, decodeImage: decodeImageInBrowser });
      } catch { /* unreadable or unknown: not offered, and left as it is */ }
      // Offer only if nothing changed meanwhile, here or in another tab: still on, same
      // epoch and the same draft in the store, same clean project.
      let now = null;
      if (check.ok && check.overBudgetBytes === 0) { try { now = await readDraftState(); } catch { now = null; } }
      if (now && revision === 0 && gen === generation && !draftState.pending && draftState.enabled && draftState.epoch === state.epoch &&
          now.enabled && now.epoch === state.epoch && sameDraft(now.draft, d)) offerDraft(d, check.project.findings.length);
      else if (now && !now.enabled) draftState.enabled = false;
    }
    showDraftNote();
    if (view === 'export') renderMain();
  }, () => { draftState.supported = false; if (view === 'export') renderMain(); });

  render();
  // Test hook: read-only snapshot of state, used by the browser tests.
  return { snapshot: () => JSON.parse(JSON.stringify(doc)), isDirty: () => dirty, savedBytes, useEngagementsFolder };
}
