// Screenshot editing in the app, offline: black out, pixelate, box, arrow and crop. Edits
// change the pixels themselves (nothing is layered on top), so what is blacked out is gone
// from the saved project and the Word report. Undo inside the editor replays the steps on
// the original, so memory stays small even for large screenshots.
import { h } from './dom.js';
import { LIMITS } from '../app/project.js';

const TOOLS = [['blackout', 'Black out'], ['pixelate', 'Pixelate'], ['box', 'Box'], ['arrow', 'Arrow'], ['crop', 'Crop']];
const RED = '#e5484d';

/** Opens the editor for an image record. Resolves { bytes, summary } with the edited image in
 * the record's own format, or null when cancelled or nothing changed. */
export async function editImage(im) {
  const img = new Image();
  img.src = im.dataUrl;
  await img.decode();
  return new Promise((resolve) => {
    let tool = 'blackout';
    const ops = [];
    let base = null; // the image with every committed step applied
    let drag = null; // { from, to } in canvas pixels while drawing

    // Focusable, so the tools also work from the keyboard.
    const canvas = h('canvas', { class: 'redact-canvas', 'data-testid': 'redact-canvas', tabindex: '0', 'aria-label': 'Screenshot being edited. Arrow keys move a selection, Shift with arrow keys resizes it, Enter applies the tool.' });
    const ctx = canvas.getContext('2d');
    const note = h('p', { class: 'hint redact-note', 'aria-live': 'polite' });
    const toolButtons = TOOLS.map(([key, label]) => h('button', {
      type: 'button', class: 'secondary', dataset: { tool: key }, 'data-testid': `redact-${key}`, onclick: () => { tool = key; sync(); },
    }, label));
    const undo = h('button', { type: 'button', class: 'secondary', 'data-testid': 'redact-undo', onclick: () => { ops.pop(); rebuild(); sync(); } }, 'Undo');
    const save = h('button', { type: 'button', 'data-testid': 'redact-save', onclick: finish }, 'Save changes');
    const dialog = h('dialog', { class: 'redact', 'aria-label': `Edit screenshot ${im.id}` },
      h('div', { class: 'row redact-bar', role: 'toolbar', 'aria-label': 'Tools', onkeydown: toolbarKeys }, ...toolButtons, h('span', { class: 'spacer' }), undo),
      h('div', { class: 'redact-stage' }, canvas),
      note,
      h('div', { class: 'row end' },
        h('button', { type: 'button', class: 'secondary', 'data-testid': 'redact-cancel', onclick: () => discard() }, 'Cancel'), save));

    // Arrow keys move between the toolbar's buttons, as a toolbar does.
    function toolbarKeys(e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const items = [...toolButtons, undo].filter((x) => !x.disabled);
      const k = items.indexOf(document.activeElement);
      if (k < 0) return;
      e.preventDefault();
      items[(k + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length].focus();
    }

    function sync() {
      toolButtons.forEach((b) => { const on = b.dataset.tool === tool; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on); });
      undo.disabled = !ops.length;
      save.disabled = !ops.length;
      note.textContent = tool === 'pixelate'
        ? 'Pixelated text can sometimes be read back. Use Black out for passwords, tokens and personal data.'
        : tool === 'crop' ? 'Drag over the part to keep.'
          : 'Drag over the screenshot. The change replaces the pixels, so nothing hidden stays in the file.';
    }

    function rebuild() {
      let c = h('canvas');
      c.width = im.width;
      c.height = im.height;
      c.getContext('2d').drawImage(img, 0, 0);
      for (const op of ops) c = apply(c, op);
      base = c;
      paint();
    }
    function paint() {
      canvas.width = base.width;
      canvas.height = base.height;
      ctx.drawImage(base, 0, 0);
      if (!drag) return;
      const line = Math.max(2, Math.round(Math.min(base.width, base.height) / 250));
      ctx.save();
      if (tool === 'arrow') arrow(ctx, drag.from, drag.to, line * 1.5);
      else {
        const r = rect(drag.from, drag.to, base);
        ctx.lineWidth = line;
        ctx.setLineDash(tool === 'crop' ? [line * 4, line * 3] : []);
        ctx.strokeStyle = tool === 'box' ? RED : '#0f6f7c';
        if (tool === 'blackout') { ctx.fillStyle = 'rgb(0 0 0 / .75)'; ctx.fillRect(r.x, r.y, r.w, r.h); }
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
      ctx.restore();
    }

    const at = (e) => {
      const box = canvas.getBoundingClientRect();
      return { x: Math.round((e.clientX - box.left) * (canvas.width / box.width)), y: Math.round((e.clientY - box.top) * (canvas.height / box.height)) };
    };
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      drag = { from: at(e), to: at(e) };
    });
    canvas.addEventListener('pointermove', (e) => { if (drag) { drag.to = at(e); paint(); } });
    canvas.addEventListener('pointerup', (e) => {
      if (!drag) return;
      drag.to = at(e);
      const op = { tool, from: drag.from, to: drag.to };
      drag = null;
      const r = rect(op.from, op.to, base);
      const long = Math.hypot(op.to.x - op.from.x, op.to.y - op.from.y);
      if (tool === 'arrow' ? long >= 6 : r.w >= 4 && r.h >= 4) ops.push(op);
      rebuild();
      sync();
    });

    // Keyboard selection: arrows move it, Shift+arrows resize it, Enter applies the tool to it
    // (an arrow is drawn from its top-left to its bottom-right corner), Escape clears it.
    let sel = null;
    const say = () => {
      if (!sel) return;
      const pc = (v, of) => Math.round((v / of) * 100);
      note.textContent = `Selection ${pc(sel.x, base.width)}% from the left, ${pc(sel.y, base.height)}% from the top, ${pc(sel.w, base.width)}% wide, ${pc(sel.h, base.height)}% high. Enter applies ${TOOLS.find(([k]) => k === tool)[1]}.`;
    };
    const showSel = () => { drag = sel ? { from: { x: sel.x, y: sel.y }, to: { x: sel.x + sel.w, y: sel.y + sel.h } } : null; paint(); say(); };
    canvas.addEventListener('keydown', (e) => {
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (dir) {
        e.preventDefault();
        const step = Math.max(1, Math.round(Math.min(base.width, base.height) / 50));
        if (!sel) sel = { x: Math.round(base.width / 4), y: Math.round(base.height / 4), w: Math.round(base.width / 4), h: Math.round(base.height / 4) };
        else if (e.shiftKey) {
          sel.w = Math.max(step, Math.min(base.width - sel.x, sel.w + dir[0] * step));
          sel.h = Math.max(step, Math.min(base.height - sel.y, sel.h + dir[1] * step));
        } else {
          sel.x = Math.max(0, Math.min(base.width - sel.w, sel.x + dir[0] * step));
          sel.y = Math.max(0, Math.min(base.height - sel.h, sel.y + dir[1] * step));
        }
        showSel();
      } else if (e.key === 'Enter' && sel) {
        e.preventDefault();
        ops.push({ tool, from: { x: sel.x, y: sel.y }, to: { x: sel.x + sel.w, y: sel.y + sel.h } });
        sel = null;
        drag = null;
        rebuild();
        sync();
      } else if (e.key === 'Escape' && sel) {
        e.preventDefault();
        e.stopPropagation();
        sel = null;
        showSel();
        sync();
      }
    });

    const encode = (quality) => new Promise((done) => base.toBlob(done, im.mime, quality));
    async function finish() {
      if (!ops.length) { dialog.close('cancel'); return; }
      // A JPEG is re-encoded at lower quality until it fits the per-screenshot limit; if it
      // still does not fit, the editor stays open so no edit is lost.
      let blob = null;
      for (const quality of im.mime === 'image/jpeg' ? [0.92, 0.85, 0.75, 0.6] : [undefined]) {
        blob = await encode(quality);
        if (!blob || blob.size <= LIMITS.imageBytes) break;
      }
      if (!blob) { note.textContent = 'The browser could not encode the edited screenshot.'; return; }
      if (blob.size > LIMITS.imageBytes) {
        note.textContent = `The edited screenshot would be ${(blob.size / 1048576).toFixed(1)} MB, over the 2 MB limit. Crop it to a smaller area, or Cancel to keep the original.`;
        return;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      dialog.close('ok');
      resolve({ bytes, summary: summarise(ops) });
    }

    // Edits are not thrown away by one stray Escape or Cancel.
    let armed = false;
    function discard() {
      if (!ops.length || armed) { dialog.close('cancel'); return; }
      armed = true;
      note.textContent = `Discard ${ops.length} edit${ops.length === 1 ? '' : 's'}? Press Cancel or Escape again to discard, or Save to keep them.`;
    }
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); discard(); });
    // Chrome lets a page keep a dialog open on Escape only after recent input, so the key is handled here.
    dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); discard(); } });
    dialog.addEventListener('close', () => { dialog.remove(); if (dialog.returnValue !== 'ok') resolve(null); });
    document.body.append(dialog);
    rebuild();
    sync();
    dialog.showModal();
  });
}

