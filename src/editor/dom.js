// Tiny DOM helpers. Text is always set through textContent or value, never innerHTML.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    // Through the style object, not a style attribute: the page's CSP allows no inline style attributes.
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Shows a modal confirmation and resolves true when the user confirms. */
export function confirmDialog(message, confirmLabel = 'Confirm') {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'confirm', 'aria-label': 'Confirm' },
      h('p', {}, message),
      h('div', { class: 'row end' },
        h('button', { type: 'button', class: 'secondary', value: 'cancel', onclick: () => dialog.close('cancel') }, 'Cancel'),
        h('button', { type: 'button', class: 'danger', 'data-confirm': '1', onclick: () => dialog.close('ok') }, confirmLabel)));
    dialog.addEventListener('close', () => { dialog.remove(); resolve(dialog.returnValue === 'ok'); });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** Shows long read-only text (for example the licence notices) in a modal dialog. */
/** Asks the user to pick one of `choices` ({ value, label }); resolves the value, or null on Cancel.
 * `message` is text, or a node for longer content. */
export function choiceDialog(message, choices) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'confirm', 'aria-label': 'Choose' },
      typeof message === 'string' ? h('p', {}, message) : message,
      h('div', { class: 'row end' },
        h('button', { type: 'button', class: 'secondary', onclick: () => dialog.close('') }, 'Cancel'),
        ...choices.map((c) => h('button', { type: 'button', 'data-choice': c.value, onclick: () => dialog.close(c.value) }, c.label))));
    dialog.addEventListener('close', () => { dialog.remove(); resolve(dialog.returnValue || null); });
    document.body.append(dialog);
    dialog.showModal();
  });
}

export function textDialog(title, text) {
  const dialog = h('dialog', { class: 'text', 'aria-label': title },
    h('div', { class: 'row' }, h('h2', {}, title), h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'secondary', onclick: () => dialog.close() }, 'Close')),
    h('pre', { tabindex: '0' }, text));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

/** Saves bytes as a file through a temporary object URL (works from file:). */
export function downloadBytes(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function readFileBytes(file) {
  return file.arrayBuffer().then((b) => new Uint8Array(b));
}

// Line icons drawn inline (no files, no network), 24-unit grid, stroked in the text colour.
const ICONS = {
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5',
  check: 'M5 12l4 4 10-10',
  plus: 'M12 5v14 M5 12h14',
  text: 'M4 6h16 M4 12h16 M4 18h10',
  code: 'M8 7l-5 5 5 5 M16 7l5 5-5 5',
  image: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M9 8a2 2 0 1 0 0 4a2 2 0 1 0 0-4z M21 16l-5-5-9 9',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z M5 17a3 3 0 0 1 3-3h11',
  up: 'M12 19V5 M6 11l6-6 6 6',
  down: 'M12 5v14 M6 13l6 6 6-6',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  copy: 'M10 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z M5 15V5a2 2 0 0 1 2-2h8',
  print: 'M7 9V3h10v6 M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2 M7 14h10v7H7z',
  word: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M8.5 12l1.2 5 1.3-4 1.3 4 1.2-5',
  wifioff: 'M3 3l18 18 M8.5 16.4a5 5 0 0 1 7 0 M5 12.9a10 10 0 0 1 4.2-2.6 M12 20h.01',
  lock: 'M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  alert: 'M12 8v5 M12 16.5h.01',
};
export function icon(name, cls = 'icon') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

// Rules made at run time (the print paper size) go in constructed style sheets: the page's
// CSP pins its one <style> by hash, so a new <style> element would be blocked.
const runtimeSheets = new Map();
/** Sets the run-time style sheet named `key` to `css`, or removes it when `css` is null. */
export function setRuntimeStyle(key, css) {
  if (typeof CSSStyleSheet !== 'function' || !('adoptedStyleSheets' in document)) return;
  let sheet = runtimeSheets.get(key);
  if (css === null) {
    if (sheet) { document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet); runtimeSheets.delete(key); }
    return;
  }
  if (!sheet) {
    sheet = new CSSStyleSheet();
    runtimeSheets.set(key, sheet);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  sheet.replaceSync(css);
}
