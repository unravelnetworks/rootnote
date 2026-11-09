// Entry point: wires the editor to the DOCX exporter.
import { createEditor } from '../editor/editor.js';
import { exportDocx } from '../export-docx/index.js';
import { LIMITS } from './project.js';
import { APP_VERSION } from './version.js';

function boot() {
  const root = document.getElementById('app');
  const editor = createEditor(root, {
    exportDocx,
    appVersion: APP_VERSION,
    maxFindings: LIMITS.findings,
  });
  window.__fieldnote = editor;
  root.dataset.ready = '1';
}

boot();
