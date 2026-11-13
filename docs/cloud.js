/* ---------- Pawlog cloud: accounts, shared Pawlogs and sync (Supabase) ----------
   Loaded before app.js; everything here runs later, after app.js has defined S, save(), render(), etc.
   Model: the on-device SQLite cache stays (fast + offline). Supabase is the source of truth.
   Every save/remove is pushed to the `docs` table; a pull on start/focus and Realtime keep other devices current.
   Deletes are tombstones (deleted = true) so they reach other devices. */

const cloud = { on: false, client: null, user: null, household: null, members: [], channel: null, status: '', pendingAvatar: null };
const DIRTY_KEY = 'pawlogDirty', OWNER_KEY = 'pawlogOwner';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
let dirtyMem = null;
const dirty = () => { if (!dirtyMem) { try { dirtyMem = JSON.parse(lsGet(DIRTY_KEY) || '{}'); } catch { dirtyMem = {}; } } return dirtyMem; };
const saveDirty = () => lsSet(DIRTY_KEY, JSON.stringify(dirty()));
const dkey = (kind, id) => `${kind}/${id}`;

const gate = { mode: 'signin', ctx: {}, resolve: null };
const friendly = (e) => {
  const m = (e && e.message) || String(e);
  if (/Invalid login credentials/i.test(m)) return 'That email and password don’t match.';
  if (/Email not confirmed/i.test(m)) return 'Please confirm your email first. Check for the code we sent.';
  if (/rate limit|too many/i.test(m)) return 'Too many tries. Please wait a few minutes and try again.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Can’t reach the internet right now.';
  return m;
};

/* ---------- start-up ---------- */
async function cloudStart() {
  const cfg = window.PAWLOG_CLOUD || {};
  if (!cfg.url || !cfg.anonKey || !window.supabase) { showGate('nocfg'); return new Promise(() => {}); }   // stay gated
  cloud.client = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: __pawWeb, flowType: __pawWeb ? 'implicit' : 'pkce' } });
  cloud.client.auth.onAuthStateChange((evt) => { if (evt === 'SIGNED_OUT' && cloud.on) location.reload(); });   // session revoked/expired elsewhere
  const { data } = await cloud.client.auth.getSession();
  if (!data.session) await new Promise((resolve) => { gate.resolve = resolve; maybeOnboard(false, (to) => showGate(to), () => showGate('signin')); });
  await onSignedIn();
}

async function onSignedIn() {
  const c = cloud.client;
  let user;
  const got = await c.auth.getUser();
  if (got.data && got.data.user) user = got.data.user;
  else { const s = await c.auth.getSession(); user = s.data.session && s.data.session.user; }   // offline start: use the stored session
  if (!user) throw new Error('Could not verify your session. Please sign in again.');
  cloud.user = user;
  const owner = lsGet(OWNER_KEY);
  if (owner && owner !== user.id) await wipeLocal();   // never show one account's cached data to another
  try {
    if (cloud.pendingAvatar) { await c.from('profiles').update({ avatar: cloud.pendingAvatar }).eq('id', user.id); cloud.pendingAvatar = null; }
    await syncAll(!owner);
    lsSet(OWNER_KEY, user.id);
  } catch (e) {
    if (!owner) throw e;              // first sign-in must succeed once
    cloud.status = 'Offline: changes will sync later';   // otherwise run from the cache
  }
  cloud.on = true;
  subscribe();
  window.addEventListener('focus', () => syncAll(false).catch(() => { cloud.status = 'Offline: changes will sync later'; refreshFoot(); }));
  window.addEventListener('online', () => syncAll(false).catch(() => {}));
}

async function wipeLocal() {
  await invoke('db_clear');
  KINDS.forEach((k) => S[k].clear());
  dirtyMem = {}; saveDirty();
}

