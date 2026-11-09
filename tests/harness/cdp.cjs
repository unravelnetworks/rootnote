// Minimal Chrome DevTools Protocol driver (Node 22+ built-in WebSocket, no dependencies).
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BROWSERS = {
  chrome: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  edge: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Headless Chrome and Edge expose the File System Access save picker on file: pages, but
// no dialog can be answered there. By default it is removed before the app loads, so the
// app takes its download path; tests of the picker install a scripted fake instead.
async function launch(name, port, { savePicker = false } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rootnote-' + name + '-'));
  const proc = spawn(BROWSERS[name], [
    '--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'
  ], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); break; } catch (e) { await sleep(200); }
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
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
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result.value;
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
    const loaded = new Promise((r) => {
      const l = (m) => { if (m.method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(l), 1); r(); } };
      listeners.push(l);
    });
    await send('Page.navigate', { url });
    await loaded;
  };
  const setFile = async (selector, file) => {
    const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
    const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
    await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [file] });
  };
  const close = async () => {
    try { await send('Browser.close'); } catch (e) { /* already gone */ }
    await sleep(500);
    try { proc.kill(); } catch (e) { /* ignore */ }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');
  if (!savePicker) {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Window.prototype.showSaveFilePicker; delete window.showSaveFilePicker;' });
  }
  return { send, evaluate, waitFor, navigate, setFile, close, listeners, profile };
}

module.exports = { launch, sleep, BROWSERS };
