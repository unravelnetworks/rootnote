// Builds the static Rootnote website for rootnote.unravelnetworks.com into site/out/:
//   /            landing page (no scripts)
//   /app/        the app: byte-identical copy of dist/rootnote.html
//   /guide/      the Guide (docs/guide) and the README as a page; /privacy/ /licence/ /security/ /help-us-check/
//   /download/   the release zip + SHA256SUMS.txt (when a zip is given)
//   _headers     Cloudflare Pages security headers (app CSP mirrors the file's + frame-ancestors)
// Usage: node site/build-site.mjs [path/to/rootnote-<version>.zip]
// Nothing here runs scripts except /app/, and nothing loads from another site.
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
// Markdown renderer and Guide sources are shared with the release (offline guide.html): scripts/guide.mjs.
const { esc, markdown, GUIDE, GUIDE_IMAGES, topics: guideTopics, topicSource } = await import(new URL('../scripts/guide.mjs', import.meta.url));

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const repo = here('../');
const out = here('out/');
const { APP_VERSION } = await import(new URL('../src/app/version.js', import.meta.url));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');


const SITE_URL = 'https://rootnote.unravelnetworks.com';
const NAV = [['/', 'Rootnote'], ['/guide/', 'Guide'], ['/privacy/', 'Privacy'], ['/licence/', 'Licence'], ['/security/', 'Security']];
const DESCRIPTION = 'Rootnote turns pentest screenshots and notes into an editable Word report. Free and open source, one HTML file, works offline.';
// Static JSON-LD is a data block, not script: the site CSP needs no script-src for it.
// '<' is escaped so no value can close the element.
const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replaceAll('<', '\\u003c')}</script>`;
const indexed = []; // canonical pages for sitemap.xml
// nav: the NAV entry to mark current; url: this page's own path (canonical), or null for the 404 page.
function page(nav, title, body, { wide = false, url = nav, description = DESCRIPTION, head = '' } = {}) {
  const path = nav;
  if (url) indexed.push(url);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${url ? `<link rel="canonical" href="${SITE_URL}${url}">` : '<meta name="robots" content="noindex">'}
<link rel="stylesheet" href="/assets/site.css">
<link rel="icon" href="/assets/favicon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="/assets/favicon-48.png" type="image/png" sizes="48x48">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Rootnote by Unravel Networks">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${url ? `<meta property="og:url" content="${SITE_URL}${url}">
` : ''}<meta property="og:image" content="${SITE_URL}/assets/social-share.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@UnravelNetworks">${head}
<meta name="theme-color" content="#0a0a0a">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="bar"><nav aria-label="Site"><a href="/" class="brand"${path === '/' ? ' aria-current="page"' : ''}><img src="/assets/emblem-64.png" width="32" height="32" alt=""><span>Rootnote <small>by Unravel Networks</small></span></a>${NAV.slice(1).map(([href, label]) => `<a href="${href}"${href === path ? ' aria-current="page"' : ''}>${label}</a>`).join('')}<a class="cta" href="/app/">Open Rootnote</a></nav></header>
<main id="main" class="${wide ? 'wide' : 'prose'}">
${body}
</main>
<footer class="foot"><a class="maker" href="https://unravelnetworks.com/"><img src="/assets/unravel-networks-logo.jpg" width="240" height="80" alt="Unravel Networks"></a><p>Rootnote is made by <a href="https://unravelnetworks.com/">Unravel Networks</a>. Free to use. Support: <a href="mailto:support@unravelnetworks.com">support@unravelnetworks.com</a> · Security: <a href="mailto:security@unravelnetworks.com">security@unravelnetworks.com</a></p><p>Version ${APP_VERSION}. This site has no on-page analytics or tracking scripts, cookies or outside scripts.</p></footer>
</body>
</html>
`;
}