/* ---------- sync ---------- */
async function syncAll(legacy) {
  const c = cloud.client;
  const { data: hh, error } = await c.rpc('my_household');
  if (error) throw error;
  if (cloud.household && cloud.household !== hh) {          // got removed from / moved to another Pawlog
    await wipeLocal(); ui.petId = 'main';
  }
  cloud.household = hh;
  await flushDirty();
  await pullDocs(legacy);
  await loadMembers();
  cloud.status = '';
  if (typeof afterSync === 'function') afterSync();
}

async function pullDocs(legacy) {
  const c = cloud.client, hh = cloud.household, rows = [];
  for (let from = 0; ; from += 20) {
    const { data, error } = await c.from('docs').select('kind,id,data').eq('household_id', hh).eq('deleted', false).order('kind').order('id').range(from, from + 19);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 20) break;
  }
  const seen = new Set(), pending = dirty();
  for (const r of rows) {
    if (!S[r.kind]) continue;
    seen.add(dkey(r.kind, r.id));
    if (pending[dkey(r.kind, r.id)]) continue;                                  // our newer change is still waiting to upload
    const mine = S[r.kind].get(r.id);
    if (!mine || mine._u !== r.data._u) { S[r.kind].set(r.id, r.data); await invoke('db_save', { kind: r.kind, id: r.id, data: r.data }); }
  }
  for (const kind of KINDS) {
    for (const [id, doc] of [...S[kind]]) {
      if (seen.has(dkey(kind, id)) || pending[dkey(kind, id)]) continue;
      if (legacy) { markDirty(kind, id, 'u'); }                                 // first sign-in: upload what was already on this Mac
      else { S[kind].delete(id); await invoke('db_delete', { kind, id }); }     // someone deleted it elsewhere
    }
  }
  if (legacy) await flushDirty();
}

function markDirty(kind, id, op) { dirty()[dkey(kind, id)] = op; saveDirty(); }

let flushing = false, again = false;
async function flushDirty() {
  if (!cloud.client || !cloud.household) return;
  if (flushing) { again = true; return; }
  flushing = true;
  try {
    do {
      again = false;
      for (const [key, op] of Object.entries(dirty())) {
        const i = key.indexOf('/'), kind = key.slice(0, i), id = key.slice(i + 1);
        const doc = S[kind] && S[kind].get(id);
        const row = { household_id: cloud.household, kind, id, data: op === 'u' && doc ? doc : {}, deleted: !(op === 'u' && doc) };
        const { error } = await cloud.client.from('docs').upsert(row, { onConflict: 'household_id,kind,id' });
        if (error) throw error;
        delete dirty()[key]; saveDirty();
      }
    } while (again);
    cloud.status = '';
  } catch (e) {
    cloud.status = 'Offline: changes will sync later';
  } finally { flushing = false; refreshFoot(); }
}

// Called by save()/remove() in app.js.
function cloudWrite(kind, id, op) {
  if (!cloud.on) return;
  markDirty(kind, id, op);
  flushDirty();
}

/* ---------- live updates ---------- */
function subscribe() {
  if (cloud.channel) cloud.client.removeChannel(cloud.channel);
  cloud.channel = cloud.client.channel('pawlog-docs')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, onRemote)   // RLS limits this to our own Pawlog
    .subscribe();
}
let renderT = 0;
async function onRemote(p) {
  const r = p.new;
  if (!r || r.household_id !== cloud.household || !S[r.kind] || dirty()[dkey(r.kind, r.id)]) return;
  if (r.deleted) { S[r.kind].delete(r.id); await invoke('db_delete', { kind: r.kind, id: r.id }); }
  else { S[r.kind].set(r.id, r.data); await invoke('db_save', { kind: r.kind, id: r.id, data: r.data }); }
  clearTimeout(renderT); renderT = setTimeout(() => { if ($('#modal').hidden) render(); }, 200);
}

async function loadMembers() {
  const c = cloud.client;
  const { data: ms, error } = await c.from('members').select('user_id,role,joined_at').eq('household_id', cloud.household).order('joined_at');
  if (error) throw error;
  const { data: ps } = await c.from('profiles').select('id,username,avatar').in('id', ms.map((m) => m.user_id));
  cloud.members = ms.map((m) => ({ ...m, ...((ps || []).find((p) => p.id === m.user_id) || {}) }));
}
const me = () => cloud.members.find((m) => m.user_id === (cloud.user && cloud.user.id)) || {};
const isOwner = () => me().role === 'owner';

