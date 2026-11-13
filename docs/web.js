var __pawWeb = !window.__TAURI__;
// Browser/phone mode: when Tauri is absent, back the db_* commands with IndexedDB (holds photos/PDFs; localStorage is too small).
if (__pawWeb) {
  const open = new Promise((res, rej) => {
    const r = indexedDB.open('pawlog', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('docs');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const run = async (mode, f) => {
    const db = await open, tx = db.transaction('docs', mode), st = tx.objectStore('docs');
    return new Promise((res, rej) => { const q = f(st); tx.oncomplete = () => res(q && q.result); tx.onerror = tx.onabort = () => rej(tx.error); });
  };
  const key = (k, id) => `${k}\u0000${id}`;
  const cmds = {
    db_list: ({ kind }) => run('readonly', (s) => s.getAll(IDBKeyRange.bound(`${kind}\u0000`, `${kind}\u0001`, false, true))),
    db_save: ({ kind, id, data }) => run('readwrite', (s) => s.put(data, key(kind, id))),
    db_delete: ({ kind, id }) => run('readwrite', (s) => s.delete(key(kind, id))),
    db_clear: () => run('readwrite', (s) => s.clear()),
  };
  window.__TAURI__ = { core: { invoke: (c, a) => cmds[c](a || {}) } };
}

// Passcode gate for the public website only (never runs inside the desktop app). Client-side: it keeps casual visitors out;
// the real data protection is still the Supabase login. The code is stored only as a salted PBKDF2 hash.
if (__pawWeb) {
  const SALT = '5b65f2c2fc863560ea36a907622b85bb', HASH = '424332aca2bc22f585e877ec3fb8260dfeb17fb17d416d8f9fa64926cee2dc95', KEY = 'pawlogPass';
  const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const derive = async (code) => {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(code.toLowerCase().replace(/[^a-z]/g, '')), 'PBKDF2', false, ['deriveBits']);
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(SALT.match(/../g).map((x) => parseInt(x, 16))), iterations: 200000 }, k, 256));
  };
  let saved = null; try { saved = localStorage.getItem(KEY); } catch { /* private mode */ }
  if (saved !== HASH) {
    const gate = document.createElement('div');
    gate.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#f4f1fb;display:grid;place-items:center;padding:24px;font:16px -apple-system,system-ui,sans-serif';
    gate.innerHTML = '<form style="width:min(340px,100%);text-align:center"><img src="assets/icon-192.png" width="96" height="96" style="border-radius:22px" alt=""><h2 style="margin:14px 0 4px">Pawlog</h2><p style="margin:0 0 16px;color:#6b6780">Enter your passcode</p><input type="password" autocomplete="off" autocapitalize="none" style="width:100%;box-sizing:border-box;padding:14px;font-size:16px;border:1px solid #d8d3ea;border-radius:12px"><p class="e" style="color:#c0392b;min-height:20px;margin:8px 0"></p><button style="width:100%;padding:14px;font-size:16px;font-weight:600;color:#fff;background:#6244e0;border:0;border-radius:12px">Unlock</button></form>';
    const mount = () => document.body.appendChild(gate);
    document.body ? mount() : document.addEventListener('DOMContentLoaded', mount);
    gate.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      if ((await derive(gate.querySelector('input').value)) === HASH) { try { localStorage.setItem(KEY, HASH); } catch { /* ignore */ } gate.remove(); }
      else gate.querySelector('.e').textContent = 'Wrong passcode';
    };
  }
}