const zipPath = process.argv[2];
const html = await readFile(`${repo}dist/rootnote.html`);
const appCsp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html.toString('utf8'))?.[1];
if (!appCsp) throw new Error('rootnote.html has no CSP meta tag');
const appHash = sha256(html);

await rm(out, { recursive: true, force: true });
for (const d of ['app', 'guide', 'privacy', 'licence', 'security', 'download', 'assets']) await mkdir(out + d, { recursive: true });
await writeFile(out + 'app/index.html', html);
await cp(here('site.css'), out + 'assets/site.css');
await cp(here('assets/sample-summary.png'), out + 'assets/sample-summary.png');
for (const a of ['favicon-32.png', 'favicon-48.png', 'apple-touch-icon.png', 'emblem-64.png', 'unravel-networks-logo.jpg', 'social-share.jpg']) await cp(here('assets/' + a), out + 'assets/' + a);

let zipName = null, zipHash = null;
if (zipPath) {
  const zip = await readFile(zipPath);
  zipName = basename(zipPath);
  zipHash = sha256(zip);
  await writeFile(out + 'download/' + zipName, zip);
  await writeFile(out + 'download/SHA256SUMS.txt', `${zipHash}  ${zipName}\n${appHash}  rootnote.html (the page at /app/)\n`);
} else console.warn('No release zip given: the landing page shows placeholders for the download.');

const dl = zipName
  ? `<a class="btn ghost" href="/download/${zipName}">Download (zip)</a>`
  : '<span class="btn ghost" aria-disabled="true">Download (zip): not built yet</span>';
const fp = zipHash
  ? `<p class="fp">SHA-256 of <code>${zipName}</code>: <code class="hash">${zipHash}</code><br>SHA-256 of the online page <code>/app/</code>: <code class="hash">${appHash}</code> · <a href="/guide/readme/#version-and-checking-your-copy">How to check</a></p>`
  : `<p class="fp">SHA-256 of the online page <code>/app/</code>: <code class="hash">${appHash}</code></p>`;

// Who publishes Rootnote, and what it is. sameAs lists only accounts Unravel Networks controls.
const ORG = { '@type': 'Organization', '@id': 'https://unravelnetworks.com/#organization', name: 'Unravel Networks', url: 'https://unravelnetworks.com/',
  logo: `${SITE_URL}/assets/unravel-networks-logo.jpg`, email: 'support@unravelnetworks.com',
  sameAs: ['https://github.com/unravelnetworks', 'https://www.linkedin.com/company/unravel-networks', 'https://x.com/UnravelNetworks'] };
const LANDING_LD = { '@context': 'https://schema.org', '@graph': [ORG, {
  '@type': 'SoftwareApplication', name: 'Rootnote', url: `${SITE_URL}/`, description: DESCRIPTION,
  applicationCategory: 'BusinessApplication', operatingSystem: 'Web browser', softwareVersion: APP_VERSION,
  license: 'https://www.apache.org/licenses/LICENSE-2.0', isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  publisher: { '@id': ORG['@id'] }, sameAs: ['https://github.com/unravelnetworks/rootnote'] }] };
