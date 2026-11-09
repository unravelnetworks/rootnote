# Contributing to Rootnote

Thank you for helping. Rootnote is maintained by one person alongside a day job, so replies are best effort, there is no response-time promise, and there is no obligation to accept a change.

## The one rule

**Synthetic data only.** Issues, pull requests, screenshots, attachments and test files are public. Never include client or employer material: no real findings, hostnames, IP addresses, URLs, screenshots of real systems or reports from real engagements. To show a problem, use the built-in sample report or made-up data. Anything posted publicly may be copied before it can be deleted.

Security problems are not reported here: follow [SECURITY.md](SECURITY.md).

## Useful things to send

- **Bugs:** what you did, what happened, what you expected; your operating system, browser and Rootnote version (shown under About & licences).
- **Platform checks:** results on setups we have not tested (Word for Mac, LibreOffice, Linux, Android); see https://rootnote.unravelnetworks.com/help-us-check/.
- **Ideas:** the problem you hit in your own workflow, before the feature you would like.
- **Finding library entries:** your own wording, with permission for us to edit and redistribute it under the project licence.

You can also email support@unravelnetworks.com instead of posting publicly.

## Pull requests

- Discuss larger changes in an issue first.
- Keep the core promises: the app makes no network requests while you work, keeps a strict content security policy, and never uploads report content.
- Add or update tests; run `npm run build` and `npm test`.
- Do not change a frozen schema file in `schema/`; a new project format needs a new schema version.

By submitting a contribution you confirm that you have the right to submit it and that it is provided under the Apache License 2.0, as described in section 5 of the [LICENSE](LICENSE).
