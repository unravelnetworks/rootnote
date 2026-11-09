// Guide screenshots from the app build that the guide describes (dist/rootnote.html),
// light theme, synthetic sample only. Each shot is cropped to the elements it is about and the
// controls to use are outlined with a numbered guide callout.
// Crops and callouts come from the live elements' boxes, so they follow UI changes; a missing,
// hidden or off-screen target fails the run instead of leaving an outdated picture.
// Writes docs/guide/images/*.png and provenance.json (app sha256, browser, steps).
// Usage: node site/guide-shots.cjs [name ...]
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const { pathToFileURL } = require('url');
const root = path.resolve(__dirname, '..');
const { launch, sleep } = require(path.join(root, 'tests/harness/cdp.cjs'));
const app = path.join(root, 'dist/rootnote.html');
const outDir = path.join(root, 'docs/guide/images');
const VIEW = { width: 1280, height: 1000 }, SCALE = 2, PAD = 10;

const q = (sel) => JSON.stringify(sel);
const click = (b, sel) => b.evaluate(`document.querySelector(${q(sel)}).click()`);
const navTo = (b, text) => b.evaluate(`[...document.querySelectorAll('.navitem')].find((e) => e.textContent.trim().startsWith(${q(text)})).click()`);
const openSample = async (b) => { await click(b, '[data-testid=start-sample]'); await b.waitFor('window.__fieldnote.snapshot().findings.length === 8'); await sleep(300); };
const finding1 = '.navitem:has(.ftitle)';

