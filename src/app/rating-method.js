// Default text for the "How findings are rated" section (schema v5, R5 B2). The editor fills
// it only when the user asks; it is never regenerated, so edits are kept. Wording is
// original. Manual ratings (Severity, Risk) are described as the tester's judgment; only
// CVSS Base (3.1 or 4.0) is described as calculated, with the FIRST qualitative bands.

const LEVELS = [
  ['Critical', 'can be exploited easily, typically without special access, and gives control of a system or broad access to sensitive data. Fix immediately.'],
  ['High', 'has serious impact, such as access to other users\' data or accounts, but needs a precondition such as an account or user interaction. Fix as a priority.'],
  ['Medium', 'has limited impact, or serious impact that depends on conditions that are hard to meet. Fix in the normal release cycle.'],
  ['Low', 'has little direct impact or is impractical to exploit, but adds risk in combination with other issues. Fix when convenient.'],
  ['Informational', 'is not a vulnerability in itself, but a hardening or good-practice observation.'],
];

function manual(name, risk) {
  const intro = risk
    ? `Each finding has a ${name} rating that the tester assigns from the evidence, weighing how likely exploitation is and what it would affect in this environment. It is a judgment, not a calculated score.`
    : `Each finding has a ${name} rating that the tester assigns from the evidence, weighing how easily the issue can be exploited and what an attacker would gain. It is a judgment, not a calculated score.`;
  return [intro, '', ...LEVELS.map(([level, text]) => `- ${level}: ${text}`)].join('\n');
}

function cvss(name, unscored) {
  return [
    `${name} is the score calculated from the finding's CVSS Base metrics, shown with its vector. Every finding in this report is scored with the same CVSS version, named in the score label and at the start of each vector. A CVSS 4.0 Base score (also called CVSS-B) does not include Threat, Environmental or Supplemental metrics. Either way the score describes the issue's technical severity and does not include environmental or business factors. Scores map to these bands:`,
    '',
    '- Critical: 9.0 to 10.0',
    '- High: 7.0 to 8.9',
    '- Medium: 4.0 to 6.9',
    '- Low: 0.1 to 3.9',
    '- None: 0.0',
    '',
    `A finding without a vector is shown as ${unscored}.`,
  ].join('\n');
}

/** The default explanation for a scoring mode, using the report's own label names. */
export function defaultRatingMethodText(mode, labels) {
  const parts = [];
  if (mode.startsWith('severity')) parts.push(manual(labels.severity, false));
  if (mode.startsWith('risk')) parts.push(manual(labels.risk, true));
  if (mode.includes('cvss')) parts.push(cvss(labels.cvss, labels.unscored));
  return parts.join('\n\n');
}