await writeFile(out + 'index.html', page('/', 'Rootnote: screenshots and notes to an editable Word pentest report', `
<section class="hero">
  <div class="pitch">
    <p class="kicker">Free · open source · one HTML file · works offline</p>
    <h1>From screenshots and notes to an editable Word pentest report.</h1>
    <p class="lede">Paste your evidence between the steps, black out what must not leave, and export a clean .docx you finish in Word. No install, no account, no server: your findings stay on your computer.</p>
    <p class="actions"><a class="btn" href="/app/">Open Rootnote online</a> ${dl}</p>
    ${fp}
  </div>
  <figure class="proof">
    <img src="/assets/sample-summary.png" width="784" height="1123" alt="Findings summary page of a sample Word report made with Rootnote: eight findings with risk, CVSS score, status and CWE classification, and counts per risk and status.">
    <figcaption>A real page from the sample report (fictional client, synthetic evidence). In Rootnote, choose <strong>Open the sample</strong> to explore it.</figcaption>
  </figure>
</section>

<section class="grid" aria-label="What it does">
  <div><h2>Write the findings</h2><ul>
    <li>Paste screenshots (Win+Shift+S, Ctrl+V) or drop PNG/JPEG between the steps.</li>
    <li>Black out, pixelate, box, arrow and crop without leaving the app. Blacked-out pixels are gone from the saved file.</li>
    <li>Rating, CVSS 3.1 calculator, status, type, CWE, affected assets and references.</li>
    <li>12 OWASP-referenced starter findings, plus your own finding library.</li></ul></div>
  <div><h2>Get the report out</h2><ul>
    <li>Real Word styles, table of contents, numbered figures, a linked findings summary; A4 or Letter.</li>
    <li>Your sections, order and names, up to 10 of your own; score by severity, risk or CVSS.</li>
    <li>Findings as CSV for a spreadsheet or tracker.</li>
    <li>Check &amp; export lists what is still missing before you send.</li></ul></div>
  <div><h2>Keep engagements in order</h2><ul>
    <li>Point it at your Engagements folder: one folder per customer and engagement.</li>
    <li>In Chrome or Edge, saves and exports go straight back into that engagement's folder.</li>
    <li>A live page beside the editor shows how the finding will look in the report.</li></ul></div>
</section>

<section class="split">
  <div><h2>Online or offline: the same file</h2>
    <p><strong>Online</strong>, the page at <code>/app/</code> is byte-for-byte the file in the download, served alone with no analytics or outside scripts. Your report content is processed in your browser; nothing is uploaded and there is no report database. The web host records ordinary visit details (such as IP address and browser), never report content.</p>
    <p><strong>Offline</strong>, unzip the download, check its SHA-256 against this page, and open <code>rootnote.html</code>. It works with the network unplugged.</p>
    <p>Check it yourself: open your browser's developer tools, Network tab, and use the app.</p></div>
  <div><h2>Limits, honestly</h2><ul>
    <li>Per project: 20 findings, 30 screenshots (2 MiB each), 25 MiB file. These are the sizes we have tested, not a paid restriction; tell us if they get in your way.</li>
    <li>One built-in report design; your own Word template is not supported.</li>
    <li>No scanner imports, CVSS 4.0, collaboration or AI.</li>
    <li>Tested on Windows in current Chrome, Edge and Firefox. Basic use in Safari on macOS and exploring on an iPhone with Safari have been checked by hand; see the <a href="/guide/reference/#browsers">browser table</a>.</li></ul>
    <p><a href="/guide/">Read the guide</a> · <a href="/help-us-check/">Help us check what is not tested yet</a></p></div>
</section>

<section class="who"><h2>Who it's for</h2><p>Solo and freelance pentesters, and small teams, who deliver Word reports and don't want to run a reporting server or a template pipeline. Need collaboration and a shared finding database? A platform such as SysReptor, PwnDoc or Ghostwriter fits better.</p>
<p>Rootnote is free and open source under the <a href="/licence/">Apache License 2.0</a>, including for paid client work. <a href="https://github.com/unravelnetworks/rootnote">Read the source code</a>; open source means you can check it, not that it has been audited. The reports you create are yours. Built by <a href="https://unravelnetworks.com/">Unravel Networks</a>.</p></section>
`, { wide: true, head: '\n' + jsonLd(LANDING_LD) }));

const readme = markdown((await readFile(`${repo}release-template/README.md`, 'utf8'))
  .replace('Open `rootnote.html` in current', 'Open Rootnote online, or open `rootnote.html` from the download, in current'), { skipTitle: true });

