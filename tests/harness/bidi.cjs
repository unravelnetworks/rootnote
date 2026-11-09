// Minimal WebDriver BiDi driver for Firefox (Node 22+ built-in WebSocket, no dependencies).
// Exposes the same small surface as cdp.cjs: evaluate, waitFor, navigate, setFile, close.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BROWSERS = {
  firefox: 'C:/Program Files/Mozilla Firefox/firefox.exe'
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// BiDi RemoteValue -> the JSON value CDP's returnByValue would give.
function plain(v) {
  switch (v.type) {
    case 'undefined': return undefined;
    case 'null': return null;
    case 'string': case 'boolean': return v.value;
    case 'number': return typeof v.value === 'number' ? v.value : (v.value === '-0' ? -0 : null);
    case 'bigint': return Number(v.value);
    case 'array': case 'set': return (v.value || []).map(plain).map((x) => (x === undefined ? null : x));
    case 'object': case 'map': {
      const o = {};
      for (const [k, val] of v.value || []) {
        const x = plain(val);
        if (x !== undefined) o[typeof k === 'string' ? k : plain(k)] = x;
      }
      return o;
    }
    case 'date': return v.value;
    case 'regexp': return {};
    default: return {};
  }
}

// Firefox has no File System Access save picker, so there is nothing to remove: the app
// takes its download path as it would for a real Firefox user.
async function launch(name, port, { downloadDir, colorScheme } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rootnote-' + name + '-'));
  // Keep first-run pages and update checks out of the way of the test profile.
  fs.writeFileSync(path.join(profile, 'user.js'), [
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("app.update.disabledForTesting", true);',
    'user_pref("browser.aboutwelcome.enabled", false);',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
    'user_pref("browser.download.dir", ' + JSON.stringify(downloadDir || path.join(profile, 'downloads')) + ');',
    'user_pref("browser.download.folderList", 2);',
    'user_pref("browser.download.useDownloadDir", true);',
    'user_pref("browser.download.always_ask_before_handling_new_types", false);',
    'user_pref("browser.download.alwaysOpenPanel", false);',
    // 0 dark, 1 light, 2 follow the system.
    'user_pref("layout.css.prefers-color-scheme.content-override", ' + ({ dark: 0, light: 1 }[colorScheme] ?? 2) + ');',
    ''
  ].join('\n'));
  const proc = spawn(BROWSERS[name], [
    '--headless', '--remote-debugging-port=' + port, '--profile', profile, '--no-remote', 'about:blank'
  ], { stdio: 'ignore' });

  let ws;
  for (let i = 0; i < 75 && !ws; i++) {
    try {
      const sock = new WebSocket('ws://127.0.0.1:' + port + '/session');
      await new Promise((resolve, reject) => {
        sock.addEventListener('open', resolve, { once: true });
        sock.addEventListener('error', reject, { once: true });
      });
      ws = sock;
    } catch (e) { await sleep(200); }
  }
  if (!ws) throw new Error('Firefox BiDi endpoint did not open on port ' + port);

  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.type === 'error' ? reject(new Error(msg.error + ': ' + msg.message)) : resolve(msg.result);
    } else if (msg.type === 'event') {
      listeners.forEach((l) => l(msg));
    }
  });
  // A command still waiting when the browser drops the connection (for example during
  // shutdown) fails instead of waiting forever, which left node:test with a pending promise.
  ws.addEventListener('close', () => {
    for (const { reject } of pending.values()) reject(new Error('browser connection closed'));
    pending.clear();
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });

  await send('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: false } } });
  const tree = await send('browsingContext.getTree', {});
  const context = tree.contexts[0].context;

  // The expression is evaluated as written (statements and comments included, as with CDP's
  // Runtime.evaluate), and the serialized result is turned back into plain JSON values to
  // match cdp.cjs's returnByValue.
  const evaluate = async (expr) => {
    const r = await send('script.evaluate', {
      expression: expr, target: { context }, awaitPromise: true, resultOwnership: 'none',
      serializationOptions: { maxObjectDepth: null, maxDomDepth: 0 }
    });
    if (r.type === 'exception') throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
    return plain(r.result);
  };
  const waitFor = async (expr, timeout = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (await evaluate(expr)) return true; } catch (e) { /* page not ready */ }
      await sleep(150);
    }
    return false;
  };
  const navigate = async (url) => {
    await send('browsingContext.navigate', { context, url, wait: 'complete' });
  };
  const setFile = async (selector, file) => {
    const r = await send('script.evaluate', {
      expression: 'document.querySelector(' + JSON.stringify(selector) + ')',
      target: { context }, awaitPromise: false, resultOwnership: 'root'
    });
    if (r.type === 'exception' || !r.result.sharedId) throw new Error('setFile: no element for ' + selector);
    // Firefox accepts only native paths (backslashes on Windows).
    await send('input.setFiles', { context, element: { sharedId: r.result.sharedId }, files: [path.resolve(file)] });
  };
  const close = async () => {
    try { await send('browser.close'); } catch (e) { /* already gone */ }
    await sleep(500);
    try { proc.kill(); } catch (e) { /* ignore */ }
  };
  return { send, evaluate, waitFor, navigate, setFile, close, listeners, profile, context };
}

module.exports = { launch, sleep, BROWSERS };
