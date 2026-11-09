// Bundles src/app/main.js and inlines it with the stylesheet into one HTML file, twice:
// dist/rootnote.html.
// The output must make zero network requests; the CSP below restricts the page to itself.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
// The header emblem is inlined as a data URL (img-src allows data:), so the page still loads nothing.
const emblem = (await readFile(new URL('src/app/emblem-64.png', root))).toString('base64');
const style = (await readFile(new URL('src/app/style.css', root), 'utf8')).replace('__EMBLEM__', () => `"data:image/png;base64,${emblem}"`);
const template = await readFile(new URL('src/app/index.html', root), 'utf8');
// The reviewed third-party notices are embedded as escaped text, so a user who keeps
// only the HTML file still has them.
const notices = await readFile(new URL('release-template/THIRD-PARTY-NOTICES.md', root), 'utf8');
// About & licences shows the NOTICE, then the Apache-2.0 licence (section 4(d)).
const licence = `${await readFile(new URL('NOTICE', root), 'utf8')}\n---\n\n${await readFile(new URL('LICENSE', root), 'utf8')}`;
// The sample project is embedded too, so "Open the sample" works online without the download.
const sampleProject = await readFile(new URL('release-template/sample-project.rootnote.json', root), 'utf8');
const escapeHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
await mkdir(new URL('dist/', root), { recursive: true });

// One build.
for (const file of ['rootnote.html']) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('src/app/main.js', root))],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    legalComments: 'eof',
    metafile: true,
    write: false,
  });

  // A literal "</script" inside the bundle would end the inline script early.
  const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const scriptHash = createHash('sha256').update(script).digest('base64');
  // The stylesheet is pinned by hash too: no injected <style> or
  // style attribute applies. Element styles are set through the style object (dom.js h()).
  // Browsers turn CRLF into LF before hashing, so a CRLF stylesheet would be blocked by its own CSP.
  if (style.includes('\r')) throw new Error('src/app/style.css has CRLF line endings; save it with LF');
  const styleHash = createHash('sha256').update(style).digest('base64');
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${scriptHash}'`,
    `style-src 'sha256-${styleHash}'`,
    'img-src data: blob:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  // npm packages esbuild saw in the bundle. Pre-bundled dist files (docx, jszip) hide
  // their own dependencies; the reviewed notices cover those too. Every package seen
  // must have a section.
  const packages = [...new Set(Object.keys(result.metafile.inputs)
    .map((p) => /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(p.replace(/\\/g, '/'))?.[1])
    .filter(Boolean))].sort();
  const missing = packages.filter((name) => !notices.includes(`\n## ${name} `));
  if (missing.length) throw new Error(`THIRD-PARTY-NOTICES.md has no section for bundled package(s): ${missing.join(', ')}`);

  // Function replacers so "$" sequences in the bundle are not treated as patterns.
  const html = template
    .replace('__CSP__', () => csp)
    .replace('__STYLE__', () => style)
    .replace('__LICENSE__', () => escapeHtml(licence))
    .replace('__NOTICES__', () => escapeHtml(notices))
    .replace('__SAMPLE__', () => escapeHtml(sampleProject))
    .replace('__SCRIPT__', () => script);

  await writeFile(new URL('dist/bundled-packages.json', root), JSON.stringify(packages, null, 2) + '\n');
  await writeFile(new URL(`dist/${file}`, root), html);
  console.log(`dist/${file} ${html.length} bytes, sha256 ${createHash('sha256').update(html).digest('hex')}`);
}
