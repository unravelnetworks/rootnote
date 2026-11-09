# Help us check Rootnote

Rootnote is tested on Windows in Chrome, Edge and Firefox. Several other things people are likely to do with it have **not** been checked, and we would rather list them than imply they work.

If you have one of the setups below and ten minutes, we would like to know what happens. You do not need to write anything up formally — a few lines is plenty.

**Please use the built-in sample report.** Use the built-in sample: its client, findings and evidence are fictional. The Unravel Networks branding is real. Never use or send client or employer material.

The sample is suitable for these initial checks. For Linux screenshot import, use a made-up local image. Results qualify only the specific setup and actions reported.

Where to send results: **support@unravelnetworks.com**.
Found a security problem rather than a bug? Please use **security@unravelnetworks.com** instead — see the [security page](/security/). Not a public report.

Whatever you send, please include: your operating system and its version, the browser and version, the Rootnote version (shown in the app's About box), and the name of the program you opened the report in, with its version.


## 1. Does the Word file open properly in Word for Mac?

Not checked. We have rendered reports through Word on Windows to inspect layout. The full interactive document-consumer checks remain incomplete; Word for Mac and LibreOffice are not qualified yet.

1. Open `https://rootnote.unravelnetworks.com`, open the built-in sample report.
2. Export the Word report.
3. Open it in Word for Mac.
4. On a copy, select the document body and use Word's Update Field command (F9, or Fn+F9 if your keyboard requires it). Update footer fields separately, then open Print to repaginate. Report any warning or unexpected change.
5. Did it open without a repair/recovery prompt? Do the headings and summary links work? Are all screenshots present and correctly oriented? Do captions follow their displayed figure order, with split parts sharing one figure number? Are page numbers and totals correct? Save the copy, close it and reopen it; report any change.

## 2. Does it open properly in LibreOffice Writer?

Not checked. We do not have LibreOffice installed anywhere we can test.

1. Same first two steps as above.
2. Open the exported file in LibreOffice Writer.
3. Tell us: did it open at all? Do the styles and headings survive? Are the screenshots present and in the right places? Does the findings summary still link to each finding? Did anything obviously reflow or break?
4. If you save it from LibreOffice and reopen it, does it still look right?

## 3. Printing to PDF from Safari on macOS

Partly checked, and one known problem. Basic use of the app on macOS Safari has been checked by hand. Printing had a problem where a blank page appeared after every page; there is a fix in the code, but it has **not** been verified on a Mac yet, so we are not claiming it works.

1. Open the built-in sample in Safari on macOS.
2. Turn off browser headers and footers before printing, and tell us whether your print dialog offered that option.
3. Print, and save as PDF — once at A4 and once at Letter.
4. Tell us: any blank pages, at the start, in the middle or at the end? Is the whole report there, including the footer and every screenshot? Any content cut off at a page edge?

## 4. Linux desktop browsers

Not checked. Rootnote should work on Linux in a current Chrome, Chromium or Firefox, but "should" is not "has been".

1. Open the app, open the built-in sample, add a finding and paste or drop in a screenshot — use a made-up local image, never a real one.
2. Save the project file, then close the tab, reopen the app and open your saved file again.
3. Export the Word report and the CSV.
4. Tell us: did anything fail, look wrong, or behave differently from what the guide describes? Did saving and reopening give you back what you had?

## 5. Exploring on an Android phone

Not checked. Phone support is for **exploring only** — reading the guide, looking around the app, opening the sample. Writing and saving reports on a phone is not qualified, on any phone. We have checked exploration on an iPhone 11 Pro in Safari and on nothing else.

1. Open `https://rootnote.unravelnetworks.com` on an Android phone.
2. Open the built-in sample, move around the findings, and open the report preview. Try zooming it.
3. Read a page or two of `https://rootnote.unravelnetworks.com/guide/`.
4. Tell us: can you read everything without the page scrolling sideways? Does the menu work? Does the report preview fit the screen, and can you zoom it? Anything unreadable or unreachable?

Fit width should not make the whole page scroll sideways. Actual size may scroll inside the report preview.

## 6. Anything else that got in your way

Not a platform check, and the most useful thing you can send. If you tried Rootnote on real work and something was slow, confusing, missing, or just wrong, that is worth more to us than a clean test result. Tell us what you were doing and what you expected instead.


## What we do with what you send

We read everything, and we are one person doing this alongside a day job, so replies are best effort rather than fast.

If what you send turns into a fix, the release note will say what prompted it. If you would like to be credited by name, say so — we will not name anyone who has not asked to be named.

When we publish what has been checked, we say who checked it, on what version and on what platform. A community report is recorded as a community report, and results qualify only the specific setup and actions reported. One success does not become a general support claim: we will not turn these into a claim that Rootnote is supported, certified or compatible everywhere — the point of this page is the opposite.
