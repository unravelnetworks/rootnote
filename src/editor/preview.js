// Approximate page preview built from the shared report plan (src/export-docx/plan.js).
// Sizes are CSS px at 96 dpi from the plan's
// geometry; screenshot parts show exactly the plan's source rows. Text pagination is
// the browser's, not Word's, so page breaks are approximate and the view says so.
import { h, setRuntimeStyle } from './dom.js';
import { ratingBadge } from '../export-docx/design.js';

const TALL_MODES = [['auto', 'Automatic'], ['split', 'Split into parts'], ['fit', 'Shrink to fit']];

/**
 * Renders `plan` into `host` (which must be in the document, so blocks can be measured).
 * `onTallMode(imageId, mode)` is called when a screenshot's fit/split choice changes;
 * `images` maps image id to the project's image record.
 */
export function renderPreview(host, plan, { images, onTallMode }) {
  const g = plan.geometry;
  const px = (n) => `${Math.round(n * 100) / 100}px`;
  const assets = new Map(plan.imageAssets.map((im) => [im.id, im]));
  const d = plan.design;
  const pt = (n) => px(n * 96 / 72);
  const pages = h('div', { class: 'pv-pages', style: `--pv-accent: #${d.accent}; --pv-on-accent: #${d.onAccent}; --pv-ink: #${d.ink}; --pv-muted: #${d.muted}; --pv-line: #${d.line}; --pv-soft: #${d.soft}; --pv-label: #${d.labelFill}; --pv-code: #${d.codeFill}; --pv-code-border: #${d.codeBorder}; --pv-body-after: ${pt(d.bodyAfterPt)}; --pv-body-line: ${pt(d.bodyLinePt)}; --pv-code-line: ${pt(d.codeLinePt)}; --pv-h2-before: ${pt(d.heading2BeforePt)}; --pv-h2-after: ${pt(d.heading2AfterPt)}; --pv-caption-after: ${pt(d.captionAfterPt)}; --pv-image-before: ${pt(d.imageBeforePt)}; --pv-image-after: ${pt(d.imageAfterPt)}` });
  // A report that would mix CVSS versions is not printed by any route (the app's button, Ctrl+P
  // or the browser menu): print media shows this notice instead of the pages (style.css).
  const mixed = plan.findings.filter((f) => f.scoring.some((s) => s.mismatch)).length;
  const printBlock = mixed ? h('div', { class: 'pv-print-block', 'data-testid': 'print-block' },
    h('p', {}, `This report was not printed: ${mixed === 1 ? '1 finding is' : `${mixed} findings are`} scored in another CVSS version than the report's. Rescore or clear ${mixed === 1 ? 'its score' : 'their scores'} in Rootnote, then print again.`)) : null;
  host.toggleAttribute('data-print-blocked', !!mixed);
  host.replaceChildren(
    h('p', { class: 'pv-note', 'data-testid': 'preview-note' }, h('strong', {}, 'Approximate pages; check the exported report in Word. '),
      'Screenshot sizes and split parts follow the export settings; where Word breaks text across pages can differ.'),
    ...(printBlock ? [printBlock] : []),
    pages);
  // Print rules for any print of the preview, from the app's button, Ctrl+P or the browser
  // menu: the report's paper size, and page boxes half a millimetre shorter than the paper.
  // In Firefox a box of exactly the paper height spilled onto a blank extra sheet after every
  // A4 page (its PDF sheet is 596 x 842 pt; the exact rounding or fractional-layout cause is
  // not established). Safari on macOS did the same with half a millimetre,
  // so the box is now 2 mm shorter (white space at the foot of the sheet) and each new sheet
  // is started before a page rather than after one (style.css). Content is not clipped, so a
  // real overflow still shows.
  setRuntimeStyle('preview-page', `@page { size: ${px(g.pageWidth)} ${px(g.pageHeight)}; margin: 0; } @media print { .pv-page { height: calc(${px(g.pageHeight)} - 2mm) !important; } }`);

  const logoImg = (logo) => {
    const im = assets.get(logo.imageId);
    return h('img', { class: 'pv-logo', src: im.dataUrl, alt: logo.role === 'clientLogo' ? 'Client logo' : 'Logo', style: `width: ${px(logo.width)}; height: ${px(logo.height)}` });
  };
  // Tester logo on the left, client logo right-aligned, as in the exporter's tab-stop row.
  const logoRow = (logos) => h('div', { class: 'pv-logo-row' },
    ...['testerLogo', 'clientLogo'].map((role) => { const l = logos.find((x) => x.role === role); return l ? logoImg(l) : h('span', {}); }));
  // `literal` (plan: bound engagement rows, asset lines) keeps a leading "- " as text.
  const paragraphs = (text, format, literal = false) => {
    if (format === 'code') return [h('pre', { class: 'pv-code' }, text)];
    return text.split(/\r\n|\r|\n/).map((line) => (!literal && line.startsWith('- ')
      ? h('p', { class: 'pv-bullet' }, '• ', line.slice(2).replace(/\t/g, '    '))
      : h('p', {}, line.replace(/\t/g, '    ') || ' ')));
  };

  // ---- pages ----
  let bodyPages = [];
  function newPage(kind) {
    const header = h('div', { class: 'pv-header', style: `top: ${px(g.headerDistance)}; left: ${px(g.margin.left)}; right: ${px(g.margin.right)}` });
    const footer = h('div', { class: 'pv-footer', style: `bottom: ${px(g.footerDistance)}; left: ${px(g.margin.left)}; right: ${px(g.margin.right)}` });
    const body = h('div', { class: 'pv-body', style: `top: ${px(g.margin.top)}; left: ${px(g.margin.left)}; width: ${px(g.contentWidth)}; height: ${px(g.contentHeight)}` });
    const page = h('div', { class: `pv-page pv-page-${kind}`, style: `width: ${px(g.pageWidth)}; height: ${px(g.pageHeight)}` }, header, body, footer);
    pages.append(page);
    if (kind === 'body') {
      // Without a cover the first body page carries the front logos, so its header has none.
      const logos = bodyPages.length ? plan.running.headerLogos : plan.running.firstPageHeaderLogos;
      if (logos.length) header.append(logoRow(logos));
      header.append(h('div', { class: 'pv-running pv-running-title' }, plan.running.title));
      bodyPages.push({ page, footer });
    }
    return body;
  }

  // Places blocks in order; a block that overflows a non-empty page moves to the next one.
  // Headings directly above it move with it (Word's keep-with-next on heading styles).
  // A single block taller than a page stays and overflows visibly (Word would split it).
  let body = null;
  function place(block, { newPageBefore = false } = {}) {
    if (!body || (newPageBefore && body.childElementCount)) body = newPage('body');
    body.append(block);
    if (body.scrollHeight > body.clientHeight + 1 && body.childElementCount > 1) {
      const moving = [block];
      while (moving[0].previousElementSibling && /^H[1-3]$/.test(moving[0].previousElementSibling.tagName) &&
        body.childElementCount > moving.length + 1) moving.unshift(moving[0].previousElementSibling);
      moving.forEach((b) => b.remove());
      body = newPage('body');
      body.append(...moving);
    }
    if (body.scrollHeight > body.clientHeight + 1) block.classList.add('pv-overflow');
  }

  // ---- cover or title block (same blocks; the cover adds the logo band) ----
  const m = plan.metadata;
  const front = (cover) => [
    cover ? h('div', { class: 'pv-cover-band' }, logoRow(plan.cover.logos))
      : plan.cover.logos.length ? logoRow(plan.cover.logos) : null,
    h('div', { class: 'pv-title', style: `font-size: ${pt(cover ? d.titlePt : d.compactTitlePt)}` }, m.title),
    m.subtitle ? h('p', { class: 'pv-subtitle', style: `font-size: ${pt(d.subtitlePt)}` }, m.subtitle.replace(/\t/g, '    ')) : null,
    h('div', { class: 'pv-title-rule' }),
    plan.cover.details.length ? h('table', { class: 'pv-cover-details' }, h('tbody', {}, ...plan.cover.details.map((r) => h('tr', {}, h('th', {}, r.label), h('td', {}, r.value))))) : null,
    m.classification ? h('p', { class: cover ? 'pv-classification pv-classification-cover' : 'pv-classification' }, m.classification) : null];
  if (plan.cover.enabled) newPage('cover').append(h('div', { class: 'pv-cover' }, ...front(true)));
  else place(h('div', { class: 'pv-titleblock' }, ...front(false)));

  // ---- report sections ----
  for (const s of plan.reportSections) {
    // Without a cover the title block stands alone: the first section starts a new page.
    // The summary heading is the one target of the back-to-summary links, as in Word, so a
    // return lands above the count tables.
    // In v4 every emitted section heading is a contents target (plan anchor).
    const anchor = s.anchor ?? (s.kind === 'summary' ? plan.summary.anchor : null);
    const heading = () => place(h('h1', anchor ? { id: `pv-${anchor}` } : {}, s.label), { newPageBefore: !!s.pageBreakBefore });
    if (s.kind === 'contents') {
      // Linked list, no page numbers (v4 rule 20); findings are indented under their chapter.
      heading();
      for (const r of plan.contents.rows) place(h('p', { class: `pv-contents pv-contents-${r.depth}` }, ...internalLink(r.anchor, r.text)));
      continue;
    }
    if (s.kind === 'summary') {
      const table = h('table', { class: 'pv-summary', style: `--pv-id-size: ${pt(plan.summary.idFontPt ?? 10)}` },
        h('colgroup', {}, ...plan.summary.columns.map((c) => h('col', c.widthPct ? { style: `width: ${c.widthPct}%` } : {}))),
        h('thead', {}, h('tr', {}, ...plan.summary.columns.map((c) => h('th', {}, c.label)))),
        h('tbody', {}, ...plan.summary.rows.map((r) => h('tr', {}, ...plan.summary.columns.map((c) => h('td', badgeAttrs(r.badges?.[c.key]),
          c.key === 'title'
            ? internalLink(r.anchor, r.values.title || '(untitled)')
            : r.values[c.key] ?? ''))))));
      heading();
      // The finding list first, then the plan's compact count
      // tables: levels across, counts below, Total last.
      place(table);
      // The count tables and the note move as one block, as Word keeps them together.
      const counts = plan.summary.countTables.map((t) =>
        h('table', { class: `pv-counts${t.key === 'status' ? ' pv-counts-status' : ''}`, 'data-distribution': t.key },
          h('thead', {}, h('tr', {}, h('th', { class: 'pv-counts-name' }, t.label), ...t.columns.map((c) => h('th', c.key === 'total' ? { class: 'pv-counts-total' } : badgeAttrs(c.badge), c.label)))),
          h('tbody', {}, h('tr', {}, h('td', { class: 'pv-counts-name' }, t.rowLabel), ...t.columns.map((c) => h('td', c.key === 'total' ? { class: 'pv-counts-total' } : {}, String(c.count)))))));
      const note = plan.summary.statusNote ? h('p', { class: 'pv-status-note' }, plan.summary.statusNote) : null;
      const withheld = plan.summary.cvssCountsNote ? h('p', { class: 'pv-status-note pv-withheld', 'data-testid': 'cvss-counts-withheld' }, plan.summary.cvssCountsNote) : null;
      if (counts.length || note || withheld) place(h('div', { class: 'pv-keep pv-counts-block' }, withheld, ...counts, note));
    } else if (s.kind === 'engagement') {
      heading();
      place(h('table', { class: 'pv-engagement' }, h('tbody', {}, ...s.rows.map((r) => h('tr', {}, h('th', {}, r.label), h('td', {}, ...paragraphs(r.value, r.format, r.literal)))))));
    } else {
      heading();
      for (const p of paragraphs(s.text, s.format)) place(p);
    }
  }

  // ---- findings ----
  if (plan.findings.length) place(h('h1', { class: 'pv-chapter', ...(plan.findingsAnchor ? { id: `pv-${plan.findingsAnchor}` } : {}) }, plan.labels.findings), { newPageBefore: true });
  plan.findings.forEach((f, i) => {
    place(h('h1', { class: 'pv-finding', id: `pv-${f.anchor}` }, h('span', { class: 'pv-finding-id' }, `${f.displayId} `), f.title || '(untitled)'), { newPageBefore: i > 0 });
    place(h('table', { class: 'pv-keyfacts' }, h('tbody', {}, ...f.keyFacts.map((k) => h('tr', {}, h('th', {}, k.label),
      h('td', badgeAttrs(k.badge), h('div', {}, k.value), k.detail ? h('div', { class: 'pv-keyfacts-detail' }, k.detail) : null))))));
    if (f.backToSummary) place(backLink());
    for (const s of f.sections) {
      // A short text section (plan keepTogether) moves to the next page as one unit.
      if (s.kind === 'text' && s.keepTogether) { place(h('div', { class: 'pv-keep' }, h('h2', {}, s.label), ...paragraphs(s.text, s.format, s.literal))); continue; }
      place(h('h2', {}, s.label));
      if (s.kind === 'text') { for (const p of paragraphs(s.text, s.format, s.literal)) { p.dataset.section = s.key; place(p); } continue; }
      if (s.kind === 'references') {
        for (const r of s.rows) place(h('div', { class: 'pv-reference' }, h('p', {}, r.title), r.url ? h('p', { class: 'pv-reference-url' }, r.url) : null));
        continue;
      }
      if (s.kind === 'blocks') {
        // v3 Additional details: text and screenshots in the user's order, one heading.
        for (const blk of s.blocks) {
          if (blk.kind === 'text') for (const p of paragraphs(blk.text, blk.format)) { p.dataset.block = blk.blockId; place(p); }
          else placeEvidence(blk.image);
        }
        continue;
      }
      for (const ev of s.images) placeEvidence(ev);
    }
  });
  if (!body) newPage('body');

  function badgeAttrs(badge) {
    return badge ? { class: 'pv-badge', style: `background: #${badge.fill}; color: #${badge.textColor}` } : {};
  }
  function backLink() {
    return h('p', { class: 'pv-back' }, ...internalLink(plan.summary.anchor, plan.labels.backToSummary));
  }
  // A link within the preview, plus a plain-text twin. Firefox writes every link into a
  // printed PDF a second time as a URI holding the page's own address (for the downloaded
  // file, its local path), so its print stylesheet shows the twin instead of the link.
  function internalLink(anchor, text) {
    return [
      h('a', { class: 'pv-link', href: `#pv-${anchor}`, onclick: (e) => { e.preventDefault(); host.querySelector(`#pv-${anchor}`)?.scrollIntoView({ block: 'start' }); } }, text),
      h('span', { class: 'pv-link-text' }, text)
    ];
  }

  function placeEvidence(ev) {
    const im = assets.get(ev.imageId);
    ev.parts.forEach((part) => {
      const scale = part.width / part.sourceWidth;
      const crop = h('div', { class: 'pv-crop', style: `width: ${px(part.width)}; height: ${px(part.height)}` },
        h('img', { src: im.dataUrl, alt: `${plan.labels.figure} ${ev.figure}${part.captionSuffix}`, style: `width: ${px(im.width * scale)}; height: ${px(im.height * (part.height / part.sourceHeight))}; top: ${px(-part.y * (part.height / part.sourceHeight))}` }));
      const caption = h('p', { class: 'pv-caption' }, `${plan.labels.figure} ${ev.figure}: ${ev.caption}${part.captionSuffix}`);
      const control = part.index === 1 ? tallControl(ev, part.count) : null;
      place(h('figure', { class: 'pv-figure', dataset: { image: ev.imageId, part: String(part.index) } }, control, crop, caption));
    });
  }

  function tallControl(ev, count) {
    const record = images.get(ev.imageId);
    return h('div', { class: 'pv-control', 'data-ui': '1' },
      h('label', {}, 'Screenshot layout: ',
        h('select', { 'data-testid': 'preview-tall-mode', onchange: (e) => onTallMode(ev.imageId, e.target.value) },
          ...TALL_MODES.map(([v, t]) => h('option', { value: v, selected: record.tallMode === v }, t)))),
      h('span', { class: 'hint' }, count > 1 ? ` ${count} parts` : ' one part'));
  }

  // ---- running footer: logos above; prefix left and Page X of Y right, over a rule ----
  bodyPages.forEach(({ footer }, k) => {
    if (plan.running.footerLogos.length) footer.append(logoRow(plan.running.footerLogos));
    footer.append(h('div', { class: 'pv-running pv-running-footer' }, h('span', {}, plan.running.footerPrefix),
      h('span', {}, `${plan.labels.page} ${k + 1} ${plan.labels.pageOf} ${bodyPages.length}`)));
  });
  return { bodyPages: bodyPages.length, coverPage: plan.cover.enabled };
}
