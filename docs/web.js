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
  const SALT = 'e367e780abe6c90424f0188b8a916620', HASH = '11c71fa045a2d0308e1565025293f34632357446ce57f6990aeb58c6e68975d0', KEY = 'pawlogPass';
  const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const derive = async (code) => {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(code.trim().toLowerCase()), 'PBKDF2', false, ['deriveBits']);
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(SALT.match(/../g).map((x) => parseInt(x, 16))), iterations: 200000 }, k, 256));
  };
  let saved = null; try { saved = localStorage.getItem(KEY); } catch { /* private mode */ }
  if (saved !== HASH) {
    const gate = document.createElement('div');
    gate.style.cssText = 'position:fixed;inset:0;z-index:9999;background:radial-gradient(70% 45% at 15% 0%,rgba(110,80,255,.38),transparent 70%),#08080b;color:#f5f5f7;display:grid;place-items:center;padding:24px;font:16px -apple-system,system-ui,sans-serif';
    gate.innerHTML = '<form style="width:min(340px,100%);text-align:center"><img src="assets/icon-192.png" width="96" height="96" style="border-radius:22px" alt=""><h2 style="margin:14px 0 4px;color:#fff;font-size:26px">Pawlog</h2><p style="margin:0 0 16px;color:rgba(235,235,245,.62)">Enter your passcode</p><input type="password" autocomplete="off" autocapitalize="none" style="width:100%;box-sizing:border-box;height:50px;padding:0 16px;font-size:17px;color:#fff;background:rgba(255,255,255,.1);border:0;box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);border-radius:14px;outline:none;-webkit-appearance:none"><p class="e" style="color:#ff8077;min-height:20px;margin:8px 0"></p><button style="width:100%;height:50px;font-size:17px;font-weight:600;color:#fff;background:#7b5cff;border:0;border-radius:14px">Unlock</button></form>';
    const mount = () => document.body.appendChild(gate);
    document.body ? mount() : document.addEventListener('DOMContentLoaded', mount);
    gate.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      if ((await derive(gate.querySelector('input').value)) === HASH) { try { localStorage.setItem(KEY, HASH); } catch { /* ignore */ } gate.remove(); }
      else gate.querySelector('.e').textContent = 'Wrong passcode';
    };
  }
}