async function switchHousehold() {            // after joining / leaving a shared Pawlog
  await wipeLocal();
  cloud.household = null; ui.petId = 'main';
  await syncAll(false);
  ui.petId = (pets()[0] || {}).id || 'main';
  await ensureDefaults();
}

async function cloudSignOut() {
  try { await flushDirty(); } catch { /* best effort */ }
  cloud.on = false;
  await wipeLocal(); lsSet(OWNER_KEY, null); lsSet('petId', null);
  try { await cloud.client.auth.signOut({ scope: 'local' }); } catch { /* offline: the local session is cleared below */ }
  try { Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
  location.reload();
}

function refreshFoot() {
  const el = $('#syncst');
  if (el) el.textContent = cloud.status || 'Synced';
}

/* ---------- sign-in screen ---------- */
const googleBtn = () => (`<div class="gor"><span>or</span></div><button type="button" class="btn big-btn gbtn" data-g="google"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.6z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.5 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.4a12 12 0 0 0 0 10.8z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.900 4.800 12 4.800z"/></svg>Continue with Google</button>`);
function showGate(mode, ctx = {}) {
  gate.mode = mode; gate.ctx = { ...gate.ctx, ...ctx };
  const e = esc(gate.ctx.email || '');
  const titles = {
    signin: ['Welcome back', 'Sign in to your Pawlog.'],
    signup: ['Create your account', 'Keep your pets in sync on every device and share them with family.'],
    forgot: ['Reset your password', 'Enter your email and we’ll send you a 6-digit code.'],
    reset: ['Check your email', `We sent a 6-digit code to ${e}. Enter it with a new password.`],
    confirm: ['Confirm your email', `We sent a 6-digit code to ${e}.`],
    nocfg: ['One more step', 'Pawlog isn’t connected to a Supabase project yet. Add your project URL and anon key to src/config.js and rebuild. See supabase/SETUP.md.'],
  }[mode];
  const pw = (label, name = 'password', ac = 'current-password') => `<label class="f"><span>${label}</span><input type="password" name="${name}" required minlength="8" autocomplete="${ac}"></label>`;
  const forms = {
    signin: `<label class="f"><span>Email</span><input type="email" name="email" required autocomplete="email" value="${e}"></label>${pw('Password')}
      <button class="btn primary big-btn">Sign in</button>${googleBtn()}
      <div class="gate-links"><button type="button" class="link" data-g="forgot">Forgot password?</button><button type="button" class="link" data-g="signup">Create an account</button></div>`,
    signup: `<div class="photo-edit">${gate.ctx.avatarPrev ? `<img class="photo" src="${gate.ctx.avatarPrev}" id="gAva" alt="">` : `<span class="photo ph" id="gAva">${dogArt('awake')}</span>`}<label class="f" style="margin:0"><span>Profile photo (optional)</span><input type="file" id="gFile" accept="image/*"></label></div>
      <label class="f"><span>Username</span><input name="username" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_]{3,20}" autocomplete="username" placeholder="letters, numbers, underscore" value="${esc(gate.ctx.username || '')}"></label>
      <label class="f"><span>Email</span><input type="email" name="email" required autocomplete="email" value="${e}"></label>${pw('Password (8+ characters)', 'password', 'new-password')}
      <button class="btn primary big-btn">Create account</button>
      <div class="gate-links"><button type="button" class="link" data-g="signin">I already have an account</button></div>`,
    forgot: `<label class="f"><span>Email</span><input type="email" name="email" required autocomplete="email" value="${e}"></label>
      <button class="btn primary big-btn">Send code</button><div class="gate-links"><button type="button" class="link" data-g="signin">Back to sign in</button></div>`,
    reset: `<label class="f"><span>6-digit code</span><input name="code" required inputmode="numeric" pattern="[0-9]{6,8}" autocomplete="one-time-code"></label>${pw('New password (8+ characters)', 'password', 'new-password')}
      <button class="btn primary big-btn">Set new password</button><div class="gate-links"><button type="button" class="link" data-g="signin">Back to sign in</button></div>`,
    confirm: `<label class="f"><span>6-digit code</span><input name="code" required inputmode="numeric" pattern="[0-9]{6,8}" autocomplete="one-time-code"></label>
      <button class="btn primary big-btn">Confirm</button><div class="gate-links"><button type="button" class="link" data-g="resend">Send a new code</button><button type="button" class="link" data-g="signin">Back</button></div>`,
    nocfg: '',
  }[mode];
  const g = $('#gate');
  g.hidden = false;
  g.innerHTML = `<div class="gate-card"><div class="gate-art">${dogArt('awake')}</div><h1>${titles[0]}</h1><p class="muted gate-sub">${titles[1]}</p>
    <form id="gform">${forms}<p class="gmsg" id="gmsg" role="alert"></p></form></div>`;
  const first = g.querySelector('input:not([type=file])'); if (first) first.focus();
}
const gmsg = (t, ok) => { const m = $('#gmsg'); if (m) { m.textContent = t; m.className = 'gmsg' + (ok ? ' ok' : ''); } };

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-g]');
  if (!b) return;
  const f = $('#gform');
  if (f && f.email) gate.ctx.email = f.email.value.trim();
  if (f && f.username) gate.ctx.username = f.username.value.trim();
  if (b.dataset.g === 'resend') {
    const { error } = await cloud.client.auth.resend({ type: 'signup', email: gate.ctx.email });
    return gmsg(error ? friendly(error) : 'A new code is on its way.', !error);
  }
  if (b.dataset.g === 'google') {
    try {
      if (__pawWeb) {
        const { error } = await cloud.client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
        if (error) throw error;
        return;
      }
      // Desktop app: Google refuses embedded webviews, so sign in through the system browser and a loopback redirect.
      gmsg('Finish signing in with Google in your browser…', true);
      const wait = window.__TAURI__.core.invoke('oauth_wait');
      wait.catch(() => {});
      const { data, error } = await cloud.client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: 'http://127.0.0.1:49823/auth', skipBrowserRedirect: true } });
      if (error) throw error;
      await window.__TAURI__.opener.openUrl(data.url);
      const q = new URLSearchParams(await wait);
      if (q.get('error')) throw new Error(q.get('error_description') || q.get('error'));
      const { error: e2 } = await cloud.client.auth.exchangeCodeForSession(q.get('code'));
      if (e2) throw e2;
      $('#gate').hidden = true; $('#gate').innerHTML = ''; gate.resolve && gate.resolve();
    } catch (err) { gmsg(friendly(err)); }
    return;
  }
  showGate(b.dataset.g);
});

