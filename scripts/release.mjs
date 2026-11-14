// Builds the release folder and a reproducible ZIP:
//   release/rootnote-<version>/  rootnote.html, README.md, guide.html, LICENSE, THIRD-PARTY-NOTICES.txt
//                                 (the reviewed notices, also embedded in rootnote.html),
//                                 sample-project.rootnote.json, sample-report.docx (CVSS 3.1),
//                                 sample-project-cvss40.rootnote.json, sample-report-cvss40.docx,
//                                 starters/*.rootnote.json (neutral starter projects),
//                                 VERSION.txt, SHA256SUMS.txt
//   release/rootnote-<version>.zip
// Timestamps come from the last git commit, so the same commit gives the same ZIP bytes.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { APP_VERSION } from '../src/app/version.js';
import { offlineGuide } from './guide.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const at = (p) => `${root}${p}`;
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

if (git('status', '--porcelain', '--untracked-files=no')) {
  console.error('Refusing to release: tracked files have uncommitted changes.');
  process.exit(1);
}
const commit = git('rev-parse', 'HEAD');
const commitDate = new Date(Number(git('log', '-1', '--format=%ct')) * 1000);

// The test-only budget setting builds into dist-test/ and would leave an old dist/ in place.
if (process.env.TEST_BUDGET_BYTES) throw new Error('TEST_BUDGET_BYTES is set: unset it to build a release.');
const { TEST_BUDGET_BYTES: _unset, ...buildEnv } = process.env;
execFileSync(process.execPath, [at('scripts/build.mjs')], { cwd: root, stdio: 'inherit', env: buildEnv });

// The showcase sample (fictional client, real-looking logos and synthetic screenshots),
// never a test fixture. Its Word files are
// exported by the app in a browser, because split screenshots need canvas, and committed;
// only their timestamps are normalised here.
const sample = {
  project: await readFile(at('release-template/sample-project.rootnote.json')),
  docx: await normalizeDocx(await readFile(at('release-template/sample-report.docx')), commitDate),
  project40: await readFile(at('release-template/sample-project-cvss40.rootnote.json')),
  docx40: await normalizeDocx(await readFile(at('release-template/sample-report-cvss40.docx')), commitDate),
};

for (const { name, html } of [{ name: `rootnote-${APP_VERSION}`, html: 'rootnote.html' }]) {
  const dir = at(`release/${name}/`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir + 'starters/', { recursive: true });

  const files = new Map();
  files.set(html, await readFile(at(`dist/${html}`)));
  files.set('README.md', await readFile(at('release-template/README.md')));
  // The Guide as one offline page, from the same source as the online Guide (docs/guide/).
  files.set('guide.html', Buffer.from(await offlineGuide({ version: APP_VERSION, commit })));
  files.set('LICENSE', await readFile(at('LICENSE')));
  files.set('NOTICE', await readFile(at('NOTICE')));
  files.set('THIRD-PARTY-NOTICES.txt', await readFile(at('release-template/THIRD-PARTY-NOTICES.md')));
  files.set('sample-project.rootnote.json', sample.project);
  files.set('sample-report.docx', sample.docx);
  files.set('sample-project-cvss40.rootnote.json', sample.project40);
  files.set('sample-report-cvss40.docx', sample.docx40);
  for (const name of ['web-application-test', 'api-test']) files.set(`starters/${name}.rootnote.json`, await readFile(at(`release-template/starters/${name}.rootnote.json`)));
  files.set('VERSION.txt', Buffer.from([
    `version: ${APP_VERSION}`,
    `commit: ${commit}`,
    `commit date: ${commitDate.toISOString()}`,
    `${html} sha256: ${sha256(files.get(html))}`,
    '',
  ].join('\n')));
  files.set('SHA256SUMS.txt', Buffer.from([...files].map(([n, b]) => `${sha256(b)}  ${n}`).join('\n') + '\n'));

  const zip = new JSZip();
  for (const n of [...files.keys()].sort()) {
    await writeFile(dir + n, files.get(n));
    zip.file(`${name}/${n}`, files.get(n), { date: commitDate, createFolders: false });
  }
  const zipBytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'UNIX' });
  await writeFile(at(`release/${name}.zip`), zipBytes);
  console.log(`release/${name}.zip ${zipBytes.length} bytes sha256 ${sha256(zipBytes)}`);
}

/** Rewrites a DOCX with fixed entry dates and core-properties timestamps. */
async function normalizeDocx(bytes, date) {
  const src = await JSZip.loadAsync(bytes);
  const out = new JSZip();
  const iso = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  for (const n of Object.keys(src.files).sort()) {
    const entry = src.files[n];
    if (entry.dir) continue;
    let data = await entry.async('uint8array');
    if (n === 'docProps/core.xml') {
      data = (await entry.async('string')).replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*(<)/g, `$1${iso}$2`);
    }
    out.file(n, data, { date, createFolders: false });
  }
  return out.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}

