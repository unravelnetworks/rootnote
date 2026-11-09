// One launch() for every installed engine: Chrome and Edge through CDP, Firefox through
// WebDriver BiDi. Collects non-local requests and page errors, and routes downloads to a
// directory, so a test body can run unchanged in each engine. With savePicker: true, Chrome
// and Edge keep their native save picker (by default cdp.cjs removes it, so the app takes
// the same download path as Firefox); no picker dialog can be answered headless, so such
// tests use the explicit Download buttons.
'use strict';
const fs = require('fs');
const path = require('path');
const cdp = require('./cdp.cjs');
const bidi = require('./bidi.cjs');

const ENGINES = {
  chrome: { driver: cdp, exe: cdp.BROWSERS.chrome },
  edge: { driver: cdp, exe: cdp.BROWSERS.edge },
  firefox: { driver: bidi, exe: bidi.BROWSERS.firefox }
};

const installed = (name) => fs.existsSync(ENGINES[name].exe);
// file: is not blanket-local: another file read from disk counts as a request too.
const local = (url) => /^(data|blob|about):/.test(url);

// Runs before the page's own scripts in every document: reports each CSP violation as a
// console error, so a blocked script, image or connection fails the test in every engine
// even where the protocol itself does not surface the violation.
const VIOLATION_LOGGER = "document.addEventListener('securitypolicyviolation', (e) => console.error('CSP violation: ' + e.effectiveDirective + ' ' + (e.blockedURI || '')), true);";

// colorScheme ('light' or 'dark') is fixed for the session: Firefox takes it as a profile
// preference at start, as BiDi has no runtime override.
async function launch(name, port, { downloadDir, pageUrl, savePicker = false, colorScheme } = {}) {
  // Allowed: the exact URLs the test itself navigates to (plus pageUrl), not other paths or
  // queries on the same origin.
  const pages = new Set(pageUrl === undefined ? [] : [pageUrl]);
  const isLocal = (url) => local(url) || pages.has(url);
  const b = await ENGINES[name].driver.launch(name, port, { downloadDir, savePicker, colorScheme });
  b.requests = [];
  b.errors = [];
  b.notices = [];
  if (ENGINES[name].driver === cdp) {
    b.listeners.push((m) => {
      if (m.method === 'Network.requestWillBeSent' && !isLocal(m.params.request.url)) b.requests.push(m.params.request.url);
      if (m.method === 'Runtime.exceptionThrown') b.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'assert')) {
        b.errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      }
      // Chrome's interventions (for example a blocked beforeunload prompt in a page the test
      // reloads without a user gesture) are browser notices, kept apart from page errors.
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        (m.params.entry.source === 'intervention' ? b.notices : b.errors).push(m.params.entry.source + ': ' + m.params.entry.text);
      }
    });
    await b.send('Network.enable');
    await b.send('Log.enable');
    await b.send('Page.addScriptToEvaluateOnNewDocument', { source: VIOLATION_LOGGER });
  } else {
    b.listeners.push((m) => {
      if (m.method === 'network.beforeRequestSent' && !isLocal(m.params.request.url)) b.requests.push(m.params.request.url);
      // Every error-level entry: script errors, console.error and the browser's CSP reports.
      if (m.method === 'log.entryAdded' && m.params.level === 'error') b.errors.push(m.params.type + ': ' + m.params.text);
    });
    await b.send('session.subscribe', { events: ['network.beforeRequestSent', 'log.entryAdded'] });
    await b.send('script.addPreloadScript', { functionDeclaration: '() => {' + VIOLATION_LOGGER + '}' });
  }
  b.engine = name;
  // Downloads to dir, or refused when dir is null.
  b.allowDownloads = (dir) => ENGINES[name].driver === cdp
    ? b.send('Browser.setDownloadBehavior', dir ? { behavior: 'allow', downloadPath: dir } : { behavior: 'deny' })
    : b.send('browser.setDownloadBehavior', { downloadBehavior: dir ? { type: 'allowed', destinationFolder: dir } : { type: 'denied' } });
  const navigate = b.navigate;
  b.navigate = (url) => { pages.add(url); return navigate(url); };
  // Script run before the page's own scripts in every new document of this tab.
  b.addInitScript = (source) => ENGINES[name].driver === cdp
    ? b.send('Page.addScriptToEvaluateOnNewDocument', { source })
    : b.send('script.addPreloadScript', { functionDeclaration: '() => {' + source + '\n}' });
  // Viewport size in CSS pixels, or the default when null.
  b.setViewport = (size) => ENGINES[name].driver === cdp
    ? (size ? b.send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: false }) : b.send('Emulation.clearDeviceMetricsOverride'))
    : b.send('browsingContext.setViewport', { context: b.context, viewport: size });
  // One key press (W3C key names such as 'Escape' or 's'), optionally with Ctrl held.
  b.press = (key, { ctrl = false } = {}) => {
    if (ENGINES[name].driver === cdp) {
      const named = { Escape: { code: 'Escape', windowsVirtualKeyCode: 27 } }[key] || { code: 'Key' + key.toUpperCase(), windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) };
      const ev = { key, ...named, modifiers: ctrl ? 2 : 0 };
      return b.send('Input.dispatchKeyEvent', { type: 'keyDown', ...ev }).then(() => b.send('Input.dispatchKeyEvent', { type: 'keyUp', ...ev }));
    }
    const value = { Escape: '' }[key] || key;
    const keys = [{ type: 'keyDown', value }, { type: 'keyUp', value }];
    const actions = ctrl ? [{ type: 'keyDown', value: '' }, ...keys, { type: 'keyUp', value: '' }] : keys;
    return b.send('input.performActions', { context: b.context, actions: [{ type: 'key', id: 'keyboard', actions }] });
  };
  // PDF bytes of the current page as the browser prints it. Chrome and Edge take the paper
  // size from the page's CSS; BiDi has no such option, so Firefox is given the same size
  // explicitly (whether its own dialog applies the CSS size is a manual check).
  b.printPdf = async (paper) => {
    const r = ENGINES[name].driver === cdp
      ? await b.send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true })
      : await b.send('browsingContext.print', {
        context: b.context, background: true, shrinkToFit: false,
        margin: { top: 0, bottom: 0, left: 0, right: 0 },
        page: paper === 'A4' ? { width: 21, height: 29.7 } : { width: 21.59, height: 27.94 }
      });
    return Buffer.from(r.data, 'base64');
  };
  if (downloadDir) await b.allowDownloads(downloadDir);
  if (colorScheme && ENGINES[name].driver === cdp) await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: colorScheme }] });
  return b;
}

// Waits for a finished download whose name matches; skips partial files of every engine.
// Firefox creates the final file name when a download starts and fills it from a .part
// file, so a file only counts once no partial file is left and its size held for one poll.
async function waitForFile(dir, pattern, timeout = 20000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    const names = fs.readdirSync(dir);
    const f = names.find((n) => pattern.test(n) && !/\.(crdownload|part|tmp)$/.test(n));
    const partial = names.some((n) => /\.(crdownload|part|tmp)$/.test(n));
    if (f && !partial) {
      const full = path.join(dir, f);
      const size = fs.statSync(full).size;
      // Stable size, and a read returns all of it (Windows can report the size of a file
      // Firefox is still replacing).
      if (size > 0 && last && last.full === full && last.size === size && fs.readFileSync(full).length === size) return full;
      last = { full, size };
    } else {
      last = null;
    }
    await cdp.sleep(150);
  }
  throw new Error(`no download matching ${pattern}`);
}

module.exports = { launch, installed, waitForFile, ENGINES, sleep: cdp.sleep };