document.addEventListener('change', async (e) => {
  if (e.target.id !== 'gFile' || !e.target.files[0]) return;
  try { gate.ctx.avatarPrev = await readImage(e.target.files[0], 256, 0.8); $('#gAva').outerHTML = `<img class="photo" id="gAva" src="${gate.ctx.avatarPrev}" alt="">`; }
  catch (err) { gmsg(err.message); }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'gform') return;
  e.preventDefault();
  const f = e.target, c = cloud.client, btn = f.querySelector('button.primary');
  const v = (n) => (f[n] ? f[n].value.trim() : '');
  btn.disabled = true; gmsg('');
  const done = () => { $('#gate').hidden = true; $('#gate').innerHTML = ''; gate.resolve && gate.resolve(); };
  try {
    if (gate.mode === 'signin') {
      const { error } = await c.auth.signInWithPassword({ email: v('email'), password: f.password.value });
      if (error) throw error;
      return done();
    }
    if (gate.mode === 'signup') {
      const username = v('username'), email = v('email');
      if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw new Error('Username: 3-20 letters, numbers or underscores.');
      const { data: free } = await c.rpc('username_available', { u: username });
      if (free === false) throw new Error('That username is taken. Try another.');
      const { data, error } = await c.auth.signUp({ email, password: f.password.value, options: { data: { username } } });
      if (error) throw error;
      if (data.user && data.user.identities && data.user.identities.length === 0) throw new Error('An account with this email may already exist. Try signing in or resetting your password.');
      cloud.pendingAvatar = gate.ctx.avatarPrev || null;
      gate.ctx.email = email;
      if (data.session) return done();
      return showGate('confirm', { email });
    }
    if (gate.mode === 'confirm') {
      const { error } = await c.auth.verifyOtp({ email: gate.ctx.email, token: v('code'), type: 'signup' });
      if (error) throw error;
      return done();
    }
    if (gate.mode === 'forgot') {
      await c.auth.resetPasswordForEmail(v('email'));           // same answer whether or not the email exists
      return showGate('reset', { email: v('email') });
    }
    if (gate.mode === 'reset') {
      const { error } = await c.auth.verifyOtp({ email: gate.ctx.email, token: v('code'), type: 'recovery' });
      if (error) throw error;
      const up = await c.auth.updateUser({ password: f.password.value });
      if (up.error) throw up.error;
      return done();
    }
  } catch (err) { gmsg(friendly(err)); btn.disabled = false; }
});

