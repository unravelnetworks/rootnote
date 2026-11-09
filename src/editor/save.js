// Saving files. Where the browser offers a save dialog (File System Access API, Chrome
// and Edge), the user chooses the file and folder; otherwise files go to the browser's
// downloads. File handles live in memory only: nothing is stored in the browser, so the
// browser may ask again for the folder in a later session.

export const canPickSaveLocation = () => typeof window.showSaveFilePicker === 'function';

/**
 * Opens the save dialog. Call it straight from the click or key handler, before any
 * other await, because browsers only allow the dialog during a user gesture.
 * Resolves to a file handle, or null if the user cancelled. Other errors are thrown.
 */
export async function pickSaveFile({ suggestedName, description, mime, extension, id, startIn }) {
  const options = { suggestedName, id, types: [{ description, accept: { [mime]: [extension] } }] };
  if (startIn) options.startIn = startIn;
  try {
    return await window.showSaveFilePicker(options);
  } catch (err) {
    if (err?.name === 'AbortError') return null;
    throw err;
  }
}

/** Writes bytes to the file and resolves only after it has been closed successfully. */
export async function writeToHandle(handle, bytes, { onAsk } = {}) {
  if (handle.queryPermission && await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
    // The browser shows its own prompt and waits for it; say so, or the app looks stuck.
    onAsk?.();
    if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new DOMException('The browser did not allow writing to that file', 'NotAllowedError');
  }
  const writable = await handle.createWritable();
  try {
    await writable.write(bytes);
    await writable.close();
  } catch (err) {
    try { await writable.abort(); } catch { /* already closed or failed */ }
    throw err;
  }
}

/** A short, readable reason for a failed save. */
export function saveErrorText(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return 'the browser did not allow saving there';
  if (err?.name === 'QuotaExceededError') return 'there is not enough space';
  return err?.message || 'the file could not be written';
}
