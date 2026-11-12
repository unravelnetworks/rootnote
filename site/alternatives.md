# Rootnote and the alternatives

Several tools turn pentest findings into a report. This page compares what each project documents, so you can pick the one that fits your work. Sometimes that is not Rootnote.

Every fact about another tool links to that project's own repository or documentation. We did not run the tools side by side, and we do not rank them. Last checked: 11 November 2026.

## At a glance

| Tool | Licence | How it runs | Collaboration | Report output | CVSS |
|---|---|---|---|---|---|
| Rootnote | Apache-2.0 | One HTML file in a desktop browser | None | Word, Markdown, CSV, print to PDF | 3.1 and 4.0 Base |
| SysReptor | SysReptor Community License (source-available) | Self-hosted or cloud | Live co-editing in the paid Professional edition | PDF | 3.1 and 4.0 |
| PwnDoc | MIT | Self-hosted | Multi-user, real time | Word | 3 and 4 |
| PwnDoc-ng | MIT | Self-hosted | Multi-user, co-editing | Word, own templates | 3.1 |
| Ghostwriter | BSD-3-Clause | Self-hosted (Docker) | Real-time editor, roles, SSO | Word, Excel, PowerPoint, JSON | Not checked |
| Dradis CE | GPL-2.0 | Self-hosted | Yes, more in the paid Pro edition | HTML, PDF, CSV | Not checked |
| WriteHat | AGPL-3.0 | Self-hosted (Docker) | Roles and section assignment | HTML, PDF | 3.1 and DREAD |
| PeTeReport | BSD-3-Clause | Self-hosted (Docker) | User accounts | HTML, PDF, CSV, Markdown, Jupyter | 4 |
| AttackForge ReportGen | Free to use (check its terms) | Browser, download or command line | None | Word, from your template and a JSON file | Uses the scores you supply |
| Serpico | BSD-3-Clause | Self-hosted (Docker); archived since 2020 | Multi-user, shared findings and attachments | Word, from your own templates | 2, 3 and DREAD |
| A Word template | Depends on the template; Word is licensed separately | Word | Depends on your Word setup | Word | Your choice |

Base means the CVSS Base metric group only (CVSS-B). We have not checked whether the other tools' CVSS 4.0 support goes beyond the Base metrics.

## Each tool in short

**SysReptor.** You design the report in HTML, write findings in Markdown, and get a PDF. Simultaneous editing needs the Professional edition. Its licence lets you use and self-host it but limits forks and redistribution. [Repository](https://github.com/Syslifters/sysreptor), [CVSS fields](https://docs.sysreptor.com/designer/field-types#cvss), [co-editing](https://docs.sysreptor.com/reporting/collaborative-editing).

**PwnDoc.** A team server with real-time co-editing, review and approval, retests, custom fields and a shared vulnerability library. It fills your own Word template. [Repository](https://github.com/pwndoc/pwndoc).

**PwnDoc-ng.** A separately maintained fork of PwnDoc with collaborative editing and its own Word templates. [Repository](https://github.com/pwndoc-ng/pwndoc-ng).

**Ghostwriter.** Manages whole engagements: clients, infrastructure, domains and a findings library, with a real-time editor, roles, SSO and an API. It fills Word templates and also exports Excel and PowerPoint. [Repository](https://github.com/GhostManager/Ghostwriter), [co-editing](https://www.ghostwriter.wiki/features/reporting/collaborative-editing).

**Dradis Community Edition.** Imports scanner output from Burp, Nessus, Nmap, OpenVAS, Qualys, ZAP and others, and exports HTML, PDF and CSV. A paid Pro edition adds more. [Repository](https://github.com/dradis/dradis-ce), [CE page](https://dradis.com/ce/).

**WriteHat.** Turns Markdown into an HTML or PDF report, scored with CVSS 3.1 or DREAD. Its documentation shows no Word export, and live co-editing is listed as future work. [Repository](https://github.com/blacklanternsecurity/writehat).

**PeTeReport.** Exports HTML, PDF, CSV, Markdown and Jupyter notebooks, scores with CVSS 4, and imports findings from DefectDojo. Its documentation shows no Word export. [Repository](https://github.com/1modm/petereport).

**AttackForge ReportGen.** A free generator. You give it a Word template with tags and a JSON file of findings, and it produces the report. You write the findings elsewhere; Rootnote is where you write them. [Repository](https://github.com/AttackForge/ReportGen), [browser version](https://attackforge.com/reportgen.html).

**Serpico.** An older team tool that built Word reports from your own templates, with a shared findings database, Nessus and Burp import, and CVSS 2, CVSS 3 and DREAD. The repository is archived and its last commit was in April 2020, so choose a maintained tool for new work. [Repository](https://github.com/BuffaloWill/Serpico).

**A Word template.** For occasional reports, a good template and tidy screenshot names may be enough. Rootnote helps when placing images, numbering figures and keeping the findings table in step start to cost you time.

## Pick something else if

- Two or more people write the same report at once. Look at PwnDoc, PwnDoc-ng, Ghostwriter or SysReptor Professional.
- You start from scanner output. Dradis CE imports it; Rootnote does not.
- You need CVSS 4.0 beyond the Base metrics. Rootnote scores CVSS 4.0 Base only. PwnDoc, PeTeReport and SysReptor document CVSS 4.0; we have not checked how far beyond Base each one goes.
- You must deliver in your own Word template. PwnDoc, Ghostwriter and AttackForge ReportGen fill templates you control. Rootnote has one built-in design with your sections, logos and colours.
- You want to manage clients and infrastructure, not just write the report. Look at Ghostwriter.
- Your reports have more than 20 findings or 30 screenshots. Rootnote enforces those tested limits.

## What Rootnote is

- Free and open source under Apache-2.0, including for paid client work.
- One HTML file that runs in your browser, online or downloaded. No install, no account, no server to run.
- The app processes your report on your own computer and does not upload it.
- Works offline once downloaded.
- Exports an editable Word report with styles, numbered figures and a linked findings summary, plus the whole report as Markdown and the findings as CSV.
- CVSS 3.1 or 4.0 Base scores, CWE, affected assets and references for each finding. Each score shows its version.
- Limits: 20 findings, 30 screenshots and a 25 MiB project file. These are the sizes we have tested.
- Tested on Windows in Chrome, Edge and Firefox. Basic use in Safari on macOS has been checked by hand.
- No independent security audit yet. The app runs no AI models.

[Try the built-in sample](https://rootnote.unravelnetworks.com/) or [read the code](https://github.com/unravelnetworks/rootnote).

Spotted something wrong or out of date? [Open an issue](https://github.com/unravelnetworks/rootnote/issues/new/choose) or write to support@unravelnetworks.com, and we will correct it.
