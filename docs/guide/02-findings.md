# Write findings and reuse text

A finding is one issue in the report: how serious it is, where it is, and the text and screenshots that explain it.

## Add a finding

Choose **+ New finding** in the list on the left. A report can hold up to 20 findings. They appear in the report in the same order as in the list; drag them to reorder.

## Set the key facts

At the top of a finding:

1. Choose the **Severity** (1).
2. To add a CVSS 3.1 score, open **CVSS calculator** (2) and pick the metrics. Rootnote works out the vector and the score.
3. Fill in **Affected assets**, **Status**, **Vulnerability type** and **CWE**.

![A finding's key facts: Severity marked 1 and the CVSS calculator marked 2.](__IMG_FACTS__)

Rootnote calculates the CVSS 3.1 Base score only. You choose the metrics and the severity; it does not choose them for you.

If the report shows CVSS scores and a finding has no vector, the report says *Unscored* for it. That is different from a score of zero.

## Write the text

Below the key facts are the text sections: **Description**, **Impact**, **Recommendations** and so on. In **Sections & scoring** you choose which ones appear, their order and their names. Empty optional sections are left out of the report.

- A blank line starts a new paragraph.
- A line that starts with `- ` becomes a bullet.

## Put steps and screenshots in order

**Additional details** is for the steps to reproduce, with screenshots between them. Point between two blocks to show the insert bar, then choose **Text**, **Code** or **Screenshot** (1).

![The insert bar between blocks, with Screenshot marked 1, above a text block.](__IMG_BLOCKS__)

- **Code** blocks keep requests, responses and commands exactly as typed.
- Each block's **⋯** menu moves it, changes it between text and code, or removes it.
- You can also paste a screenshot (Ctrl+V) or drop image files onto the finding.

The report keeps this order exactly. See [Add and edit screenshots](../screenshots/).

## References

Under **References**, add sources such as an OWASP page or a vendor advisory: a title and, if you like, an address. They are printed as text, not clickable links.

> **Warning:** Never put tokens or passwords in a reference address.

## Replace the prompts

Starter findings contain prompts in double brackets, such as `[[affected endpoint]]`. Replace each one with what you found. **Check & export** lists the ones it finds, but it does not stop the export, so read the report before you send it.

## Reuse findings with the library

The **Finding library** holds findings you want to use again. It is a separate file that you open and save yourself.

![The Finding library with the OWASP starter tab marked 1 and Open library marked 2.](__IMG_LIBRARY__)

1. **OWASP starter** (1) has 12 ready-made findings for common web and API issues.
2. **Open library…** (2) opens your own library file.
3. **Add to report** copies an entry into the report. **Save to library**, in a finding's **⋯** menu, does the opposite.

> **Warning:** Library entries keep their text exactly as written. Remove client names, hosts and other client details before you save a finding to the library.

## Copy a finding as text

**Copy as text** in a finding's **⋯** menu shows the whole finding as plain text, ready to copy into an email or a ticket.

Next: [Add and edit screenshots](../screenshots/).
