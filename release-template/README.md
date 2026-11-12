# Rootnote: offline evidence-to-Word report workbench

Turn screenshots, requests and notes into an editable Word (.docx) pentest report. It runs from one HTML file in your browser, with no install, no account and no server.

The step-by-step guide is in `guide.html` in this folder (it works offline) and online at https://rootnote.unravelnetworks.com/guide/.

## Quick start

1. Open `rootnote.html` in current **Google Chrome**, **Microsoft Edge** or **Firefox** (double-click it, or drag it into a browser window). See *Browsers* below for what differs between them.
2. Choose **New report**, or **Open a project** to continue a saved one. To see a finished report first, choose **Open the sample**: it is built into Rootnote and uses a fictional client and synthetic evidence. The same project is included as `sample-project.rootnote.json`, and `sample-report.docx` is the Word file it produces.
3. Fill in **Details & cover**. In **Sections & scoring**, choose the report sections, their order and names, add up to 10 of your own sections, and pick the scoring: severity, risk or CVSS (3.1 or 4.0 Base), alone or with CVSS.
4. Click **New finding** for each finding. Set the rating (or use the CVSS calculator), affected assets, status, vulnerability type and CWE, then write the sections.
5. In **Additional details**, write the steps and put screenshots between the text where they belong:
   - **paste** a screenshot (for example Win+Shift+S, then Ctrl+V); it goes after the text box you are in
   - **drop** PNG/JPEG files onto the finding, or use the insert buttons between blocks
   - each text block has a copy button and a **⋯** menu (move up or down, plain text or code, remove); **?** shows the formatting help
   - **Copy as text** in a finding's **⋯** menu copies the whole finding
6. Give each screenshot a caption. Use **Black out or crop…** to hide anything sensitive (see *Screenshot editing*).
7. **Save** (Ctrl+S) regularly. See *Saving and backups*.
8. Open **Check & export**, review the reminders, choose A4 or Letter, and save the Word report. **Findings as CSV** gives the findings as a spreadsheet; **Report as Markdown** gives the whole report as text; **Print or save as PDF** prints the preview.
9. Open the .docx in Word, review it, and make your final edits there.

On a window at least 1200 pixels wide, the **Live page** beside the editor shows the report page you are editing and highlights the part you are in. **Preview report** shows the whole report.

**Starting points:** `starters/` holds two empty report templates (web application test, API test) with the usual sections filled in as prompts. In **Finding library**, the **OWASP starter** tab has 12 ready-made findings for common web and API issues. Replace every `[[prompt]]` with what you observed; Check & export lists any that are left.

## Engagements: one folder per customer and engagement

If you keep your work in folders like this:

```
Engagements\
  Brightwater Logistics\
    2026-10 Customer portal\
      customer-portal.rootnote.json
      customer-portal-report.docx
```

choose **Or browse your engagement folders** on the start page (or **Engagements** in the side menu), then **Choose engagements folder…** and select the top folder. The app lists each customer and engagement with what its project holds (title, findings by rating, status) and the reports next to it.

