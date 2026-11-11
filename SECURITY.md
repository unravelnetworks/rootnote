# Security policy

Rootnote processes report content locally in one browser HTML file, with no report-upload
service or app telemetry. Its Content Security Policy restricts resource loading. Opening the
online guide or other external links is a normal network visit; hosting processes visit
metadata. A security problem in it can still matter, because the files people open in it come
from engagements.

## Reporting a vulnerability

Email **security@unravelnetworks.com**. Please report privately and give us a reasonable
time to fix before you publish.

Include:
- the Rootnote version (`VERSION.txt`, or the file name of the release) and where you used it
  (downloaded file or the hosted copy, browser and version, operating system);
- what an attacker can do and what they need (for example a crafted project, library or
  image file, or a crafted page in another tab);
- the smallest **synthetic** file or steps that reproduce it.

Never send client data, real screenshots or real project files.

## In scope

- Code running from files the app opens (project, library, image, CSV/Word output that
  runs code in Word or a spreadsheet), or Markdown output that runs code when a viewer renders it.
- Any way the app sends data off the device, or loads anything from the network.
- Hidden data (image metadata, deleted text) surviving into saved projects, Word, Markdown or CSV.
- The hosted copy and its security headers, once it is online.

Out of scope: problems that need an already compromised computer or browser (malware,
malicious extensions), and other local HTML files reading an opt-in recovery draft, which the
README documents.

## Supported versions

Only the latest release is supported. Fixes ship as a new release with a new SHA-256
fingerprint on the download page.