// crop: elements whose joint box (plus padding) is the picture; marks: [selector, number].
const SHOTS = [
  { name: 'start', steps: 'start screen: heading and the three choices', crop: ['.start h1', '.choices'], marks: [] },
  { name: 'start-sample', steps: 'start screen: Explore the sample card, Open the sample marked 1',
    crop: ['[data-testid=start-sample]', '.choice:has([data-testid=start-sample])'], marks: [['[data-testid=start-sample]', 1]] },
  { name: 'nav', steps: 'sample open: the section list with Details & cover, the first finding and Preview report marked',
    run: openSample, crop: ['#report-nav > ul'], marks: [],
    custom: async (b) => {
      const pick = (t) => `[...document.querySelectorAll('#report-nav .navitem')].find((e) => e.textContent.trim().startsWith(${q(t)}))`;
      return [[pick('Details'), 1], [`document.querySelector(${q(finding1)})`, 2], [pick('Preview'), 3]];
    } },
  { name: 'title', steps: 'Details & cover: Report title changed to "(practice)", field marked 1',
    run: async (b) => {
      await openSample(b); await navTo(b, 'Details');
      await b.evaluate(`(() => { const i = document.querySelector('[data-testid=title]'); i.focus(); i.value = 'Customer Portal Security Assessment (practice)'; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); })()`);
    },
    crop: ['label.field:has([data-testid=title])'], marks: [['[data-testid=title]', 1]] },
  { name: 'save', steps: 'top bar after a change: Save marked 1', run: async (b) => {
      await openSample(b); await navTo(b, 'Details');
      await b.evaluate(`(() => { const i = document.querySelector('[data-testid=title]'); i.value += ' (practice)'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    }, crop: ['.top .dirty', '.top-actions'], marks: [['[data-testid=save]', 1]] },
  { name: 'open', steps: 'start screen: Open a project card, Open… marked 1',
    crop: ['.choice:has([data-testid=start-open])'], marks: [['[data-testid=start-open]', 1]] },
  { name: 'preview', steps: 'Preview report: toolbar and the cover page, Go to marked 1, Print / Save as PDF marked 2',
    run: async (b) => { await openSample(b); await navTo(b, 'Preview'); await b.waitFor("document.querySelectorAll('.pv-page').length > 3"); },
    crop: ['label:has([data-testid=preview-jump])', '[data-testid=print-pdf]'], marks: [['[data-testid=preview-jump]', 1], ['[data-testid=print-pdf]', 2]] },
  { name: 'export', steps: 'Check & export: paper size and the Word export button, marked 1',
    run: async (b) => { await openSample(b); await navTo(b, 'Check'); },
    crop: ['.xcard .seg', '[data-testid=export]'], marks: [['[data-testid=export]', 1]] },
  { name: 'new-report', steps: 'start screen: New report card, New report marked 1',
    crop: ['.choice:has([data-testid=start-new])'], marks: [['[data-testid=start-new]', 1]] },
  // Write findings
  { name: 'facts', view: 880, steps: 'first finding: tag, key facts and CVSS calculator; Severity marked 1, CVSS calculator marked 2',
    run: async (b) => { await openSample(b); await b.evaluate(`document.querySelector(${q(finding1)}).click()`); await sleep(400); },
    crop: ['[data-testid=finding-tag]', '[data-testid=key-facts]', '[data-testid=cvss-calculator]'], marks: [['[data-testid=rating]', 1], ['[data-testid=cvss-calculator] > summary', 2]] },
  { name: 'blocks', view: 880, steps: 'Additional details, pointer between blocks: the insert bar with Screenshot marked 1, and the first text block',
    run: async (b) => {
      await openSample(b); await b.evaluate(`document.querySelector(${q(finding1)}).click()`); await sleep(400);
      const r = await b.evaluate("(() => { const e = document.querySelector('[data-testid=details-text]'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + 40, r.top - 60]; })()");
      await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r[0], y: r[1] }); await sleep(300);
    },
    crop: ['[data-testid=details-blocks] [data-testid=add-text]', '[data-testid=details-blocks] [data-testid=add-repro]', '[data-testid=details-text]'],
    marks: [['[data-testid=add-screenshot]', 1]] },
  { name: 'library', steps: 'Finding library: tabs and buttons; OWASP starter marked 1, Open library marked 2',
    run: async (b) => { await openSample(b); await navTo(b, 'Finding library'); },
    crop: ['[data-testid=library-tab-mine]', '[data-testid=library-tab-starter]', '[data-testid=library-open]', '[data-testid=library-save]'],
    marks: [['[data-testid=library-tab-starter]', 1], ['[data-testid=library-open]', 2]] },
  // Screenshots
  { name: 'screenshot-card', view: 880, steps: 'a screenshot in Additional details; Caption marked 1, Black out or crop marked 2',
    run: async (b) => { await openSample(b); await b.evaluate(`document.querySelector(${q(finding1)}).click()`); await sleep(400); },
    crop: ['.card:has([data-testid=caption])'], marks: [['[data-testid=caption]', 1], ['[data-testid=edit-screenshot]', 2]] },
  { name: 'redact', steps: 'screenshot editor: the tool buttons and the top of the picture; Black out marked 1',
    run: async (b) => { await openSample(b); await b.evaluate(`document.querySelector(${q(finding1)}).click()`); await sleep(400); await click(b, '[data-testid=edit-screenshot]'); await sleep(900); },
    crop: ['dialog[open] [data-testid=redact-blackout]', 'dialog[open] [data-testid=redact-crop]'], extendDown: 170,
    marks: [['dialog[open] [data-testid=redact-blackout]', 1]] },
  // Design the report
  { name: 'logos', steps: 'Details & cover, Page, cover and logos opened; Your logo marked 1, Client logo marked 2',
    run: async (b) => { await openSample(b); await navTo(b, 'Details'); await b.evaluate("document.querySelector('[data-testid=disclose-branding]').open = true"); await sleep(300); },
    crop: ['[data-testid=logo-testerLogo]', '[data-testid=logo-clientLogo]'], marks: [['[data-testid=logo-testerLogo]', 1], ['[data-testid=logo-clientLogo]', 2]] },
  { name: 'sections', steps: 'Sections & scoring: Scoring choice marked 1 and the report section list',
    run: async (b) => { await openSample(b); await navTo(b, 'Sections'); },
    crop: ['label:has([data-testid=scoring-mode])'], marks: [['[data-testid=scoring-mode]', 1]] },
  { name: 'section-list', steps: 'Sections & scoring: report sections in order; a Show box marked 1, the move arrows marked 2',
    run: async (b) => { await openSample(b); await navTo(b, 'Sections'); },
    crop: ['[data-testid=sections-report]'], marks: [['[data-testid=sections-report] li:nth-child(2) input[type=checkbox]', 1], ['[aria-label="Move Executive summary down"]', 2]] },
  // Files and export
  { name: 'recovery', steps: 'Check & export: Keep a recovery draft switch marked 1',
    run: async (b) => { await openSample(b); await navTo(b, 'Check'); },
    crop: ['label:has([data-testid=draft-toggle])'], marks: [['[data-testid=draft-toggle]', 1]] },
  { name: 'checks', steps: 'Check & export: the list of things to look at; first Fix button marked 1',
    run: async (b) => { await openSample(b); await navTo(b, 'Check'); },
    crop: ['[data-testid=review-state]', '[data-testid=warnings]', '[data-testid=checks-passed]'], marks: [['[data-testid=warnings] button', 1]] },
];

// Guide callouts: crimson outline and a numbered badge, drawn over the page (not app UI).
const DRAW = `(marks) => {
  for (const [el, n] of marks) {
    const r = el.getBoundingClientRect();
    const box = document.createElement('div');
    Object.assign(box.style, { position: 'fixed', left: (r.left - 4) + 'px', top: (r.top - 4) + 'px', width: (r.width + 8) + 'px', height: (r.height + 8) + 'px',
      border: '3px solid #e1061a', borderRadius: '9px', boxShadow: '0 0 0 4px rgb(225 6 26 / .18)', zIndex: 99999, pointerEvents: 'none', boxSizing: 'border-box' });
    box.className = 'guide-callout';
    (el.closest('dialog[open]') || document.body).append(box);
    if (!n) continue;
    const badge = document.createElement('div');
    badge.textContent = String(n);
    Object.assign(badge.style, { position: 'fixed', left: (r.right - 6) + 'px', top: Math.max(2, r.top - 16) + 'px', width: '24px', height: '24px', borderRadius: '50%',
      background: '#e1061a', color: '#fff', font: '700 14px/24px "Segoe UI", sans-serif', textAlign: 'center', zIndex: 100000, boxShadow: '0 1px 3px rgb(0 0 0 / .35)' });
    badge.className = 'guide-callout';
    (el.closest('dialog[open]') || document.body).append(badge);
  }
}`;

(async () => {
  const only = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const provFile = path.join(outDir, 'provenance.json');
  const old = fs.existsSync(provFile) ? JSON.parse(fs.readFileSync(provFile, 'utf8')) : { shots: [] };
  const b = await launch('chrome', 9613);
  const provenance = { app: 'dist/rootnote.html', appSha256: crypto.createHash('sha256').update(fs.readFileSync(app)).digest('hex'),
    viewport: `${VIEW.width}x${VIEW.height}@${SCALE}`, theme: 'light', shots: only.length ? old.shots.filter((s) => !only.includes(s.name)) : [] };
  try {
    provenance.browser = (await b.send('Browser.getVersion')).product;
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await b.send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: SCALE, mobile: false });
    for (const shot of SHOTS.filter((s) => !only.length || only.includes(s.name))) {
      await b.send('Emulation.setDeviceMetricsOverride', { ...VIEW, width: shot.view || VIEW.width, deviceScaleFactor: SCALE, mobile: false });
      await b.navigate(pathToFileURL(app).href);
      await b.waitFor("document.getElementById('app').dataset.ready === '1'");
      if (shot.run) await shot.run(b);
      await b.evaluate("document.querySelector('.status').hidden = true");
      await sleep(300);
      // Bring the crop into view, then measure it and every mark; all must be visible.
      const markExprs = shot.custom ? await shot.custom(b) : shot.marks.map(([sel, n]) => [`document.querySelector(${q(sel)})`, n]);
      const geo = await b.evaluate(`(() => {
        const crop = ${q(shot.crop)}.map((s) => document.querySelector(s));
        if (crop.some((e) => !e)) return { error: 'crop element missing: ' + ${q(shot.crop)}[crop.findIndex((e) => !e)] };
        const top = crop[0].getBoundingClientRect().top; if (top > innerHeight * 0.5) { crop[0].scrollIntoView({ block: 'start' }); window.scrollBy(0, -90); }
        const marks = [${markExprs.map(([e, n]) => `[${e}, ${n}]`).join(',')}];
        for (const [el, n] of marks) {
          if (!el) return { error: 'mark ' + n + ' missing' };
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') return { error: 'mark ' + n + ' hidden' };
        }
        (${DRAW})(marks);
        const rs = crop.map((e) => e.getBoundingClientRect()).concat(marks.map(([el, n]) => { const r = el.getBoundingClientRect(); return { left: r.left - 8, top: r.top - (n ? 18 : 8), right: r.right + (n ? 20 : 8), bottom: r.bottom + 8 }; }));
        const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top));
        return { x, y, right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) + ${shot.extendDown || 0}, vw: innerWidth, vh: innerHeight, sx: scrollX, sy: scrollY };
      })()`);
      if (geo.error) throw new Error(`${shot.name}: ${geo.error}`);
      const x = Math.max(0, geo.x - PAD), y = Math.max(0, geo.y - PAD);
      // Measured in the window; the capture wants page coordinates.
      const clip = { x: x + geo.sx, y: y + geo.sy, width: Math.min(geo.vw, geo.right + PAD) - x, height: Math.min(geo.vh, geo.bottom + PAD) - y, scale: 1 };
      if (geo.bottom + PAD > geo.vh + 1) throw new Error(`${shot.name}: the crop runs below the window`);
      await sleep(100);
      const s = await b.send('Page.captureScreenshot', { format: 'png', clip });
      const bytes = Buffer.from(s.data, 'base64');
      fs.writeFileSync(path.join(outDir, shot.name + '.png'), bytes);
      provenance.shots.push({ name: shot.name, steps: shot.steps, size: `${Math.round(clip.width)}x${Math.round(clip.height)}`, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
      console.log('shot', shot.name, Math.round(clip.width) + 'x' + Math.round(clip.height), Math.round(bytes.length / 1024) + ' KB');
    }
  } finally { await b.close(); }
  provenance.shots.sort((a, c) => SHOTS.findIndex((s) => s.name === a.name) - SHOTS.findIndex((s) => s.name === c.name));
  fs.writeFileSync(provFile, JSON.stringify(provenance, null, 2) + '\n');
})().catch((e) => { console.error(e); process.exit(1); });