- **Open** opens that project. In Chrome and Edge, **Save** and the Word, Markdown and CSV exports then write into the same engagement folder. If a file of that name is already there, the app asks before replacing it.
- **New engagement…** creates `Customer\Engagement\` and asks every time whether to start an empty report there or save the open report there.
- **Save open project here** saves the open project into an engagement folder.
- Chrome and Edge ask once per session whether the page may edit files in that folder. The app shows what it is doing while your browser waits for the answer.
- The folder is not remembered: choose it again each time you open the app. The Engagements view itself stores nothing in the browser (recovery drafts, if you turn them on, are separate; see *Privacy*).
- Firefox and other browsers without folder access can read the folders, but Save and exports go to your downloads; the screen says so.
- The app reads at most 50 project files or 200 MB at a time (a button reads the next batch) and never reads project files over 25 MB.

## Screenshot editing

**Black out or crop…** on a screenshot opens an editor with **Black out**, **Pixelate**, **Box**, **Arrow** and **Crop**. Drag with a mouse, pen or finger, or use the keyboard: Tab to the screenshot, move the selection with the arrow keys, resize it with Shift and the arrow keys, and press Enter to apply the tool.

- The edit replaces the screenshot in the project. Right after the edit, **Undo** can bring the original back in this tab; another change, **Dismiss**, opening another project or saving ends that offer. Once saved, the project file holds only the edited image, so blacked-out pixels are gone from it.
- An edited screenshot must still fit the 2 MB limit. A JPEG is saved at lower quality if needed; if it still does not fit, the editor stays open so you can crop it smaller.
- **Cancel** or Escape asks once before throwing away your edits.
- **Use Black out for passwords, tokens and personal data.** Pixelated text can sometimes be read back.
- Check the edited screenshot before sending the report. Anything you do not cover stays visible.

## Privacy: what stays on your device

- **The app sends no report content anywhere.** It has no report-upload service, telemetry, analytics or licence check, and you can use it while disconnected from the network. Opening the online guide or another link is an ordinary web visit.
- **The page restricts itself.** Its Content-Security-Policy (`default-src 'none'`) limits scripts, connections and resource loading to the bundled application and local image data. In our Chrome, Edge and Firefox tests it made no network requests. You can check this yourself: open the browser's developer tools (F12) → Network tab, then use the tool. This covers the page itself, not your browser, its extensions or your operating system.
- **No project data is kept in the browser unless you turn on recovery drafts.** By default, unsaved work lives only in this tab until you save a project file, and closing or reloading the tab can lose it. The tool asks the browser to warn you first, but browsers may not always show that warning.
- **Recovery drafts (optional, off by default).** In Check & export you can turn on "Keep a recovery draft in this browser". The tool then keeps an unencrypted copy of the open project, screenshots included, in this browser profile a few seconds after each change. Who else can reach it depends on how you opened Rootnote:
  - **Online** (from rootnote.unravelnetworks.com): the browser keeps the draft for that site only. Other websites cannot read it; code served from that site, and anyone with access to your browser profile, could.
  - **Downloaded file** (rootnote.html opened from disk): browsers treat local files differently, and in some browsers **other HTML files you open from disk in the same browser may be able to read or replace the draft**. Leave drafts off if you open HTML files from targets or tools in that browser.
  - In both cases the draft is unencrypted. When you open the tool again it offers the draft; it never loads it on its own. Turning the setting off deletes the draft. A draft is not a backup: clearing browser data removes it, so keep saving project files.
- **Finding library.** Reusable findings are kept in their own library file, which you open and save like a project. The library is never stored in the browser. Entries keep their text exactly as written, so remove client-specific details before reusing them.
- **Hidden screenshot metadata is removed.** When a screenshot is added, when a project is opened (so older projects and projects from others are cleaned too; save to keep the cleaned copy) and again when the Word file is made, the tool removes what image files can carry besides the picture: camera and location (EXIF/GPS), XMP and IPTC data, comments, thumbnails, PNG text notes and anything appended after the image. It keeps only what the picture needs: the image data, a colour profile (whose name is replaced; the profile itself is kept so colours look the same, and can name a device or vendor), and the orientation of a photo that is flipped or turned 180°. A photo turned a quarter turn by its camera tag is refused; save a copy from an image editor first. A file the tool cannot fully check is refused rather than kept as is. The pixels are not changed. The original file name is kept in the project file only, not in the report.
- **Theme.** The light or dark theme choice (**⋯ → Dark theme**) is the one setting kept in the browser. It holds no project data.

## Saving and backups (please read)

- **Save often.** Use **Save** or Ctrl+S. The header shows whether the project was saved to a file, opened from one, or sent as a download, and when.
- **Where files go.** In Chrome and Edge, **Save** asks where to save the first time and then saves to that same file; **⋯ → Save as…** picks a new file; **⋯ → Download project file** sends a copy to your downloads folder. A project opened from an engagement folder saves back into that folder. In browsers without a save picker, every save is a download of `<title>.rootnote.json`; check that the download finished.
- **Google Drive, OneDrive, Dropbox.** If their desktop app syncs a folder on your computer, save into that folder; their software uploads the file. The tool itself never connects to them.
- **Keep backups** of important projects in a second location.
- **Project files, exported reports, Markdown and CSV files contain your text, and the project and report contain your screenshots.** Treat them as confidential client material and store them according to your engagement's data-handling rules (for example an encrypted disk).
- **Opening checks the file first.** **Open…** checks the whole file before replacing your current work. Damaged, incompatible, invalidly modified or too-large files are refused, and your current work is left unchanged. These are integrity and format checks, not a signature: a correctly formed project file that someone edited will still open.

## Limits

These limits reflect the report sizes we have tested, not a paid restriction. Tell us if they prevent your normal work.

| Item | Limit |
|---|---|
| Findings per project | 20 |
| Screenshots per project | 30 |
| Screenshot format | PNG or JPEG |
| Each screenshot | 2 MiB (2,097,152 bytes) and 16 megapixels (max 16,000 px per side) |
| Project file | 25 MiB (26,214,400 bytes). Changes that would exceed it are refused, so the project always stays saveable. |
| Text | 300 characters for single-line fields, 20,000 for text areas |
| Additional details | 100 blocks per finding; their text together up to 20,000 characters |
| Your own report sections | 10 |
| References per finding | 20 |
| Finding library file | 500 entries, 5 MB, text only |

The app's messages round these limits to "2 MB" and "25 MB".

**Older projects** (saved by earlier versions) are converted when opened. If a converted project ends up over 25 MB, it still opens, with a notice: you can remove screenshots to bring it under the limit. Edits that do not grow the file are allowed. Save and report export stay unavailable until it fits; Download original preserves the original imported file. Projects saved by this version that are over the limit are refused.

**Tall screenshots** (for example full-page captures) are **split** into page-sized parts that keep one figure number. Split parts are re-encoded as new PNG images, so they are not byte-identical to the original; the image stored in the project is not changed. Switch a screenshot to **shrink to fit** if you prefer one overview image, which keeps the original image data but can make small text hard to read. Screenshots are never cut off silently.

## What the Word file contains

- An optional cover page with your logo and the client's logo, or a title page when the cover is off. The first enabled, nonempty report section starts on a new page after the cover/title block; later sections follow your configured order.
- An optional table of contents, executive summary, rating explanation, engagement table, scope, your own sections, and a findings summary table with links to each finding.
- Scoring: severity, risk or CVSS (3.1 or 4.0 Base, one version per report), alone or with CVSS. Finding IDs use your engagement ID (for example `UNR-2026-014-3`).
- One section per finding, starting on a new page (a long finding continues over further pages), with its rating, status, vulnerability type and CWE. You choose which sections appear, their order and their names in **Sections & scoring**. Empty optional sections are left out:
  - affected assets, description, additional details, impact, threat, recommendation, references
  - additional details keep your text and screenshots in the order you placed them; screenshots are numbered and captioned
- Each text section can be **plain text** or **code** (monospace, kept exactly as typed).
- Real Word styles: Title, Heading 1/2, Body, Code, Caption. Figure numbers and "Page X of Y" are Word fields.

**Formatting in plain-text fields:** a blank line starts a new paragraph, and a line starting with `- ` becomes a bullet. Code fields are kept exactly as typed.

## The CSV file

**Findings as CSV** writes one row per finding: ID, title, rating, CVSS score and vector, status, vulnerability type, CWE, assets and the text sections. It is UTF-8 with a byte-order mark, so Excel shows accents correctly. Cells that a spreadsheet could run as a formula (starting with `=`, `+`, `-` or `@`, also after leading spaces, invisible or direction characters, or written with look-alike forms such as the minus sign or full-width characters) are prefixed with an apostrophe. Screenshots appear only as a placeholder with their ID and caption, for example `[Screenshot IMG-0003: Login response]`. Sections you hid in the report are left empty, and in CVSS-only reports the rating column is empty.

## The Markdown file

**Report as Markdown** writes the whole report as one UTF-8 Markdown file: the report sections in your order, a findings summary table, then each finding with the same ID, key facts and sections as the Word report. Hidden sections are left out. Text is escaped so it shows as typed, and code stays in fences. Screenshots are not included; each becomes a placeholder such as `*[Figure 3: Login response (screenshot not included)]*`. The table of contents and count tables are left out.

## Printing to PDF from the browser

- **Turn off the browser's "Headers and footers" option** in the print window. When it is on, the browser itself prints the page address (for a downloaded copy, the file's location on your computer, which can include your user name) and the date on every sheet.
- **Firefox:** links inside the browser PDF are left out (the titles in the findings summary print as plain text), because Firefox would also store the page address in each link. The Word file keeps its links.
- **Check the saved PDF before sending it.** Browser print options are outside the tool's control.

## What it does not do

- **It does not find or hide sensitive data for you.** Screenshot editing covers what you mark, nothing else. Text is exported exactly as you wrote it. Metadata removal does not find data deliberately hidden inside the compressed picture data or inside a colour profile.
- **It does not judge severity or write content.** There is no AI. The CVSS 3.1 and 4.0 calculators turn the metrics you pick into a Base vector and score; severity is whatever you choose.
- **The checklist is a set of reminders, not a quality or compliance certification.**
- **Not supported:** your own Word template, importing a .docx back, scanner imports, CVSS 4.0 Threat, Environmental and Supplemental metrics, and collaboration.

## Browsers

| | Chrome, Edge | Firefox | Safari |
|---|---|---|---|
| Write, export Word and CSV, print | Yes | Yes | Writing, preview and Word export checked by hand; PDF printing not yet confirmed |
| Save to the same file again | Yes | No: each save is a download | No: each save is a download |
| Engagement folders | Read and save into them | Read only; saves are downloads | Not checked |

Tested on Windows desktop with current versions. Safari on macOS was checked by hand as shown. Phones are for exploring the sample (checked on an iPhone 11 Pro with Safari); report writing and saving on phones are not checked. Word for Mac and LibreOffice checks are not finished yet.

## Troubleshooting

- **"Could not open …".** The file failed the format and integrity checks. The message lists the reasons. Your current work was not changed.
- **A screenshot was not added.** Check the message: wrong format, over 2 MB or 16 MP, damaged, or the project limit was reached.
- **Pasting does nothing.** Open a finding first (paste adds to the open finding), and make sure the clipboard holds an image, not a file path.
- **"Your browser is asking whether this page may edit files…".** Answer the browser's prompt at the top of the window; the save or export finishes after that.
- **The engagement list is empty.** Choose the top folder: inside it, one folder per customer, then one per engagement, with the project file directly in the engagement folder.
- **Word asks to repair the file.** Please report it, with the version shown at the bottom of this file and synthetic steps to reproduce. **Never send client reports or client screenshots.**

## Support and security

- Support: support@unravelnetworks.com. Rootnote is free, so support is best effort.
- Security issues: security@unravelnetworks.com (please report privately first). `SECURITY.md` explains what to include.
- Send only synthetic examples. Never send client data, real screenshots or real project files.

## Licence

Rootnote is free and open source under the Apache License 2.0, including for paid client work. The licence is in `LICENSE` (with `NOTICE`) and at the top of **About & licences** in the app; the source code is at https://github.com/unravelnetworks/rootnote. Open source means you can read and check the code; it is not an independent audit. Except for identified third-party material, project-authored code, documentation, finding-library text and sample assets are provided under Apache-2.0. Third-party material retains its own licences. No trademark rights in Rootnote or Unravel Networks are granted beyond the licence's allowance for describing origin and reproducing notices. Retaining the supplied branding in unmodified copies and sample reports is permitted; do not imply endorsement of a modified version. Use distinct branding for a separately marketed fork. The reports and files you create are yours. The third-party components it includes stay under their own licences, listed in `THIRD-PARTY-NOTICES.txt` and under **About & licences** inside the app. JSZip is used under its MIT option.

## Version and checking your copy

See `VERSION.txt` and `SHA256SUMS.txt` in this folder.

The Rootnote download page on unravelnetworks.com lists the SHA-256 fingerprint of the zip file you download. To check that your copy was not changed on the way, compare it before unpacking:

- Windows (PowerShell): `Get-FileHash .\<file>.zip -Algorithm SHA256`
- macOS: `shasum -a 256 <file>.zip`
- Linux: `sha256sum <file>.zip`

`SHA256SUMS.txt` then lists the fingerprint of each file inside the zip. It only helps once the zip itself has been checked, since anyone who changed the zip could change that list too. Get Rootnote from the Rootnote download page. If someone shares a copy with you, check its zip against the SHA-256 published there before you use it.