/* ---------- Settings: account + sharing ---------- */
function accountHtml() {
  if (!cloud.user) return '';
  const m = me(), mine = m.username || 'You';
  const ava = (x, cls = 'ava') => (x.avatar ? `<img class="${cls}" src="${esc(x.avatar)}" alt="">` : `<span class="${cls} ph">${dogArt('awake')}</span>`);
  const members = cloud.members.map((x) => `<div class="srow">${ava(x)}<span class="value">${esc(x.username || 'Member')}${x.user_id === cloud.user.id ? ' <span class="muted">(you)</span>' : ''}<div class="sub-line">${x.role === 'owner' ? 'Owner' : 'Member'}</div></span>${isOwner() && x.user_id !== cloud.user.id ? `<button class="btn ghost sm" data-act="rm-member" data-id="${x.user_id}">Remove</button>` : ''}</div>`).join('');
  return `
    <section><div class="sect-head"><h3>Account</h3></div><div class="group">
      <div class="profile-top">${ava(m, 'photo sm')}<div class="grow"><div class="big">${esc(mine)}</div><div class="muted">${esc(cloud.user.email || '')}</div></div><button class="btn" data-act="acct-photo">Change photo</button></div>
      <div class="srow" tabindex="0" role="button" data-act="acct-password"><span class="value">Change password</span><span class="go">${ic('chev-right')}</span></div>
      <div class="srow"><span class="value">Welcome tour<div class="sub-line">See the highlights of Pawlog again.</div></span><button class="btn sm" data-act="tour">Take the tour</button></div>
      <div class="srow"><span class="value">Sign out<div class="sub-line">Removes Pawlog data from this device. It stays safe in the cloud.</div></span><button class="btn danger sm" data-act="sign-out">Sign out</button></div>
      <div class="srow"><span class="value">Delete account<div class="sub-line">Permanently deletes your account${cloud.members.length > 1 ? '' : ' and all your pets, logs and photos'}.</div></span><button class="btn danger sm" data-act="delete-account">Delete…</button></div>
    </div></section>
    <section><div class="sect-head"><h3>Shared with</h3>${isOwner() ? '<button class="btn primary sm" data-act="invite">+ Invite</button>' : ''}</div><div class="group">
      ${members}
      <div class="srow" tabindex="0" role="button" data-act="join-hh"><span class="value">Join someone else’s Pawlog<div class="sub-line">Enter a code from your partner or family member.</div></span><span class="go">${ic('chev-right')}</span></div>
      ${isOwner() ? '' : '<div class="srow"><span class="value">Leave this Pawlog<div class="sub-line">You’ll get a fresh, empty Pawlog of your own.</div></span><button class="btn danger sm" data-act="leave-hh">Leave</button></div>'}
    </div></section>`;
}