// The Guide: a project documentation site.
const GUIDE_DESCRIPTIONS = {
  '': 'The Rootnote guide: how to write pentest findings, add and black out screenshots, design the report and export an editable Word document.',
  'start-here': 'Start here: open the sample, make a new pentest report in Rootnote, save the project file and export it to Word.',
  findings: 'Write pentest findings in Rootnote: rating, CVSS 3.1 Base score, CWE, affected assets, references, and reusable finding text.',
  screenshots: 'Add screenshots to Rootnote findings by pasting or dropping them, caption them, black out secrets and handle tall captures.',
  'report-design': 'Design the Rootnote report: title, client and cover, logos, how findings are rated, and which sections appear in what order.',
  files: 'Rootnote project files: saving, one folder per engagement, cloud folders, recovery drafts, and what to do if a file will not open.',
  export: 'Export a Rootnote report to Word, CSV or print/PDF, and solve common export and opening problems.',
  reference: 'Rootnote reference: project limits, tested browsers, keyboard shortcuts and how to check your download.',
  glossary: 'Glossary of the terms used in Rootnote and its pentest reports.',
  readme: 'The full Rootnote README as one page: what it does, how to run it online or offline, privacy, and how to check your copy.',
};
const topics = guideTopics().map((t) => ({ ...t, ready: true }));
const href = (t) => `/guide/${t.slug ? t.slug + '/' : ''}`;
// The README page stays reachable by link but is not a chapter in the menu.
const inMenu = (t) => t.slug !== 'readme';
const guideNav = (cur) => GUIDE.map((g) => `<p class="docs-group">${g.group}</p><ul>${topics.filter((t) => t.group === g.group && inMenu(t)).map((t) =>
  t.ready ? `<li><a href="${href(t)}"${t === cur ? ' aria-current="page"' : ''}>${esc(t.title)}</a></li>` : `<li><span class="planned">${esc(t.title)} <small>(planned)</small></span></li>`).join('')}</ul>`).join('');
