# Word (DOCX) export

`exportDocx(project, { paperSize })` (`index.js`) returns a `Promise<Uint8Array>` holding the `.docx` file. Paper size is `A4` or `Letter` and defaults to `project.project.paperSize`. The exporter never writes files and makes no network requests; the editor decides whether to save or download the bytes and shows any error.

## Before calling it

Call it only with a project that has passed the shared validator for its schema version (`src/app/project.js`) and whose images have been decoded by the browser. The exporter checks its input defensively, but it does not replace the full import checks (image hashes, real decodability, the project size budget, monotonic counters). Missing evidence or invalid data makes it reject; it never drops an image silently. A project in the over-budget recovery state must not be exported.

## How it is built

- **`plan.js`** builds a pure report plan with `createReportPlan(project, { paperSize })`: page geometry in CSS px at 96 dpi, labels and metadata, cover and running logos, the ordered report sections, the findings summary, and each finding's key facts, sections and evidence. The editor's paged preview (`src/editor/preview.js`) renders the same plan, so the preview and the Word file share their content and image geometry. CVSS 3.1 and 4.0 Base scores come from `src/scoring/`; each displayed score names its version.
- **`v2.js`** turns the plan into Word with the `docx` library. Despite its name it handles every current schema version; older files reach it through migration in the app. The original schema v1 path in `index.js` is kept for the frozen v1 fixtures.
- **`design.js`** holds the shared design tokens and the severity and CVSS badge colours.

## What the Word file contains

- Real Word styles: Title, Heading 1 and 2, Body, Code and Caption. Code text is kept exactly (leading hyphens, spaces and tabs included). Empty optional sections are left out.
- A findings summary with links to each finding through stable bookmarks (independent of the visible, order-derived finding IDs). Turning the summary off also removes the links back to it.
- Figure captions numbered with `SEQ Figure` fields that carry cached values; there is no forced update-fields-on-open setting. The footer uses `PAGE` and `SECTIONPAGES`. After editing figures in Word, the fields may need updating.
- A cover page in its own section with an empty header and footer; body page numbers start at 1 after it. Without a cover, the first report section starts on a new page after the title block.
- Each finding starts on a new page. Short text sections (an estimated six lines or fewer) are kept together; this is a bounded estimate, not a guarantee of Word's line count.

## Screenshots

- **Fit** embeds the original image bytes, scaled to the page.
- **Split** (automatic when a screenshot is taller than a page) crops contiguous rows of source pixels into lossless PNG parts in the browser with canvas. The parts share one figure number and repeat the cached number in a continuation field. Split rows are balanced so the last part is not a thin sliver. Node has no canvas, so split export rejects there.
- In the plan, image part crop coordinates (`y`, `sourceWidth`, `sourceHeight`) are source pixels, while `width` and `height` are displayed pixels; do not mix the units.
- The exporter performs no redaction. Black out happens in the editor before export.

## Known limits

- The preview's text pagination is approximate; Word's fonts, wrapping and page assignment decide the real layout. Logos in the running header or footer leave less room per page and can produce more split parts.
- `docx` creates duplicate `wp:docPr` ids; the exporter renumbers them uniquely across the document, headers and footers. No user-supplied XML or template is ever evaluated.
- Custom Word templates are not supported.

## Tests

The exporter's tests are in `tests/fixtures/` and run with the rest of the suite (`npm test`). Synthetic fixtures are described in `tests/fixtures/README.md`; schema v2 fixtures are regenerated with `node tests/fixtures/generate-v2.mjs`, and frozen v1 fixture bytes are never replaced.

Dependencies: `docx` 9.5.1 and `jszip` 3.10.1 (MIT option); the app bundles `buffer` 6.0.3 for `docx`. Their notices are in `release-template/THIRD-PARTY-NOTICES.md`.