const cloudActions = {
  'sign-out': () => openModal('Sign out?', '<p class="muted">This removes Pawlog data from this device. Everything stays safe in the cloud and comes back when you sign in again.</p>', () => cloudSignOut(), 'Sign out'),
  'delete-account': () => openModal('Delete account',
    `<p style="margin-bottom:12px">This permanently deletes your login, and it can't be undone.</p>
     <p class="muted" style="margin-bottom:14px">${cloud.members.length > 1 ? 'Your Pawlog is shared, so the pets, logs and photos stay with the other members. You just lose access.' : 'You are the only person in this Pawlog, so <b>all of your pets, logs, photos and health records will be deleted for good</b>.'}</p>` +
    field('Type DELETE to confirm', `<input name="confirm" autocomplete="off" autocapitalize="characters" placeholder="DELETE">`),
    async (f) => {
      if (f.get('confirm').trim() !== 'DELETE') throw new Error('Type DELETE (in capitals) to confirm.');
      const { error } = await cloud.client.rpc('delete_account');
      if (error) throw error;
      cloud.on = false;
      await wipeLocal(); lsSet(OWNER_KEY, null); lsSet('petId', null);
      try { await cloud.client.auth.signOut(); } catch { /* account is already gone */ }
      location.reload();
    }, 'Delete my account'),
  'acct-photo': () => openModal('Profile photo',
    `<div class="f"><span>Choose a photo</span><input type="file" name="photo" accept="image/*" required></div>`,
    async (f) => {
      const file = f.get('photo');
      if (!file || !file.size) throw new Error('Choose a photo');
      const avatar = await readImage(file, 256, 0.8);
      const { error } = await cloud.client.from('profiles').update({ avatar }).eq('id', cloud.user.id);
      if (error) throw error;
      await loadMembers();
    }),
  'acct-password': () => openModal('Change password',
    field('New password (8+ characters)', `<input type="password" name="pw" required minlength="8" autocomplete="new-password">`),
    async (f) => {
      const { error } = await cloud.client.auth.updateUser({ password: f.get('pw') });
      if (error) throw error;
    }),
  invite: async () => {
    const { data, error } = await cloud.client.rpc('create_invite');
    if (error) throw error;
    openModal('Invite someone',
      `<p class="muted">Give this code to your partner or family member. They enter it under <b>Settings → Join someone else’s Pawlog</b>. It works once and expires in 7 days.</p><div class="invite-code">${esc(data)}</div><button type="button" class="btn" data-act="copy-code" data-v="${esc(data)}">Copy code</button>`,
      null);
  },
  'copy-code': async (el, _, v) => { try { await navigator.clipboard.writeText(v); el.textContent = 'Copied'; } catch { el.textContent = 'Select and copy the code above'; } },
  'join-hh': () => openModal('Join a Pawlog',
    `<p class="muted" style="margin-bottom:14px">You’ll see and edit the same pets, logs and photos as the person who invited you. If you’ve added pets of your own and you’re the only one in your Pawlog, they will be removed.</p>` +
    field('Invite code', `<input name="code" required maxlength="8" autocapitalize="characters" autocomplete="off" style="text-transform:uppercase;letter-spacing:.2em;font-size:18px">`),
    async (f) => {
      const { error } = await cloud.client.rpc('join_household', { p_code: f.get('code') });
      if (error) throw error;
      await switchHousehold();
    }, 'Join'),
  'rm-member': (el, id) => openModal('Remove this person?', '<p class="muted">They will lose access to this Pawlog.</p>', async () => {
    const { error } = await cloud.client.from('members').delete().eq('household_id', cloud.household).eq('user_id', id);
    if (error) throw error;
    await loadMembers();
  }, 'Remove'),
  'leave-hh': () => openModal('Leave this Pawlog?', '<p class="muted">You will go back to your own private Pawlog.</p>', async () => {
    const { error } = await cloud.client.rpc('leave_household');
    if (error) throw error;
    await switchHousehold();
  }, 'Leave'),
};
