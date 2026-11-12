# Architecture

Rootnote is one HTML file. The editor and report-generation code are bundled into `dist/rootnote.html` by `scripts/build.mjs`; the app loads nothing from the network while you work. The website and the Guide have separate build tooling.

## Pieces

- **Project model and validation** (`src/app/project.js`): the project file format, migrations from older schema versions, the limits, and the full validator that every opened file must pass before it replaces the current work. Images are checked by hash and by a real browser decode.
- **Editor** (`src/editor/`): the user interface. It edits the project in memory, and normal edits are constrained to the current file-format limits. Saving can still fail because of browser, permission, storage or disk problems; migrated projects over the size budget use the documented recovery state.
- **Report plan** (`src/export-docx/plan.js`): a pure function from a validated project to a report plan (sections, findings, figures, page geometry). Both the Word export and the on-screen preview render this one plan.
- **Word export** (`src/export-docx/`): turns the plan into a `.docx` with the `docx` library. See `src/export-docx/README.md`.
- **Scoring** (`src/scoring/`): CVSS 3.1 Base calculation, CVSS 4.0 Base calculation (`cvss40.js`, a port of the FIRST reference calculator, checked against it on every Base vector) and status labels.
- **Guide** (`docs/guide/`, rendered by `scripts/guide.mjs`): one Markdown source for the online Guide and the offline `guide.html` in the download.
- **Website** (`site/`): builds the static site for rootnote.unravelnetworks.com, including its security headers and redirects. `site/serve-headers.mjs` serves the build locally with those headers and redirects; it is a stand-in, so the live site is still checked after each deployment.

## Project file format

A project is one JSON file (`*.rootnote.json`) with every screenshot embedded. Each schema version has a frozen JSON schema in `schema/`. Rules:

- A published schema file is never edited. A format change needs a new schema version, a migration from the previous one and tests.
- The app opens every older version by migrating it in memory, and saves the current version.
- The current version's limits (findings, screenshots, image size, project size, text lengths) are enforced on every change, not only when a file is opened.

## Security model

- The page's Content Security Policy allows only its own bundled script and style and local image data. Report content is processed locally: there is no report-upload service and no telemetry.
- Opened files are untrusted: they are fully validated, size-bounded and never executed. Image metadata is stripped on import and again on export.
- The optional recovery draft lives only in this browser (IndexedDB), is off by default and is not encrypted.

## Releases

1. Build and test: `npm run build`, `npm test`.
2. `npm run release` writes `release/rootnote-<version>.zip` with the app, README, offline guide, licence, notices and `SHA256SUMS.txt`.
3. `npm run site -- release/rootnote-<version>.zip` builds `site/out/`; the site is deployed as static files.
4. The app and zip SHA-256 values go into `.github/published-sha256.txt`; the daily workflow (`.github/workflows/monitor.yml`) checks the live site against them with `.github/check-live.sh`.