/** A rectangle from two corners, inside the canvas. */
function rect(a, b, c) {
  const x = Math.max(0, Math.min(a.x, b.x));
  const y = Math.max(0, Math.min(a.y, b.y));
  return { x, y, w: Math.min(c.width, Math.max(a.x, b.x)) - x, h: Math.min(c.height, Math.max(a.y, b.y)) - y };
}

function apply(c, op) {
  const r = rect(op.from, op.to, c);
  const g = c.getContext('2d');
  const line = Math.max(3, Math.round(Math.min(c.width, c.height) / 200));
  if (op.tool === 'blackout') { g.fillStyle = '#000'; g.fillRect(r.x, r.y, r.w, r.h); return c; }
  if (op.tool === 'pixelate') {
    const size = Math.max(10, Math.round(Math.max(r.w, r.h) / 16));
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.ceil(r.w / size));
    small.height = Math.max(1, Math.ceil(r.h / size));
    small.getContext('2d').drawImage(c, r.x, r.y, r.w, r.h, 0, 0, small.width, small.height);
    g.save();
    g.imageSmoothingEnabled = false;
    g.drawImage(small, 0, 0, small.width, small.height, r.x, r.y, r.w, r.h);
    g.restore();
    return c;
  }
  if (op.tool === 'box') { g.save(); g.strokeStyle = RED; g.lineWidth = line; g.strokeRect(r.x, r.y, r.w, r.h); g.restore(); return c; }
  if (op.tool === 'arrow') { g.save(); arrow(g, op.from, op.to, line); g.restore(); return c; }
  // crop
  const out = document.createElement('canvas');
  out.width = r.w;
  out.height = r.h;
  out.getContext('2d').drawImage(c, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return out;
}

