// The Rootnote Guide: one Markdown source (docs/guide/*.md) for the online Guide pages
// (built by the website generator) and the offline guide.html shipped in the release zip.
// Markdown subset: headings, paragraphs, lists (two levels), fenced code, tables, images on their
// own line, "> **Note:**" / "> **Warning:**" boxes, **bold**, *italic*, `code`, [links](url).
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
export const GUIDE_SITE = 'https://rootnote.unravelnetworks.com';

export const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const slug = (t) => t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Links: http(s), mailto, or relative (no scheme), so javascript: and similar never become links.
export function inline(t, link = (h) => h) {
  return esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+|mailto:[^)\s]+|[^)\s:]+)\)/g, (_, text, href) => `<a href="${link(href)}">${text}</a>`);
}

export function markdown(md, { skipTitle = false, link, image = (src) => src, idPrefix = '' } = {}) {
  const lines = md.replace(/\r/g, '').split('\n');
  const html = [], toc = [];
  const il = (t) => inline(t, link);
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (l.startsWith('```')) {
      const code = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      i++;
      html.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,3}) (.*)/.exec(l);
    if (h) {
      i++;
      if (h[1].length === 1 && skipTitle) continue;
      const id = idPrefix + slug(h[2]);
      if (h[1].length === 2) toc.push([id, h[2]]);
      html.push(`<h${h[1].length} id="${id}">${il(h[2])}</h${h[1].length}>`);
      continue;
    }
    const img = /^!\[([^\]]*)\]\(([^)\s]+)\)(?:\{(\d+)\})?$/.exec(l.trim());
    if (img) {
      i++;
      html.push(`<figure class="shot"><img src="${esc(image(img[2]))}" alt="${esc(img[1])}"${img[3] ? ` width="${img[3]}"` : ''}></figure>`);
      continue;
    }
    if (l.startsWith('> ')) {
      const quote = [];
      for (; i < lines.length && lines[i].startsWith('> '); i++) quote.push(lines[i].slice(2).trim());
      const kind = /^\*\*(Note|Warning):\*\*/.exec(quote[0]);
      html.push(`<aside class="callout ${kind ? kind[1].toLowerCase() : 'note'}"><p>${il(quote.join(' '))}</p></aside>`);
      continue;
    }
    if (l.startsWith('|')) {
      const rows = [];
      for (; i < lines.length && lines[i].startsWith('|'); i++) rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
      const [head, , ...body] = rows;
      html.push(`<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${il(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${il(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const li = /^(\d+\.|-) (.*)/.exec(l);
    if (li) {
      const tag = li[1] === '-' ? 'ul' : 'ol';
      const items = [];
      for (; i < lines.length; i++) {
        const top = /^(\d+\.|-) (.*)/.exec(lines[i]);
        const sub = /^\s{2,}- (.*)/.exec(lines[i]);
        if (top) items.push({ text: top[2], sub: [] });
        else if (sub && items.length) items.at(-1).sub.push(sub[1]);
        else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) items.at(-1).text += ' ' + lines[i].trim();
        else break;
      }
      html.push(`<${tag}>${items.map((it) => `<li>${il(it.text)}${it.sub.length ? `<ul>${it.sub.map((s) => `<li>${il(s)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</${tag}>`);
      continue;
    }
    const para = [];
    for (; i < lines.length && lines[i].trim() && !/^(#{1,3} |```|\||(\d+\.|-) |> |!\[)/.test(lines[i]); i++) para.push(lines[i].trim());
    html.push(`<p>${il(para.join(' '))}</p>`);
  }
  return { html: html.join('\n'), toc };
}

// Groups and topics: [slug, title, file]. 'readme' is the shipped README rendered as one page.
export const GUIDE = [
  { group: 'Start', items: [['', 'Guide overview', '00-index.md'], ['start-here', 'Start here: make and keep a report', '01-start-here.md']] },
  { group: 'Tasks', items: [['findings', 'Write findings and reuse text', '02-findings.md'], ['screenshots', 'Add and edit screenshots', '03-screenshots.md'], ['report-design', 'Design the report', '04-report-design.md'], ['files', 'Files, folders and recovery', '05-files.md'], ['export', 'Export and solve problems', '06-export.md']] },
  { group: 'Reference', items: [['reference', 'Limits, browsers and keys', '07-reference.md'], ['glossary', 'Glossary', '08-glossary.md'], ['readme', 'Full README', null]] },
];
// Screenshots: token __IMG_NAME__ -> images/name.png.
export const GUIDE_IMAGES = Object.fromEntries(['start', 'start-sample', 'nav', 'title', 'save', 'open', 'preview', 'export', 'new-report',
  'facts', 'blocks', 'library', 'screenshot-card', 'redact', 'logos', 'sections', 'section-list', 'recovery', 'checks']
  .map((n) => [`__IMG_${n.toUpperCase().replaceAll('-', '_')}__`, `${n}.png`]));
export const topics = () => GUIDE.flatMap((g) => g.items.map(([slug, title, file]) => ({ group: g.group, slug, title, file })));

/** The Markdown of one topic with __VERSION__ and image tokens resolved; throws on any token left. */
export async function topicSource(t, { version, image }) {
  if (t.slug === 'readme') return (await readFile(new URL('release-template/README.md', root), 'utf8'));
  let src = (await readFile(new URL(`docs/guide/${t.file}`, root), 'utf8')).replaceAll('__VERSION__', version);
  // Screenshots are captured at twice the screen size: show them at their on-screen width.
  for (const [token, file] of Object.entries(GUIDE_IMAGES)) {
    if (!src.includes(token)) continue;
    const png = await readFile(new URL(`docs/guide/images/${file}`, root));
    src = src.replaceAll(`(${token})`, `(${image(file)}){${Math.round(png.readUInt32BE(16) / 2)}}`);
  }
  const left = /__[A-Z_]+__/.exec(src);
  if (left) throw new Error(`docs/guide/${t.file}: unresolved token ${left[0]}`);
  return src;
}

/** guide.html for the release zip: every topic in one page, script-free, images embedded,
 * links between topics turned into in-page anchors, other site pages as labelled online links. */
export async function offlineGuide({ version, commit }) {
  const all = topics();
  const sectionId = (s) => `topic-${s || 'overview'}`;
  const images = {};
  for (const file of Object.values(GUIDE_IMAGES)) images[file] = `data:image/png;base64,${(await readFile(new URL(`docs/guide/images/${file}`, root))).toString('base64')}`;
  const parts = [];
  for (const t of all) {
    const prefix = `${t.slug || 'overview'}--`;
    const from = `/guide/${t.slug ? t.slug + '/' : ''}`;
    const link = (h) => {
      if (/^(https?:|mailto:)/.test(h)) return h;
      if (h.startsWith('#')) return `#${prefix}${h.slice(1)}`;
      const url = new URL(h, GUIDE_SITE + from);
      const m = /^\/guide\/([^/]*)\/?$/.exec(url.pathname);
      if (m) return url.hash ? `#${m[1] || 'overview'}--${url.hash.slice(1)}` : `#${sectionId(m[1])}`;
      return GUIDE_SITE + url.pathname + url.hash; // another site page: online only
    };
    const src = await topicSource(t, { version, image: (f) => images[f] });
    const md = markdown(src, { skipTitle: true, link, image: (s) => s, idPrefix: prefix });
    parts.push(`<section id="${sectionId(t.slug)}"><h1>${esc(t.title === 'Guide overview' ? 'Rootnote guide' : t.title)}</h1>\n${md.html}</section>`);
  }
  const contents = GUIDE.map((g) => `<li>${g.group}<ul>${all.filter((t) => t.group === g.group).map((t) => `<li><a href="#${sectionId(t.slug)}">${esc(t.title)}</a></li>`).join('')}</ul></li>`).join('');
  const style = `body{margin:0;background:#f4f4f4;color:#111;font:16px/1.6 "Segoe UI",system-ui,-apple-system,Arial,sans-serif}
main{max-width:820px;margin:0 auto;padding:24px 16px 64px}
header.banner{background:#0a0a0a;color:#e8e8e8;border-bottom:2px solid #e1061a;padding:14px 16px}
header.banner p{max-width:820px;margin:0 auto}
a{color:#b00414;text-underline-offset:2px}
a:focus-visible{outline:3px solid #e1061a;outline-offset:2px}
h1{font-size:1.9rem;line-height:1.2;margin:2.2em 0 .4em;padding-top:.6em;border-top:2px solid #dcdcdc}
section:first-of-type h1{border-top:0;margin-top:.6em}
h2{font-size:1.25rem;margin:1.6em 0 .4em}
code,pre{font-family:Consolas,"SF Mono",Menlo,monospace;font-size:.9em}
code{background:#ececec;padding:.05em .3em;border-radius:3px}
pre{background:#ececec;padding:12px 14px;border-radius:6px;overflow-x:auto}
pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;margin:1em 0}.table-wrap{overflow-x:auto}main{overflow-wrap:break-word}main a,main code{overflow-wrap:anywhere}
th,td{border:1px solid #dcdcdc;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#ececec}
.callout{border:1px solid #dcdcdc;border-left:4px solid #4a4a4a;background:#fff;border-radius:6px;padding:10px 14px;margin:1em 0}
.callout.warning{border-left-color:#e1061a}
.callout p{margin:0}
.shot img{max-width:100%;height:auto;border:1px solid #dcdcdc;border-radius:6px}
nav.contents{background:#fff;border:1px solid #dcdcdc;border-radius:6px;padding:12px 18px}
@media (prefers-color-scheme:dark){body{background:#0a0a0a;color:#e8e8e8}a{color:#e8e8e8}code,pre,th{background:#1c1c1c}th,td,h1,.callout,nav.contents,.shot img{border-color:#2a2a2a}.callout,nav.contents{background:#151515}}`;
  const styleHash = createHash('sha256').update(style).digest('base64');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-${styleHash}'; img-src data:; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>Rootnote guide ${esc(version)}</title>
<style>${style}</style>
</head>
<body>
<header class="banner"><p><strong>Rootnote guide</strong> for version ${esc(version)} (commit ${esc(commit.slice(0, 7))}). This file works offline. Links to other pages of rootnote.unravelnetworks.com open the website.</p></header>
<main>
<nav class="contents" aria-label="Guide contents"><strong>Contents</strong><ul>${contents}</ul></nav>
${parts.join('\n')}
</main>
</body>
</html>
`;
}
