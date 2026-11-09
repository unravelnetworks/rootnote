// Opt-in recovery draft in this browser's IndexedDB. Nothing is stored
// unless the user turns it on. The preference and an epoch live in the same store as the
// draft; every write checks them inside its own transaction, so turning the feature off
// (in this tab or another) can never be undone by a write that was already on its way.
// Success means the transaction completed, not that a request succeeded.

const DB = 'fieldnote-recovery';
const STORE = 'kv';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('This browser offers no storage for drafts.')); return; }
    let req;
    try { req = indexedDB.open(DB, 1); } catch (err) { reject(err); return; }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Draft storage could not be opened.'));
    req.onblocked = () => reject(new Error('Draft storage is blocked by another tab.'));
  });
}

/** Runs `body(store, tx)` in one transaction; resolves body's value after `complete`. */
async function transact(mode, body) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let value;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error ?? new Error('aborted'));
      tx.onerror = (e) => e.preventDefault(); // reported through onabort
      Promise.resolve(body(tx.objectStore(STORE), tx)).then((v) => { value = v; }, (err) => { try { tx.abort(); } catch { /* done */ } reject(err); });
    });
  } finally {
    db.close();
  }
}
const get = (store, key) => new Promise((resolve, reject) => { const r = store.get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

/** { enabled, epoch, draft: { savedAt, appVersion, bytes, json } | null } */
export async function readDraftState() {
  return transact('readonly', async (store) => {
    const meta = (await get(store, 'meta')) ?? { enabled: false, epoch: 0 };
    const draft = meta.enabled ? (await get(store, 'draft')) ?? null : null;
    return { enabled: meta.enabled === true, epoch: Number(meta.epoch) || 0, draft };
  });
}

/** Turns drafts on; returns the new epoch writers must present. */
export async function enableDrafts() {
  return transact('readwrite', async (store) => {
    const meta = (await get(store, 'meta')) ?? { enabled: false, epoch: 0 };
    const next = { enabled: true, epoch: (Number(meta.epoch) || 0) + 1 };
    store.put(next, 'meta');
    return next.epoch;
  });
}

/** Turns drafts off and deletes the draft in one transaction. Resolves after commit. */
export async function disableDrafts() {
  return transact('readwrite', async (store) => {
    const meta = (await get(store, 'meta')) ?? { enabled: false, epoch: 0 };
    store.put({ enabled: false, epoch: (Number(meta.epoch) || 0) + 1 }, 'meta');
    store.delete('draft');
    return true;
  });
}

/** Stores `record` only if drafts are still on with the same epoch. Resolves 'ok' after
 * commit or 'stale' (turned off or re-enabled elsewhere); rejects if the write failed. */
export async function writeDraft(epoch, record) {
  return transact('readwrite', async (store) => {
    const meta = await get(store, 'meta');
    if (!meta?.enabled || meta.epoch !== epoch) return 'stale';
    store.put({ ...record, epoch }, 'draft');
    return 'ok';
  });
}

/** Deletes the draft if drafts are still on with the same epoch. */
export async function discardDraft(epoch) {
  return transact('readwrite', async (store) => {
    const meta = await get(store, 'meta');
    if (!meta?.enabled || meta.epoch !== epoch) return 'stale';
    store.delete('draft');
    return 'ok';
  });
}