function arrow(g, a, b, width) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const head = width * 5;
  g.strokeStyle = RED;
  g.fillStyle = RED;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x - Math.cos(angle) * head * 0.8, b.y - Math.sin(angle) * head * 0.8);
  g.stroke();
  g.beginPath();
  g.moveTo(b.x, b.y);
  g.lineTo(b.x - head * Math.cos(angle - 0.45), b.y - head * Math.sin(angle - 0.45));
  g.lineTo(b.x - head * Math.cos(angle + 0.45), b.y - head * Math.sin(angle + 0.45));
  g.closePath();
  g.fill();
}

/** "2 areas blacked out · cropped", for the card's chip this session. */
function summarise(ops) {
  const n = (t) => ops.filter((o) => o.tool === t).length;
  const parts = [];
  const plural = (k, one, many) => (k === 1 ? one : `${k} ${many}`);
  if (n('blackout')) parts.push(`${plural(n('blackout'), 'area', 'areas')} blacked out`.replace(/^area/, '1 area'));
  if (n('pixelate')) parts.push(`${plural(n('pixelate'), 'area', 'areas')} pixelated`.replace(/^area/, '1 area'));
  if (n('box') || n('arrow')) parts.push('marked up');
  if (n('crop')) parts.push('cropped');
  return parts.join(' · ');
}