const ready = topics.filter((t) => t.ready);
for (const t of ready) {
  let md;
  if (t.slug === 'readme') md = { html: readme.html, toc: readme.toc };
  else md = markdown(await topicSource(t, { version: APP_VERSION, image: (f) => `/assets/guide/${f}` }), { skipTitle: true });
  const pages = ready.filter(inMenu), k = pages.indexOf(t), prev = k < 0 ? null : pages[k - 1], next = k < 0 ? null : pages[k + 1];
  const body = `<div class="docs">
<nav class="docs-nav" aria-label="Guide"><p class="docs-title"><a href="/guide/">Rootnote Guide</a></p><p class="docs-ver">For version ${APP_VERSION}</p>${guideNav(t)}</nav>
<details class="docs-nav-mobile"><summary>Guide contents</summary><nav aria-label="Guide contents">${guideNav(t)}</nav></details>
<article class="docs-main">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/guide/">Guide</a>${t.slug ? ` › ${t.group} › <span aria-current="page">${esc(t.title)}</span>` : ''}</nav>
<h1>${esc(t.title === 'Guide overview' ? 'Rootnote guide' : t.title)}</h1>
${t.slug === 'readme' ? '<p>The README that ships in the download, as one page. The guide pages explain the same things step by step.</p>' : ''}
${md.html}
<nav class="pager" aria-label="Previous and next">${prev ? `<a class="prev" href="${href(prev)}"><small>Previous</small>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="next" href="${href(next)}"><small>Next</small>${esc(next.title)}</a>` : ''}</nav>
</article>
${md.toc.length ? `<aside class="docs-toc"><nav aria-label="On this page"><p>On this page</p><ul>${md.toc.map(([id, h]) => `<li><a href="#${id}">${esc(h)}</a></li>`).join('')}</ul></nav></aside>` : ''}
</div>`;
  if (t.slug) await mkdir(out + `guide/${t.slug}`, { recursive: true });
  await writeFile(out + `guide/${t.slug ? t.slug + '/' : ''}index.html`, page('/guide/', t.slug ? `${t.title} · Rootnote Guide` : 'Rootnote Guide', body, { wide: true, url: href(t), description: GUIDE_DESCRIPTIONS[t.slug] }));
}
// Every link inside the Guide must reach an existing page and, with a #fragment, an existing id.
{
  const pages = new Map();
  for (const t of ready) pages.set(href(t), await readFile(out + `guide/${t.slug ? t.slug + '/' : ''}index.html`, 'utf8'));
  const ids = (h) => new Set([...h.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  const bad = [];
  for (const [from, html] of pages) {
    for (const [, link] of html.matchAll(/<a\s[^>]*?href="([^"]+)"/g)) { // href in any attribute position
      if (/^(https?:|mailto:)/.test(link)) continue;
      const url = new URL(link, 'https://x' + from);
      const [path, frag] = [url.pathname, url.hash.slice(1)];
      if (!path.startsWith('/guide/')) continue;
      const target = pages.get(path);
      if (!target) bad.push(`${from} -> ${link} (no page)`);
      else if (frag && !ids(target).has(frag)) bad.push(`${from} -> ${link} (no #${frag})`);
    }
  }
  if (bad.length) throw new Error(`Guide has broken links:\n${bad.join('\n')}`);
}
await mkdir(out + 'assets/guide', { recursive: true });
for (const file of Object.values(GUIDE_IMAGES)) await cp(`${repo}docs/guide/images/${file}`, out + `assets/guide/${file}`);

await writeFile(out + 'privacy/index.html', page('/privacy/', 'Rootnote privacy', `
<h1>Privacy</h1>
<p><strong>Short version:</strong> Rootnote does not collect your report content, and neither does this site.</p>
<h2>The app</h2>
<ul>
<li>Rootnote runs in your browser. Your findings, screenshots and project files are processed on your device and saved only where you choose.</li>
<li>Report content is processed locally, with no report-upload service or app telemetry. The app's Content Security Policy restricts resource loading. It has no analytics, account or licence check.</li>
<li>Opening the online guide or another external link is an ordinary network visit; the host processes visit metadata.</li>
<li>Optional recovery drafts are off by default. When you turn them on, a copy of the open project is kept in this browser's storage on your device, unencrypted, until you turn them off or discard it. See <a href="/guide/readme/#privacy-what-stays-on-your-device">Privacy in the help</a>.</li>
</ul>
<h2>This website</h2>
<ul>
<li>No on-page analytics or tracking scripts, cookies, advertising or outside scripts.</li>
<li>We use Google Search Console to understand how our public pages appear in Google Search, including search impressions and clicks. It uses no tracking code on these pages and receives no report content from Rootnote.</li>
<li>Our web host (Cloudflare) processes ordinary request details, such as IP address, browser and the pages requested, to deliver the site and protect it from abuse. Report content never reaches it.</li>
</ul>
<h2>Email</h2>
<p>If you write to support@ or security@unravelnetworks.com, we use your message only to answer it. Never send client data; use a synthetic example.</p>
<h2>Contact</h2>
<p>Unravel Networks, <a href="mailto:support@unravelnetworks.com">support@unravelnetworks.com</a>.</p>`, { description: 'How Rootnote handles data: the app processes reports locally without uploading them. Website hosting, recovery drafts, email and privacy details.' }));

const notices = await readFile(`${repo}release-template/THIRD-PARTY-NOTICES.md`, 'utf8');
await writeFile(out + 'licence/index.html', page('/licence/', 'Rootnote licence', `
<h1>Licence</h1>
<p>Rootnote is open source under the Apache License 2.0. The source code is at <a href="https://github.com/unravelnetworks/rootnote">github.com/unravelnetworks/rootnote</a>. Third-party components keep their own licences, listed under About &amp; licences in the app and in the download.</p>
<pre class="legal">${esc(await readFile(`${repo}NOTICE`, 'utf8'))}</pre>
<pre class="legal">${esc(await readFile(`${repo}LICENSE`, 'utf8'))}</pre>
<h2 id="third-party">Third-party software notices</h2>
<pre class="legal">${esc(notices)}</pre>`, { description: 'Rootnote is open source under the Apache License 2.0. Full licence text and third-party software notices.' }));

// Help us check: what is not tested yet, and where to send results.
await mkdir(out + 'help-us-check', { recursive: true });
await writeFile(out + 'help-us-check/index.html', page('/help-us-check/', 'Help us check Rootnote', markdown(await readFile(new URL('./help-us-check.md', import.meta.url), 'utf8')).html, { description: 'Help check Rootnote on setups we have not tested yet, such as Word for Mac, LibreOffice and Safari PDF, using only made-up data.' }));
await writeFile(out + 'security/index.html', page('/security/', 'Rootnote security policy', markdown(await readFile(`${repo}SECURITY.md`, 'utf8')).html, { description: 'How to report a security issue in Rootnote privately, and what to expect after you report it.' }));
await writeFile(out + '404.html', page('', 'Not found', '<h1>Page not found</h1><p><a href="/">Back to Rootnote</a></p>', { url: null }));

// Crawlers: the canonical pages above, and a robots.txt that points to them. Cloudflare may
// prepend its own managed text to this file; the directives below still apply.
await writeFile(out + 'sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexed.map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`).join('\n')}
</urlset>
`);
await writeFile(out + 'robots.txt', `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`);

// Cloudflare Pages joins repeated headers with commas, so a path matching several rules gets
// several policies, all enforced. /* therefore carries only the baseline (no fetch directives);
// the strict site policy is set per path and never on /app/, which gets its own mirrored policy.
const common = [
  'X-Content-Type-Options: nosniff',
  'Referrer-Policy: no-referrer',
  'Permissions-Policy: camera=(), microphone=(), geolocation=(), usb=(), serial=(), bluetooth=(), payment=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy: same-origin',
  'Cross-Origin-Resource-Policy: same-origin',
  'Strict-Transport-Security: max-age=31536000',
  'X-Frame-Options: DENY',
];
const siteCsp = "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
// Every response, including unknown paths, aliases such as /app or /index.html and the 404
// page, gets a baseline policy with no fetch directives, so it never conflicts with the
// app's own policy when both are joined on /app/ (two policies: both are enforced).
const baselineCsp = "base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";
const block = (path, lines) => `${path}\n${lines.map((l) => `  ${l}`).join('\n')}\n`;
// The Guide moved from /help/ to /guide/; old links, the 0.1.2 app's menu link and
// the 0.1.2 offline guide's online links keep working through permanent redirects.
await writeFile(out + '_redirects', ['/help /guide/ 301', '/help/* /guide/:splat 301', ''].join('\n'));
await writeFile(out + '_headers', [
  block('/*', [...common, `Content-Security-Policy: ${baselineCsp}`]),
  ...['/', '/index.html', '/guide/*', '/help/*', '/privacy/*', '/licence/*', '/security/*', '/help-us-check/*', '/download/*', '/assets/*', '/404.html', '/site-manifest.json'].map((p) => block(p, [`Content-Security-Policy: ${siteCsp}`])),
  block('/app/*', [`Content-Security-Policy: ${appCsp}; frame-ancestors 'none'`, 'Cache-Control: no-cache']),
  block('/download/*', ['Cache-Control: no-cache']),
].join('\n'));

await writeFile(out + 'site-manifest.json', JSON.stringify({ version: APP_VERSION, app: { path: '/app/', sha256: appHash }, zip: zipName && { path: `/download/${zipName}`, sha256: zipHash } }, null, 2) + '\n');
console.log(`site/out built: app sha256 ${appHash}${zipHash ? `, ${zipName} sha256 ${zipHash}` : ''}`);
