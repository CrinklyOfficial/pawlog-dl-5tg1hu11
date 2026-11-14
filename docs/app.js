const { invoke } = window.__TAURI__.core;

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const diffDays = (a, b) => Math.round((parseYmd(a) - parseYmd(b)) / 86400000);
const fmtDate = (s) => (s ? parseYmd(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const fmtTime = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
const fmtTs = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dayOf = (iso) => ymd(new Date(iso));
const stamp = (day, time) => new Date(`${day}T${time || '12:00'}`).toISOString();
const field = (label, input) => `<label class="f"><span>${label}</span>${input}</label>`;
const FAR = '9999-12-31';
const ageAt = (dob, day) => {
  if (!dob || day < dob) return '';
  const d = parseYmd(dob), x = parseYmd(day);
  let m = (x.getFullYear() - d.getFullYear()) * 12 + x.getMonth() - d.getMonth();
  if (x.getDate() < d.getDate()) m--;
  if (m < 1) { const w = Math.floor((x - d) / 604800000); return w < 1 ? 'Newborn' : `${w} week${w === 1 ? '' : 's'} old`; }
  if (m < 24) return `${m} month${m === 1 ? '' : 's'} old`;
  const y = Math.floor(m / 12); return `${y} year${y > 1 ? 's' : ''} old`;
};
const ago = (iso) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m ago` : `${Math.floor(m / 1440)}d ago`; };

function ageText(dob) {
  if (!dob) return '—';
  const d = parseYmd(dob), now = new Date();
  let m = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) m--;
  if (m < 0) return 'Not born yet';
  const anchor = new Date(d.getFullYear(), d.getMonth() + m, d.getDate());
  const w = Math.floor((now - anchor) / 86400000 / 7);
  return `${m} month${m === 1 ? '' : 's'}, ${w} week${w === 1 ? '' : 's'}`;
}

function readImage(file, max, q = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = url;
  });
}

function parseTimes(s) {
  return s.split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = x.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!m) throw new Error(`Can't read the time "${x}". Try 9:00 AM or 16:30`);
    let h = +m[1]; const min = +(m[2] || 0); const ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || min > 59) throw new Error(`Bad time "${x}"`);
    return `${pad(h)}:${pad(min)}`;
  }).sort();
}

/* ---------- static data ---------- */
const BUILTIN = [
  { id: 'pee', name: 'Pee', icon: 'droplet', detail: false },
  { id: 'poop', name: 'Poop', icon: 'circle', detail: false },
  { id: 'meal', name: 'Meal', icon: 'utensils', detail: false },
  { id: 'water', name: 'Water', icon: 'cup', detail: 'level' },
  { id: 'nap', name: 'Nap', icon: 'moon', detail: false },
  { id: 'activity', name: 'Activity', icon: 'activity', detail: false },
  { id: 'medication', name: 'Medication', icon: 'pill', detail: 'note' },
];

const TABS = ['dashboard', 'todo', 'calendar', 'notes'];   // phone bottom bar; everything else lives under More
const NAV_SECTIONS = { dashboard: 'Overview', log: 'Track', gallery: 'Memories', health: 'Health', supplies: 'Manage' };
const PAGES = [
  ['dashboard', 'home', 'Dashboard'],
  ['todo', 'list-check', 'To-do'],
  ['calendar', 'calendar', 'Calendar'],
  ['notes', 'note', 'Notes'],
  ['log', 'notebook', 'Daily Log'],
  ['care', 'check-square', 'Care Tasks'],
  ['training', 'graduation', 'Training'],
  ['gallery', 'image', 'Gallery'],
  ['health', 'plus-square', 'Health & Vet'],
  ['supplies', 'cart', 'Supplies'],
  ['settings', 'settings', 'Settings'],
];

const SHOT_INFO = {
  rabies: 'Protects against rabies, a deadly virus spread through bites from infected animals. It is required by law in most places. The first dose is usually given around 12 to 16 weeks old.',
  dhpp: 'A combination shot that protects against four serious diseases: distemper, hepatitis, parvovirus and parainfluenza. Puppies get a short series of doses, usually 3 to 4 weeks apart, until about 16 weeks old.',
  bordetella: 'Protects against the bacteria that cause kennel cough, a contagious cough that spreads wherever many dogs meet, like boarding, grooming and dog parks.',
  lepto: 'Protects against leptospirosis, a bacterial infection spread through urine and standing water. It can damage the kidneys and liver.',
  influenza: 'Protects against canine influenza (dog flu), a contagious respiratory virus that spreads easily between dogs in groups.',
  lyme: 'Protects against Lyme disease, which ticks spread. Usually recommended in areas with lots of ticks. Ask your vet if it fits your dog.',
};
const RECOMMENDED = [
  { name: 'Rabies', key: 'rabies' },
  { name: 'DHPP', key: 'dhpp' },
  { name: 'Bordetella', key: 'bordetella' },
  { name: 'Leptospirosis', key: 'lepto' },
  { name: 'Canine Influenza', key: 'influenza' },
  { name: 'Lyme', key: 'lyme' },
];
const keyOf = (name) => Object.keys(SHOT_INFO).find((k) => name.toLowerCase().includes(k));
const shotAbout = (name) => { const k = keyOf(name || ''); return k ? SHOT_INFO[k] : ''; };

const SUPPLY_ICONS = ['🦴', '🧸', '🎾', '🛏️', '🥣', '🚰', '🧴', '🪮', '✂️', '🦮', '🎒', '🛁', '🧼', '💊', '🧻', '🪥', '🍗', '🥕', '🧽', '🔔', '🎀', '🧥', '🪢', '🏠', '🚗', '📦'];

/* ---------- icons (one outline set, decorative by default) ---------- */
const ICON = {
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  'list-check': '<path d="M10 6h11M10 12h11M10 18h11"/><path d="m3 6 1.5 1.5L7 4.5M3 12l1.5 1.5L7 10.5M3 18l1.5 1.5L7 16.5"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  notebook: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  'check-square': '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
  'plus-square': '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/>',
  graduation: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1 2.7 3 6 3s6-2 6-3v-5"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.2a1 1 0 0 0 1 .8h10.4a1 1 0 0 0 1-.8L22 7H6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  droplet: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
  circle: '<circle cx="12" cy="12" r="7"/>',
  utensils: '<path d="M4 3v7a3 3 0 0 0 6 0V3M7 3v18M17 21V3c-2 1-3 3-3 6s1 4 3 4"/>',
  cup: '<path d="M6 3h12l-1.5 18h-9z"/><path d="M6.5 9h11"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  activity: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 4 3 14 0 18M12 3c-3 4-3 14 0 18"/>',
  pill: '<path d="m10.5 20.5 10-10a4.9 4.9 0 0 0-7-7l-10 10a4.9 4.9 0 0 0 7 7z"/><path d="m8.5 8.5 7 7"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  paw: '<circle cx="6" cy="10" r="2"/><circle cx="10" cy="5" r="2"/><circle cx="14" cy="5" r="2"/><circle cx="18" cy="10" r="2"/><path d="M8 17c0-3 2-5 4-5s4 2 4 5c0 1.5-1.5 2-4 2s-4-.5-4-2z"/>',
  'chev-left': '<path d="M15 18l-6-6 6-6"/>',
  'chev-right': '<path d="M9 18l6-6-6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  scale: '<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  'chev-down': '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
};
const ic = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON[name] || ICON.box}</svg>`;

const TYPE_COLOR = { pee: '#ffd60a', poop: '#c49a6c', meal: '#32d74b', water: '#64b5ff', nap: '#7d7aff', activity: '#ff9f0a', medication: '#ff6482' };
const typeColor = (id) => TYPE_COLOR[id] || '#bf5af2';
const glyph = (t, sm) => `<span class="glyph${sm ? ' sm' : ''}" style="--c:${typeColor(t.id)}">${ic(t.icon)}</span>`;
/* ---------- greeting and Toby's mood ---------- */
const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night'; };

const MOODS = {
  sleeping: { label: 'Sleeping', icon: 'moon', msgs: ["Zzz… shhh, I'm napping", 'Zzz… dreaming of treats', 'Zzz… five more minutes'] },
  eating: { label: 'Eating', icon: 'utensils', msgs: ['Nom nom nom!', 'Yum! Best meal ever', 'Crunch crunch crunch'] },
  playing: { label: 'Playing', icon: 'activity', msgs: ["Wheee! Let's play!", 'Zoomies time!', 'Throw the ball!'] },
  awake: { label: 'Awake', icon: 'sun', msgs: ["I'm awake! Hi!", 'Is it snack time yet?', 'Who wants to hang out?'] },
};
// Most recent of: meal (25 min), activity (45 min), nap (90 min). Otherwise asleep overnight, awake by day.
function dogMood() {
  const mins = (iso) => (Date.now() - new Date(iso).getTime()) / 60000;
  const latest = (type, within) => all('log').filter((l) => l.type === type && mins(l.ts) >= 0 && mins(l.ts) <= within).sort((a, b) => b.ts.localeCompare(a.ts))[0];
  const hits = [['eating', latest('meal', 25)], ['playing', latest('activity', 45)], ['sleeping', latest('nap', 90)]].filter((x) => x[1]).sort((a, b) => b[1].ts.localeCompare(a[1].ts));
  const h = new Date().getHours();
  return hits.length ? hits[0][0] : h >= 22 || h < 6 ? 'sleeping' : 'awake';
}
function statusLine() {
  const n = profile().name || 'Your dog', mood = dogMood(), h = new Date().getHours();
  if (mood === 'sleeping') return `${n} is napping`;
  if (mood === 'eating') return `${n} is eating`;
  if (mood === 'playing') return `${n} is playing`;
  const walked = all('log').some((l) => l.type === 'activity' && Date.now() - new Date(l.ts).getTime() < 4 * 3600e3);
  return h >= 7 && h < 20 && !walked ? `${n} is ready for a walk` : `${n} is awake and happy`;
}

function heroArt() {
  const mood = dogMood(), m = MOODS[mood], pr = profile();
  const custom = (pr.say || '').trim();
  return `<button type="button" class="bubble" data-act="edit-say" title="Change what ${esc(pr.name || 'your dog')} says"><b>${custom ? esc(pr.name || 'Says') : m.label}</b>${custom ? esc(custom) : esc(m.msgs[new Date().getHours() % m.msgs.length])}</button>${dogArt(mood)}`;
}

/* ---------- custom illustrations ---------- */
function dogArt(mood) {
  const happy = mood === 'sleeping' || mood === 'eating';
  const eyes = happy
    ? `<path class="inks" d="M68 84q10-11 20 0M132 84q10-11 20 0"/>`
    : `<circle class="ink" cx="78" cy="82" r="8"/><circle class="ink" cx="142" cy="82" r="8"/><circle class="hl" cx="81" cy="79" r="2.8"/><circle class="hl" cx="145" cy="79" r="2.8"/>`;
  const sleepEyes = mood === 'sleeping' ? `<path class="inks" d="M68 82q10 10 20 0M132 82q10 10 20 0"/>` : eyes;
  const tongue = mood === 'awake' || mood === 'playing' ? `<path class="pink" d="M103 119q7 17 14 0z"/>` : '';
  const extra = {
    sleeping: `<text class="zz" x="168" y="46">z</text><text class="zz" x="184" y="28" style="font-size:15px">z</text><text class="zz" x="196" y="14" style="font-size:11px">z</text>`,
    eating: `<path class="acc" d="M56 168h108q-6 26-54 26t-54-26z"/><ellipse class="acc2" cx="110" cy="168" rx="54" ry="9"/><ellipse class="fur2" cx="110" cy="167" rx="44" ry="5.5"/><circle class="fur" cx="90" cy="165" r="4"/><circle class="fur" cx="108" cy="163" r="4"/><circle class="fur" cx="127" cy="165" r="4"/>`,
    playing: `<circle cx="186" cy="156" r="18" fill="#c9e04b"/><path d="M170 148q16 6 32 0M170 164q16-6 32 0" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>`,
    awake: '',
  }[mood] || '';
  return `<svg class="art" viewBox="0 0 220 196" aria-hidden="true">
    <ellipse class="fur" cx="110" cy="176" rx="64" ry="40"/>
    <g transform="${mood === 'sleeping' ? 'rotate(-4 110 150)' : ''}">
      <ellipse class="fur2" cx="52" cy="98" rx="21" ry="40" transform="rotate(10 52 98)"/>
      <ellipse class="fur2" cx="168" cy="98" rx="21" ry="40" transform="rotate(-10 168 98)"/>
      <circle class="fur" cx="110" cy="90" r="56"/>
      <circle class="fur" cx="86" cy="40" r="15"/><circle class="fur" cx="110" cy="34" r="17"/><circle class="fur" cx="134" cy="40" r="15"/>
      <ellipse class="cream" cx="110" cy="110" rx="32" ry="23"/>
      <ellipse class="pink" cx="66" cy="104" rx="8" ry="6" opacity=".35"/><ellipse class="pink" cx="154" cy="104" rx="8" ry="6" opacity=".35"/>
      ${sleepEyes}
      <ellipse class="ink" cx="110" cy="99" rx="11" ry="7.5"/><ellipse class="hl" cx="106" cy="96.5" rx="3.5" ry="1.8" opacity=".6"/>
      <path class="inks" d="M110 106v9M110 115q-9 8-19 2M110 115q9 8 19 2"/>
      ${tongue}
    </g>
    ${extra}
  </svg>`;
}

const SPOT = {
  bone: `<g transform="rotate(-28 48 48)"><rect class="cream" x="22" y="40" width="52" height="16" rx="8"/><circle class="cream" cx="22" cy="40" r="9"/><circle class="cream" cx="22" cy="56" r="9"/><circle class="cream" cx="74" cy="40" r="9"/><circle class="cream" cx="74" cy="56" r="9"/></g><path class="acc2" d="M74 18l2.4 6 6 2.4-6 2.4L74 35l-2.4-6.2-6-2.4 6-2.4z"/>`,
  calendar: `<rect class="soft" x="14" y="20" width="68" height="62" rx="12"/><path class="acc" d="M14 32a12 12 0 0 1 12-12h44a12 12 0 0 1 12 12v6H14z"/><circle class="cream" cx="48" cy="64" r="8"/><circle class="cream" cx="35" cy="54" r="4"/><circle class="cream" cx="44" cy="48" r="4"/><circle class="cream" cx="53" cy="48" r="4"/><circle class="cream" cx="62" cy="54" r="4"/>`,
  clipboard: `<rect class="soft" x="22" y="16" width="52" height="68" rx="10"/><rect class="acc" x="34" y="10" width="28" height="14" rx="6"/><path class="softs" d="M34 44h28M34 58h18"/><circle class="acc2" cx="62" cy="68" r="11"/><path d="m57 68 4 4 7-8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  cap: `<path class="acc" d="M48 22 88 40 48 58 8 40z"/><path class="acc2" d="M26 50v14q22 14 44 0V50L48 60z"/><path class="fur" d="M84 43v22"/><circle class="fur" cx="84" cy="68" r="4"/>`,
  bag: `<path class="soft" d="M20 34h56l4 46a6 6 0 0 1-6 6H22a6 6 0 0 1-6-6z"/><path class="softs" d="M34 34v-6a14 14 0 0 1 28 0v6"/><circle class="fur" cx="48" cy="62" r="8"/><circle class="fur" cx="35" cy="52" r="4"/><circle class="fur" cx="44" cy="46" r="4"/><circle class="fur" cx="53" cy="46" r="4"/><circle class="fur" cx="62" cy="52" r="4"/>`,
  camera: `<rect class="soft" x="12" y="28" width="72" height="52" rx="12"/><path class="acc" d="M34 28l4-8h20l4 8z"/><circle class="cream" cx="48" cy="54" r="17"/><circle class="acc" cx="48" cy="54" r="10"/><circle class="hl" cx="44" cy="50" r="3"/><circle class="fur" cx="72" cy="38" r="3"/>`,
  heart: `<path class="acc" d="M48 80S14 58 14 36a17 17 0 0 1 34-4 17 17 0 0 1 34 4c0 22-34 44-34 44z"/><path d="M22 50h14l6-12 8 22 6-10h14" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`,
};
const spot = (name) => `<svg class="art spot" viewBox="0 0 96 96" aria-hidden="true">${SPOT[name]}</svg>`;
const blank = (art, title, sub = '') => `<div class="blank">${spot(art)}<p>${title}</p>${sub ? `<span>${sub}</span>` : ''}</div>`;

/* ---------- state + storage ---------- */
const KINDS = ['photo', 'profile', 'category', 'event', 'log', 'trackType', 'task', 'careLog', 'shot', 'weight', 'vetNote', 'vet', 'training', 'session', 'supply'];
const S = Object.fromEntries(KINDS.map((k) => [k, new Map()]));
const PET_KINDS = new Set(['event', 'log', 'task', 'careLog', 'shot', 'weight', 'vetNote', 'training', 'session', 'supply', 'photo']);
const petOf = (r) => r.pet || 'main';   // records saved before multi-pet belong to the first pet
const allRaw = (k) => [...S[k].values()];
const all = (k) => (PET_KINDS.has(k) ? allRaw(k).filter((r) => petOf(r) === ui.petId) : allRaw(k));
const pets = () => allRaw('profile').sort((a, b) => (a.id === 'main' ? -1 : b.id === 'main' ? 1 : (a.order || 0) - (b.order || 0)));
const get = (k, id) => S[k].get(id);
const now = new Date();
const ui = {
  page: 'dashboard',
  petId: 'main',
  petMenu: false,
  calMonth: new Date(now.getFullYear(), now.getMonth(), 1),
  selDay: today(),
  logDay: today(),
  calSort: 'time',
  hiddenCats: new Set(),
  openAbout: new Set(),
};

async function save(kind, obj) {
  obj.id ??= crypto.randomUUID();
  if (PET_KINDS.has(kind)) obj.pet ??= ui.petId;
  obj._u = Date.now();
  S[kind].set(obj.id, obj);
  await invoke('db_save', { kind, id: obj.id, data: obj });
  cloudWrite(kind, obj.id, 'u');
  return obj;
}
async function remove(kind, id) {
  S[kind].delete(id);
  await invoke('db_delete', { kind, id });
  cloudWrite(kind, id, 'd');
}

const profile = () => get('profile', ui.petId) || {};
const vet = () => get('vet', ui.petId) || {};
const avatar = (p, cls = '', attrs = '') => (p.photo
  ? `<img class="${cls}" src="${esc(p.photo)}" alt="" ${attrs}>`
  : `<span class="${cls} ph" ${attrs}>${dogArt('awake')}</span>`);
function setPet(id) {
  ui.petId = id; ui.petMenu = false; ui.logDay = today(); ui.selDay = today();
  try { localStorage.setItem('petId', id); } catch { /* remembered next time if storage works */ }
  playEnter();
}
const armed = (el, label) => { if (el.dataset.armed) return true; el.dataset.armed = '1'; el.textContent = label; return false; };
const cats = () => all('category');
const catOf = (id) => get('category', id) || { name: 'Other', color: '#94a3b8', key: 'other' };
const allTypes = () => [...BUILTIN, ...all('trackType').map((t) => ({ ...t, icon: 'star', detail: 'note' }))];
const typeInfo = (id) => allTypes().find((t) => t.id === id) || { id, name: 'Removed tracker', icon: 'star', detail: false };
const weights = () => all('weight').sort((a, b) => b.date.localeCompare(a.date) || (b.at || 0) - (a.at || 0));
const evSort = (a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''));
const sessionsOn = (trainingId, day) => all('session').filter((s) => s.trainingId === trainingId && dayOf(s.ts) === day);

function eventsOn(day) {
  const byCat = ui.calSort === 'category';
  const order = (id) => cats().findIndex((c) => c.id === id);
  return all('event')
    .filter((e) => e.date === day && !ui.hiddenCats.has(e.category))
    .sort((a, b) => (byCat ? order(a.category) - order(b.category) : 0) || evSort(a, b));
}

const taskDays = (t) => all('careLog').filter((c) => c.taskId === t.id).map((c) => dayOf(c.ts)).sort();
const lastDone = (t) => taskDays(t).at(-1) || null;
const doneToday = (t) => taskDays(t).includes(today());
const nextDue = (t) => { const l = lastDone(t); return l ? addDays(l, t.everyDays) : today(); };

function shotStatus(s) {
  if (!s.next) return s.given ? { text: 'Given', cls: 'ok' } : { text: 'No dates yet', cls: '' };
  const d = diffDays(s.next, today());
  if (d < 0) return { text: `Overdue ${-d}d`, cls: 'bad' };
  if (d <= 30) return { text: `Due in ${d}d`, cls: 'warn' };
  return { text: 'Up to date', cls: 'ok' };
}

/* ---------- seed + boot ---------- */
async function ensureDefaults() {
  if (S.category.size) return;
  for (const [name, color, key] of [['Vet', '#f43f5e', 'vet'], ['Grooming', '#0ea5e9', 'grooming'], ['Training', '#22c55e', 'training'], ['Play', '#f59e0b', 'play'], ['Other', '#94a3b8', 'other']]) {
    await save('category', { id: 'cat-' + key, name, color, key });   // fixed ids: two devices seeding at once can't duplicate
  }
}

// Runs after every cloud sync (start, focus, joining a shared Pawlog).
function afterSync() {
  if (!get('profile', ui.petId) && pets().length) ui.petId = pets()[0].id;
  if (typeof render === 'function' && $('#view').innerHTML) render();
}

async function boot() {
  await Promise.all(KINDS.map(async (k) => (await invoke('db_list', { kind: k })).forEach((r) => S[k].set(r.id, r))));
  await cloudStart();                       // sign-in screen, then first sync
  await ensureDefaults();
  try { const sp = localStorage.getItem('petId'); if (sp && S.profile.has(sp)) ui.petId = sp; } catch { /* default pet */ }
  afterSync();
  let collapsed = false;
  try { collapsed = localStorage.getItem('sbCollapsed') === '1'; } catch { /* default expanded */ }
  setSidebar(collapsed);
  render(); playEnter();
  if (!pets().length) openProfileModal(true);
  purgeDay = today(); purgeOldLogs().then(() => { if (ui.page === 'log' || ui.page === 'dashboard') render(); });
  checkUpdate();
}

/* ---------- auto-update (Tauri updater; silently skipped when offline or in a plain browser) ---------- */
async function checkUpdate() {
  try {
    const up = await window.__TAURI__.updater.check();
    if (!up) return;
    const b = document.createElement('div');
    b.className = 'updbar';
    b.innerHTML = `<span>Pawlog ${esc(up.version)} is ready</span><button>Update now</button>`;
    b.querySelector('button').onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = 'Updating…';
      try { await up.downloadAndInstall(); await window.__TAURI__.process.relaunch(); }
      catch { e.target.disabled = false; e.target.textContent = 'Retry'; }
    };
    document.body.appendChild(b);
  } catch { /* no update info available */ }
}

/* ---------- shared row/chip builders ---------- */
const lastOf = (id) => all('log').filter((l) => l.type === id).sort((a, b) => b.ts.localeCompare(a.ts))[0];
const typeBtn = (t) => { const l = lastOf(t.id); return `<button class="type" data-act="quick" data-id="${t.id}">${glyph(t)}<span>${esc(t.name)}</span><span class="ta">${l ? ago(l.ts) : 'not yet'}</span></button>`; };
function entryRow(l, del = false) {
  const t = typeInfo(l.type);
  const extra = [l.level, l.note].filter(Boolean).join(' · ');
  return `<div class="entry"><span class="time">${fmtTs(l.ts)}</span><span class="tl">${glyph(t, true)}${esc(t.name)}</span><span class="grow muted">${esc(extra)}</span>${del ? `<button class="x" aria-label="Remove" data-act="del-log" data-id="${l.id}">${ic('x')}</button>` : ''}</div>`;
}
const evChip = (e) => {
  const c = catOf(e.category).color;
  return `<div class="ev" data-act="edit-event" data-id="${e.id}" style="background:${c}33;border-left:3px solid ${c}">${e.time ? `<b>${fmtTime(e.time)}</b> ` : ''}${esc(e.title)}</div>`;
};
function eventRow(e) {
  const c = catOf(e.category);
  return `<div class="entry" tabindex="0" role="button" data-act="edit-event" data-id="${e.id}"><span class="dot" style="background:${c.color}"></span><span class="grow">${esc(e.title)}<div class="muted small">${esc(c.name)}${e.notes ? ' · ' + esc(e.notes) : ''}</div></span><span class="muted small">${fmtDate(e.date)}${e.time ? ' · ' + fmtTime(e.time) : ''}</span></div>`;
}

/* ---------- pages ---------- */
const careTasks = () => all('task').filter((k) => !k.todo);
const PRIO = { high: 'High', med: 'Medium', low: 'Low' };
const PRIO_ORDER = { high: 0, med: 1, low: 2 };

function todoView() {
  const t = today(), shared = cloud.members.length > 1;
  const by = (k) => { const m = shared && k.by && cloud.members.find((x) => x.user_id === k.by); return m ? `<span class="by">Added by ${esc(m.username || 'Member')}</span>` : ''; };
  const items = all('task').filter((k) => k.todo);
  const cmp = (a, b) => a.due.localeCompare(b.due) || PRIO_ORDER[a.prio] - PRIO_ORDER[b.prio] || (a.time || '').localeCompare(b.time || '');
  const pcmp = (a, b) => PRIO_ORDER[a.prio] - PRIO_ORDER[b.prio] || (a.time || '').localeCompare(b.time || '');
  const row = (k) => {
    const late = !k.done && k.due < t;
    const when = k.due === t ? (k.time ? fmtTime(k.time) : 'Today') : (late ? 'Overdue · ' : '') + fmtDate(k.due) + (k.time ? ' · ' + fmtTime(k.time) : '');
    return `<div class="todo p-${k.prio}${k.done ? ' done' : ''}"><input type="checkbox" class="tick" data-act="toggle-todo" data-id="${k.id}" aria-label="Done" ${k.done ? 'checked' : ''}>
      <button type="button" class="todo-name" data-act="edit-todo" data-id="${k.id}"><span>${esc(k.name)}</span>${by(k)}</button>
      <span class="when${late ? ' late' : ''}">${when}</span><span class="prio ${k.prio}">${PRIO[k.prio]}</span>${k.done ? `<button class="x" aria-label="Delete" data-act="del-todo-row" data-id="${k.id}">${ic('x')}</button>` : ''}</div>`;
  };
  const open = items.filter((k) => !k.done);
  const groups = [
    ['Overdue', open.filter((k) => k.due < t).sort(cmp)],
    ['Today', open.filter((k) => k.due === t).sort(pcmp)],
    ['Coming up', open.filter((k) => k.due > t).sort(cmp)],
    ['Done', items.filter((k) => k.done).sort((a, b) => (b.doneDay || '').localeCompare(a.doneDay || ''))],
  ].filter(([, l]) => l.length);
  return `<div class="row end"><span class="muted">${open.length ? open.length + ' to do' : 'All done'}</span><button class="btn primary sm" data-act="new-todo">+ New to-do</button></div>
  ${groups.length ? groups.map(([h, l]) => `<div class="card"><div class="row between"><h3 class="sub" style="margin:0">${h}</h3>${h === 'Done' ? '<button class="btn ghost sm" data-act="clear-done">Clear completed</button>' : ''}</div>${l.map(row).join('')}</div>`).join('') : `<div class="card">${blank('clipboard', 'Nothing to do', 'Add a to-do and pick when it needs to be done.')}</div>`}`;
}

function openSayModal() {
  const pr = profile();
  openModal(`What ${esc(pr.name || 'your dog')} says`,
    field('Message', `<input name="say" maxlength="80" value="${esc(pr.say || '')}" placeholder="Leave empty to use the automatic messages">`),
    async (f) => save('profile', { ...pr, say: f.get('say').trim() }), 'Save',
    pr.say ? `<button type="button" class="btn ghost" data-act="reset-say">Use automatic</button>` : '');
}

function notesView() {
  const shared = cloud.members.length > 1, t = today();
  const list = all('vetNote').filter((n) => n.kind === 'note').sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
  const dayLabel = (d) => (d === t ? 'Today' : diffDays(t, d) === 1 ? 'Yesterday' : fmtDate(d));
  const days = [...new Set(list.map((n) => n.date))];
  const card = (n) => {
    const m = shared && n.by && cloud.members.find((x) => x.user_id === n.by);
    return `<button type="button" class="note" data-act="edit-pnote" data-id="${n.id}">
      <div class="row between"><b class="nt">${esc(n.title || 'Note')}</b>${n.time ? `<span class="pill">${ic('clock')} ${fmtTime(n.time)}</span>` : ''}</div>
      ${n.text ? `<p>${esc(n.text)}</p>` : ''}${m ? `<span class="by">${esc(m.username || 'Member')}</span>` : ''}</button>`;
  };
  return `<div class="row end"><span class="muted">${list.length} note${list.length === 1 ? '' : 's'}</span><button class="btn primary sm" data-act="new-pnote">+ New note</button></div>
  ${days.length ? days.map((d) => `<h3 class="daylbl">${dayLabel(d)}</h3><div class="notes">${list.filter((n) => n.date === d).map(card).join('')}</div>`).join('')
    : `<div class="card">${blank('clipboard', 'No notes yet', `Jot down anything about ${esc(profile().name || 'your dog')}: a reminder, how the day went, or something to tell the vet.`)}</div>`}`;
}

function openNoteEdit(id) {
  const n = id ? get('vetNote', id) : { date: today(), time: '', title: '', text: '' };
  openModal(id ? 'Edit note' : 'New note',
    field('Title (optional)', `<input name="title" maxlength="80" value="${esc(n.title || '')}" placeholder="e.g. Ate grass, Trainer tips">`) +
    field('Note', `<textarea name="text" rows="6" required>${esc(n.text || '')}</textarea>`) +
    field('Date', `<input type="date" name="date" required value="${n.date}">`) +
    field('Time (optional)', `<input type="time" name="time" value="${n.time || ''}">`),
    async (f) => {
      const text = f.get('text').trim(), title = f.get('title').trim();
      if (!text && !title) throw new Error('Write something first');
      await save('vetNote', { ...n, kind: 'note', by: n.by || (cloud.user && cloud.user.id) || '', title, text, date: f.get('date'), time: f.get('time') || '' });
    }, 'Save', id ? `<button type="button" class="btn danger" data-act="del-note" data-id="${id}">Delete</button>` : '');
}

function openTodoModal(id) {
  const k = id ? get('task', id) : { due: today(), time: '', prio: 'med', name: '' };
  const radios = Object.entries(PRIO).map(([v, l]) => `<label class="pr ${v}"><input type="radio" name="prio" value="${v}" ${k.prio === v ? 'checked' : ''}><span>${l}</span></label>`).join('');
  openModal(id ? 'Edit to-do' : 'New to-do',
    field('What needs doing?', `<input name="name" required maxlength="120" value="${esc(k.name)}" placeholder="e.g. Pick up flea medicine">`) +
    field('Due date', `<input type="date" name="due" required value="${k.due}">`) +
    field('Time (optional)', `<input type="time" name="time" value="${k.time || ''}">`) +
    field('Priority', `<div class="prios">${radios}</div>`),
    async (f) => {
      const name = f.get('name').trim();
      if (!name) throw new Error('Enter what needs doing');
      await save('task', { ...k, by: k.by || (cloud.user && cloud.user.id) || '', todo: true, name, due: f.get('due'), time: f.get('time') || '', prio: f.get('prio') || 'med', done: !!k.done, everyDays: 1 });
    }, 'Save', id ? `<button type="button" class="btn danger" data-act="del-todo" data-id="${id}">Delete</button>` : '');
}

/* ---------- Home: full-screen hero + reorderable blocks (phone) ---------- */
const HOME_KEYS = ['quick', 'today', 'care', 'upcoming', 'recent', 'sofar', 'health', 'training', 'memories'];
function homeOrder() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem('pawlogHome') || '[]'); } catch { /* storage unavailable: default order */ }
  const keys = [...saved.filter((k) => HOME_KEYS.includes(k)), ...HOME_KEYS.filter((k) => !saved.includes(k))];
  return Object.fromEntries(keys.map((k, i) => [k, i]));
}
const hb = (key, html, ord) => (html ? `<div class="hb" data-hb="${key}" style="order:${ord[key]}">${html}</div>` : '');
function openAdd() {
  const items = [['new-pnote', 'note', 'Note'], ['new-todo', 'check-square', 'To-do'], ['new-event', 'calendar', 'Event'], ['new-note', 'shield', 'Vet note'], ['new-weight', 'scale', 'Weight'], ['new-photo', 'image', 'Photo']];
  $('#modal').innerHTML = `<div class="sheet more addsheet" role="dialog" aria-modal="true" aria-label="Add"><div class="row between"><h2>Add</h2><button type="button" class="x" aria-label="Close" data-act="close">${ic('x')}</button></div><div class="mgrid">${items.map(([a, i, l]) => `<button data-act="${a}"><span class="mico" aria-hidden="true">${ic(i)}</span><span>${l}</span></button>`).join('')}</div></div>`;
  $('#modal').hidden = false;
}

function toast(msg, undo) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button" data-act="toast-undo">Undo</button>' : ''}`;
  t._undo = undo || null; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 5000);
}

// A swipe on the Quick log row must never count as a tap (also tapping to stop momentum scrolling).
function bindTapGuard() {
  let down = null, scrolling = false, st = 0;
  const grid = (e) => e.target.closest && e.target.closest('.type-grid');
  document.addEventListener('scroll', (e) => { if (e.target.classList && e.target.classList.contains('type-grid')) { scrolling = true; clearTimeout(st); st = setTimeout(() => { scrolling = false; }, 250); } }, true);
  document.addEventListener('pointerdown', (e) => { down = grid(e) ? { x: e.clientX, y: e.clientY, bad: scrolling } : null; }, true);
  document.addEventListener('pointermove', (e) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) down.bad = true; }, true);
  document.addEventListener('pointercancel', () => { if (down) down.bad = true; }, true);
  document.addEventListener('click', (e) => { if (grid(e) && down && (down.bad || scrolling)) { e.preventDefault(); e.stopPropagation(); clearTimeout(ui.quickT); } }, true);
}
bindTapGuard();
bindSheets();
dynType(); addEventListener('resize', dynType); document.addEventListener('visibilitychange', dynType);
document.addEventListener('touchstart', () => {}, { passive: true }); // lets :active fire instantly on iOS

function phoneHero(p, d) {
  const photo = p.photo ? `<img class="hbg" src="${esc(p.photo)}" alt="">` : `<div class="hbg art">${dogArt('awake')}</div>`;
  const nm = esc(p.name || 'Your dog'), bits = [p.breed && esc(p.breed), p.dob && ageText(p.dob)].filter(Boolean).join(' · ');
  const meal = lastOf('meal'), pee = lastOf('pee');
  const nextEv = d.upcoming[0];
  const chips = [d.w && `${d.w.lb} lb`, d.appt && `Vet ${fmtDate(d.appt.date)}`, p.dob && `Born ${fmtDate(p.dob)}`].filter(Boolean).map((c) => `<span class="hchip">${c}</span>`).join('');
  return `<div class="phhero">${photo}<div class="hshade"></div>
    <div class="hcol">
    <div class="hslides" id="hslides">
      <div class="hs"><span class="heye">${greeting()}</span><h2>${nm}</h2><p>${bits || 'Add a breed and birthday in the profile'}</p><div class="hchips">${chips}</div></div>
      <div class="hs"><span class="heye">Today with ${nm}</span><h2>${d.n} logged</h2><p>${d.dueDone} of ${d.dueTotal} care tasks done${meal ? ' · Last meal ' + ago(meal.ts) : ''}</p><div class="hchips">${pee ? `<span class="hchip">Last pee ${ago(pee.ts)}</span>` : ''}<span class="hchip">${statusLine() ? esc(statusLine()) : 'All calm'}</span></div></div>
      <div class="hs"><span class="heye">Coming up</span><h2>${nextEv ? esc(nextEv.title) : 'Nothing scheduled'}</h2><p>${nextEv ? fmtDate(nextEv.date) + (nextEv.time ? ' · ' + fmtTime(nextEv.time) : '') : 'Add a vet visit or walk on the Calendar'}</p><div class="hchips"><span class="hchip">${d.shots} shot${d.shots === 1 ? '' : 's'} due soon</span></div></div>
    </div>
    <div class="hbtns"><button class="hplay" data-act="hero-log">${ic('paw')}<span>Quick log</span></button><button class="hcirc" data-act="hero-add" aria-label="Add a note, to-do, event or more">${ic('plus')}</button></div>
    <div class="hdots" id="hdots"><i class="on"></i><i></i><i></i></div>
    </div>
  </div>`;
}

// Long-press a Home block, then drag it up or down. Order is stored on this device.
function bindHomeReorder() {
  let el = null, timer = null, sx = 0, sy = 0, grab = 0, lastY = 0, scrollT = null, dragging = false;
  const view = () => document.querySelector('.hlist');
  const blocks = () => [...view().querySelectorAll('.hb')].sort((a, b) => a.style.order - b.style.order);
  const cancel = () => { clearTimeout(timer); timer = null; };
  const move = (y) => {
    el.style.transform = 'none';
    const r = el.getBoundingClientRect();
    el.style.transform = `translateY(${y - grab - r.top}px) scale(1.03)`;
    const mid = y - grab + r.height / 2, list = blocks(), i = list.indexOf(el);
    const swap = (j) => { const a = el.style.order; el.style.order = list[j].style.order; list[j].style.order = a; };
    if (i > 0) { const q = list[i - 1].getBoundingClientRect(); if (mid < q.top + q.height / 2) { swap(i - 1); return move(y); } }
    if (i < list.length - 1) { const q = list[i + 1].getBoundingClientRect(); if (mid > q.top + q.height / 2) { swap(i + 1); return move(y); } }
  };
  const end = () => {
    cancel();
    if (!dragging) return;
    dragging = false; clearInterval(scrollT);
    el.classList.remove('lift'); el.style.transform = ''; document.body.classList.remove('reorder');
    try { localStorage.setItem('pawlogHome', JSON.stringify(blocks().map((b) => b.dataset.hb))); } catch { /* storage unavailable: order just won't persist */ }
    const blk = el; el = null; blk.dataset.drop = '1'; setTimeout(() => delete blk.dataset.drop, 350);
  };
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('.hb');
    if (!b || !view() || e.button > 0 || e.target.closest('input,textarea,select')) return;
    el = b; sx = e.clientX; sy = e.clientY; lastY = sy;
    cancel();
    timer = setTimeout(() => {
      dragging = true; b.classList.add('lift'); document.body.classList.add('reorder');
      grab = sy - b.getBoundingClientRect().top; move(lastY);
      if (navigator.vibrate) navigator.vibrate(12);
      scrollT = setInterval(() => { const m = document.querySelector('main'), h = innerHeight; if (lastY < 120) m.scrollTop -= 10; else if (lastY > h - 130) m.scrollTop += 10; if (el) move(lastY); }, 16);
    }, 480);
  });
  document.addEventListener('pointermove', (e) => {
    lastY = e.clientY;
    if (dragging) move(e.clientY);
    else if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 9) cancel();
  });
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
  document.addEventListener('touchmove', (e) => { if (dragging) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('.hb')) e.preventDefault(); });
  document.addEventListener('click', (e) => { if (document.querySelector('.hb[data-drop]')) { e.stopPropagation(); e.preventDefault(); } }, true);
  // hero page dots follow the swipe
  document.addEventListener('scroll', (e) => {
    const t = e.target;
    if (t && t.id === 'hslides') { const n = Math.round(t.scrollLeft / t.clientWidth); document.querySelectorAll('#hdots i').forEach((d, k) => d.classList.toggle('on', k === n)); }
    if (t && t.tagName === 'MAIN') t.classList.toggle('scrolled', t.scrollTop > 40);
  }, true);
}

function dashView() {
  const p = profile(), t = today();
  const dueTasks = careTasks().filter((k) => doneToday(k) || nextDue(k) <= t);
  const doneN = dueTasks.filter(doneToday).length;
  const pct = dueTasks.length ? Math.round((doneN / dueTasks.length) * 100) : 0;
  const w = weights()[0];
  const appt = all('event').filter((e) => catOf(e.category).key === 'vet' && e.date >= t).sort(evSort)[0];
  const todayLog = all('log').filter((l) => dayOf(l.ts) === t).sort((a, b) => a.ts.localeCompare(b.ts));
  const trainToday = all('training').flatMap((tr) => {
    const n = sessionsOn(tr.id, t).length;
    return tr.times.map((time, i) => ({ tr, time, done: i < n }));
  }).sort((a, b) => a.time.localeCompare(b.time));
  const upcoming = all('event').filter((e) => e.date >= t).sort(evSort).slice(0, 4);
  const shotsSoon = all('shot').filter((s) => s.next && diffDays(s.next, t) <= 30).sort((a, b) => a.next.localeCompare(b.next));
  const fact = (label, value, act) => `<div class="fact${act ? ' click' : ''}"${act ? ' tabindex="0" role="button" data-act="' + act + '" title="Log weight"' : ''}><span>${label}</span><b>${value}</b></div>`;
  const recent = all('log').filter((l) => dayOf(l.ts) === t).sort((a, b) => b.ts.localeCompare(a.ts));
  const agenda = [
    ...upcoming.map((e) => ({ k: e.date + (e.time || ''), html: eventRow(e) })),
    ...shotsSoon.map((s) => { const d = diffDays(s.next, t); return { k: s.next, html: `<div class="entry"><span class="grow">${esc(s.name)} shot</span><span class="pill ${d < 0 ? 'bad' : 'warn'}">${d < 0 ? 'Overdue' : 'Due ' + fmtDate(s.next)}</span></div>` }; }),
  ].sort((a, b) => a.k.localeCompare(b.k)).slice(0, 6);

  const counts = allTypes().filter((tp) => tp.id !== 'medication' || todayLog.some((l) => l.type === 'medication')).map((tp) => ({ tp, n: todayLog.filter((l) => l.type === tp.id).length }));
  const ws = weights(), wDelta = ws.length > 1 ? +(ws[0].lb - ws[1].lb).toFixed(1) : null;
  const bars = ws.slice(0, 6).reverse(), wMax = Math.max(...bars.map((b) => b.lb), 1), wMin = Math.min(...bars.map((b) => b.lb), wMax);
  const shots = all('shot').sort((a, b) => (a.next || FAR).localeCompare(b.next || FAR));
  const recentSess = all('session').sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 5);
  const toGet = all('supply').filter((s) => !s.bought);
  const getTotal = toGet.reduce((n, s) => n + (Number(s.price) || 0), 0);
  const v = vet();
  const recentPh = all('photo').filter((x) => x.thumb || x.img).sort((a, b) => b.date.localeCompare(a.date) || (b.at || 0) - (a.at || 0)).slice(0, 8);
  const strip = recentPh.length ? `<div class="card"><div class="row between"><h2>Memories</h2><button class="link" data-nav="gallery">Gallery</button></div><div class="strip">${recentPh.map((x) => `<button class="tile-ph" data-act="view-photo" data-id="${x.id}"><img src="${x.thumb || x.img}" alt=""><span class="cap"><b>${esc(x.title || fmtDate(x.date))}</b></span></button>`).join('')}</div></div>` : '';

  const openTodos = all('task').filter((k) => k.todo && ((!k.done && k.due <= t) || (k.done && k.doneDay === t)));
  const total = dueTasks.length + openTodos.length, doneAll = doneN + openTodos.filter((k) => k.done).length;
  const ring = total ? doneAll / total : 1, C = 2 * Math.PI * 44;
  const next = [
    ...openTodos.filter((k) => !k.done).sort((a, b) => PRIO_ORDER[a.prio] - PRIO_ORDER[b.prio]).map((k) => `<label class="care-item"><input type="checkbox" data-act="toggle-todo" data-id="${k.id}"><span class="care-name">${esc(k.name)}</span><span class="prio ${k.prio}">${PRIO[k.prio]}</span></label>`),
    ...dueTasks.filter((k) => !doneToday(k)).map((k) => `<label class="care-item"><input type="checkbox" data-act="toggle-task" data-id="${k.id}"><span class="care-name">${esc(k.name)}</span><span class="muted small">Care</span></label>`),
  ].slice(0, 3);
  const todayCard = `<div class="card today">
    <div class="ringwrap"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" class="rt"/><circle cx="50" cy="50" r="44" class="rf" stroke-dasharray="${(C * ring).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 50 50)"/></svg><div class="rtxt"><b>${total ? doneAll + '/' + total : '✓'}</b><span>done</span></div></div>
    <div class="grow"><div class="row between"><h2>Today</h2><button class="link" data-nav="todo">All to-dos</button></div>
      ${next.length ? next.join('') : `<p class="muted" style="margin-top:6px">${total ? 'Everything is done. Nice work!' : 'Nothing is due today. Enjoy the day with ' + esc(p.name || 'your dog') + '.'}</p>`}</div></div>`;

  const ord = homeOrder();
  const heroData = { w, appt, upcoming, n: todayLog.length, dueDone: doneN, dueTotal: dueTasks.length, shots: shotsSoon.length };
  return `
  ${phoneHero(p, heroData)}
  <div class="hlist">
  ${hb('today', todayCard, ord)}
  <div class="card hero">
    <div class="hero-main">
      ${avatar(p, 'photo', 'data-act="edit-profile" title="Change photo"')}
      <div class="hero-info">
        <div class="row"><h2>${esc(p.name)}</h2><button class="link" data-act="edit-profile">Edit</button></div>
        <div class="muted">${esc(p.breed)}</div>
        <div class="facts">
          ${fact('Age', ageText(p.dob))}${fact('Birthday', fmtDate(p.dob))}${fact('Weight', w ? w.lb + ' lb' : 'Log weight', 'new-weight')}${fact('Next vet visit', appt ? fmtDate(appt.date) : 'Not set')}
        </div>
      </div>
    </div>
    <div class="hero-art" id="heroart">${heroArt()}</div>
  </div>

  ${hb('quick', `<div class="card quick" id="quicklog">
    <div class="row between"><h2>Quick log</h2><span class="muted small">${todayLog.length} logged today</span></div>
    <div class="type-grid">${allTypes().map(typeBtn).join('')}</div>
  </div>`, ord)}

  <div class="cards three">
    ${hb('care', `<div class="card">
      <div class="row between"><h2>Today's care</h2><span class="muted small">${doneN} of ${dueTasks.length}</span></div>
      <div class="prog"><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><span class="muted small">${pct}%</span></div>
      ${dueTasks.length ? dueTasks.map((k) => `<label class="care-item${doneToday(k) ? ' done' : ''}"><input type="checkbox" data-act="toggle-task" data-id="${k.id}" ${doneToday(k) ? 'checked' : ''}><span class="care-name">${esc(k.name)}</span><span class="muted small">${k.everyDays === 1 ? 'Daily' : 'Every ' + k.everyDays + 'd'}</span></label>`).join('') : blank('clipboard', 'All caught up', 'No care tasks are due today.')}
      ${trainToday.length ? `<h3 class="sub">Training</h3>${trainToday.map((x) => `<div class="entry"><span class="time">${fmtTime(x.time)}</span><span class="grow">${esc(x.tr.name)}</span>${x.done ? '<span class="pill ok">Done</span>' : `<button class="btn sm" data-act="rate-session" data-id="${x.tr.id}">Rate</button>`}</div>`).join('')}` : ''}
    </div>`, ord)}

    ${hb('recent', `<div class="card">
      <div class="row between"><h2>Recent activity</h2><button class="link" data-nav="log">View log</button></div>
      ${recent.length ? recent.slice(0, 10).map((l) => entryRow(l, true)).join('') : blank('bone', 'Nothing logged yet', `Tap a button above to log ${p.name}\'s day.`)}
    </div>`, ord)}

    ${hb('upcoming', `<div class="card">
      <div class="row between"><h2>Upcoming</h2><button class="link" data-nav="calendar">Calendar</button></div>
      ${agenda.length ? agenda.map((a) => a.html).join('') : blank('calendar', 'Nothing scheduled', 'Add events on the Calendar.')}
    </div>`, ord)}
  </div>

  <div class="cards three">
    ${hb('sofar', `<div class="card">
      <div class="row between"><h2>Today so far</h2><span class="muted small">${todayLog.length} entries</span></div>
      <div class="tiles">${counts.map((x) => `<div class="tile"><b>${x.n}</b><span>${esc(x.tp.name)}</span></div>`).join('')}</div>
      ${(() => { const wl = todayLog.filter((l) => l.type === 'water' && l.level); return wl.length ? `<div class="kv"><span>Water intake</span><span>${wl.map((l) => esc(l.level)).join(', ')}</span></div>` : ''; })()}
      <div class="kv"><span>Last meal</span><span>${lastOf('meal') ? ago(lastOf('meal').ts) : '—'}</span></div>
      <div class="kv"><span>Last nap</span><span>${lastOf('nap') ? ago(lastOf('nap').ts) : '—'}</span></div>
    </div>`, ord)}

    ${hb('health', `<div class="card">
      <div class="row between"><h2>Health</h2><button class="link" data-nav="health">Details</button></div>
      <div class="kv"><span>Weight</span><span>${ws[0] ? ws[0].lb + ' lb' + (wDelta ? ` <span class="muted">(${wDelta > 0 ? '+' : ''}${wDelta})</span>` : '') : '—'}</span></div>
      ${bars.length > 1 ? `<div class="mini">${bars.map((b) => `<i title="${b.lb} lb" style="height:${20 + 80 * (b.lb - wMin) / ((wMax - wMin) || 1)}%"></i>`).join('')}</div>` : ''}
      ${shots.length ? shots.slice(0, 4).map((s) => { const st = shotStatus(s); return `<div class="kv"><span>${esc(s.name)}</span><span class="pill ${st.cls}">${st.text}</span></div>`; }).join('') : '<div class="kv"><span>Shots</span><span class="muted">None recorded</span></div>'}
      <div class="kv"><span>Last exam</span><span>${(() => { const ex = all('vetNote').filter((n) => n.kind === 'exam').sort((a, b) => b.date.localeCompare(a.date))[0]; return ex ? fmtDate(ex.date) : '—'; })()}</span></div>
      <div class="kv"><span>Vet</span><span>${esc(v.name) || '—'}</span></div>
      ${v.phone ? `<div class="kv"><span>Phone</span><span>${esc(v.phone)}</span></div>` : ''}
    </div>`, ord)}

    ${hb('training', `<div class="card">
      <div class="row between"><h2>Training &amp; supplies</h2><button class="link" data-nav="training">Training</button></div>
      ${recentSess.length ? recentSess.map((x) => { const tr = get('training', x.trainingId); return `<div class="entry" tabindex="0" role="button" data-act="view-session" data-id="${x.id}"><span class="grow">${esc(tr ? tr.name : 'Removed training')}</span><span class="muted small">${fmtDate(dayOf(x.ts))}</span><span class="stars-view">${'★'.repeat(x.stars)}<span class="off">${'★'.repeat(5 - x.stars)}</span></span></div>`; }).join('') : blank('cap', 'No sessions yet', 'Rate a session after you train.')}
      <h3 class="sub">Supplies to get</h3>
      ${toGet.length ? `<div class="kv"><span>${toGet.length} item${toGet.length === 1 ? '' : 's'}</span><span>${getTotal ? '≈ $' + getTotal.toFixed(2) : ''}</span></div>${toGet.slice(0, 5).map((s) => `<div class="kv"><span>${esc(s.name)}</span><span class="muted">${s.price ? '$' + Number(s.price).toFixed(2) : ''}</span></div>`).join('')}` : '<p class="empty">Nothing on the list.</p>'}
    </div>`, ord)}
  </div>
  ${hb('memories', strip, ord)}
  </div>`;
}

function calView() {
  const m = ui.calMonth, t = today();
  const offset = (new Date(m.getFullYear(), m.getMonth(), 1).getDay() + 6) % 7;
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(m.getFullYear(), m.getMonth(), 1 - offset + i), s = ymd(d), evs = eventsOn(s);
    cells += `<div class="day${d.getMonth() !== m.getMonth() ? ' other' : ''}${s === t ? ' today' : ''}${s === ui.selDay ? ' sel' : ''}" tabindex="0" role="button" data-act="sel-day" data-id="${s}">
      <div class="dnum">${d.getDate()}</div>${evs.slice(0, 3).map(evChip).join('')}${evs.length > 3 ? `<div class="more">+${evs.length - 3} more</div>` : ''}</div>`;
  }
  const dayEvs = eventsOn(ui.selDay);
  return `
  <div class="card">
    <div class="row between calhead">
      <div class="row"><button class="btn ghost sm" data-act="cal-month" data-v="-1" aria-label="Previous month">${ic('chev-left')}</button><h2 class="monthlabel">${m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2><button class="btn ghost sm" data-act="cal-month" data-v="1" aria-label="Next month">${ic('chev-right')}</button></div>
      <div class="row"><button class="btn ghost sm" data-act="cal-today">Today</button><button class="btn ghost sm" data-act="cal-sort">Sort: ${ui.calSort === 'time' ? 'Time' : 'Color'}</button><button class="btn primary sm" data-act="new-event">+ Add event</button></div>
    </div>
    <div class="chips-row">${cats().map((c) => `<button class="chip${ui.hiddenCats.has(c.id) ? ' off' : ''}" data-act="cat-filter" data-id="${c.id}"><i style="background:${c.color}"></i>${esc(c.name)}</button>`).join('')}</div>
    <div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="dow">${d}</div>`).join('')}${cells}</div>
  </div>
  <div class="card">
    <div class="row between"><h2>${fmtDate(ui.selDay)}</h2><button class="btn primary sm" data-act="new-event">+ Add</button></div>
    ${dayEvs.length ? dayEvs.map((e) => `<div class="entry" tabindex="0" role="button" data-act="edit-event" data-id="${e.id}"><span class="bar" style="background:${catOf(e.category).color}"></span><span class="time">${e.time ? fmtTime(e.time) : 'All day'}</span><span class="grow">${esc(e.title)}<div class="muted small">${esc(catOf(e.category).name)}${e.notes ? ' · ' + esc(e.notes) : ''}</div></span></div>`).join('') : blank('calendar', 'Nothing on this day')}
  </div>`;
}

function logView() {
  const day = ui.logDay, t = today();
  const entries = all('log').filter((l) => dayOf(l.ts) === day).sort((a, b) => a.ts.localeCompare(b.ts));
  return `
  <div class="card">
    <div class="row between">
      <div class="row"><button class="btn ghost sm" data-act="log-day" data-v="-1" aria-label="Previous day">${ic('chev-left')}</button><h2 class="daylabel">${day === t ? 'Today' : fmtDate(day)}</h2><button class="btn ghost sm" data-act="log-day" data-v="1" aria-label="Next day">${ic('chev-right')}</button></div>
      ${day !== t ? '<button class="btn ghost sm" data-act="log-today">Back to today</button>' : ''}
    </div>
  </div>
  <div class="card">
    <div class="row between"><h2>Log something</h2><button class="btn primary sm" data-act="new-tracker">+ New tracker</button></div>
    <div class="type-grid" style="margin-top:12px">${allTypes().map(typeBtn).join('')}</div>
  </div>
  <div class="card">
    <h2>Entries</h2>
    ${entries.length ? entries.map((l) => entryRow(l, true)).join('') : blank('bone', 'Nothing logged for this day')}
  </div>`;
}

function careView() {
  const t = today();
  const rows = careTasks().map((k) => {
    const last = lastDone(k), next = nextDue(k), done = doneToday(k);
    const status = done ? '<span class="pill ok">Done today ✓</span>'
      : next < t ? `<span class="pill bad">Overdue since ${fmtDate(next)}</span>`
      : next === t ? '<span class="pill warn">Due today</span>'
      : `<span class="pill">Next ${fmtDate(next)}</span>`;
    const action = k.everyDays <= 1
      ? `<button class="btn sm${done ? ' ghost' : ''}" data-act="toggle-task" data-id="${k.id}">${done ? 'Undo' : 'Mark done'}</button>`
      : `<button class="btn sm" data-act="task-done" data-id="${k.id}">Log done</button>`;
    return `<div class="entry"><div class="grow"><b>${esc(k.name)}</b><div class="muted small">${k.everyDays === 1 ? 'Every day' : 'Every ' + k.everyDays + ' days'} · Last done ${last ? fmtDate(last) : 'never'}</div></div>${status}${action}<button class="btn ghost sm" data-act="edit-task" data-id="${k.id}">Edit</button></div>`;
  }).join('');
  return `<div class="card"><div class="row between"><h2>Care tasks</h2><button class="btn primary sm" data-act="new-task">+ New task</button></div>${rows || blank('clipboard', 'No care tasks yet', 'Add one to start a routine.')}</div>`;
}

function healthView() {
  const v = vet(), t = today();
  const appt = all('event').filter((e) => catOf(e.category).key === 'vet' && e.date >= t).sort(evSort)[0];
  const shots = all('shot').sort((a, b) => (a.next || FAR).localeCompare(b.next || FAR));
  const have = new Set(shots.map((s) => keyOf(s.name)));
  const needed = RECOMMENDED.filter((r) => !have.has(r.key));
  const ws = weights(), vn = all('vetNote').sort((a, b) => b.date.localeCompare(a.date)), notes = vn.filter((n) => !n.kind), exams = vn.filter((n) => n.kind === 'exam'), reports = vn.filter((n) => n.kind === 'report');

  const shotRow = (s) => {
    const st = shotStatus(s);
    return `<div class="entry wrap"><div class="grow"><b>${esc(s.name)}</b><div class="muted small">${[s.given ? 'Given ' + fmtDate(s.given) : '', s.next ? 'Next ' + fmtDate(s.next) : ''].filter(Boolean).join(' · ') || 'No dates yet'}</div></div>
      <span class="pill ${st.cls}">${st.text}</span>
      <button class="qbtn" data-act="about" data-id="${s.id}" title="What is this?" aria-label="What is this?">?</button>
      <button class="btn ghost sm" data-act="edit-shot" data-id="${s.id}">Edit</button>
      ${ui.openAbout.has(s.id) ? `<p class="about">${esc(s.about || shotAbout(s.name) || 'No details yet. Tap Edit to add some.')}</p>` : ''}</div>`;
  };
  const neededRow = (r) => `<div class="entry wrap"><div class="grow"><b>${r.name}</b><div class="muted small">Not recorded yet</div></div>
      <button class="btn ghost sm" data-act="new-shot" data-v="${r.name}">Record</button>
      <button class="qbtn" data-act="about" data-id="rec:${r.key}" title="What is this?" aria-label="What is this?">?</button>
      ${ui.openAbout.has('rec:' + r.key) ? `<p class="about">${esc(SHOT_INFO[r.key])}</p>` : ''}</div>`;

  return `
  <div class="cards">
    <div class="card">
      <div class="row between"><h2>Vet</h2><button class="btn ghost sm" data-act="edit-vet">Edit</button></div>
      <div class="entry"><span class="grow">${ic('plus-square')} ${esc(v.name) || '<span class="muted">No vet added yet</span>'}</span></div>
      ${v.phone ? `<div class="entry"><span class="grow muted">${ic('phone')} ${esc(v.phone)}</span></div>` : ''}
      ${v.address ? `<div class="entry"><span class="grow muted">${ic('pin')} ${esc(v.address)}</span></div>` : ''}
      <div class="entry"><span class="grow">${ic('calendar')} Next appointment</span><span class="pill ${appt ? 'ok' : ''}">${appt ? fmtDate(appt.date) + (appt.time ? ' · ' + fmtTime(appt.time) : '') + ' · ' + esc(appt.title) : 'None scheduled'}</span></div>
    </div>

    <div class="card">
      <div class="row between"><h2>Weight</h2><button class="btn primary sm" data-act="new-weight">+ Add weight</button></div>
      <div class="big" style="margin:8px 0">${ws[0] ? ws[0].lb + ' lb' : '—'}</div>
      ${ws.slice(0, 6).map((w) => `<div class="entry"><span class="time">${fmtDate(w.date)}</span><span class="grow">${w.lb} lb</span><button class="x" aria-label="Remove" data-act="del-weight" data-id="${w.id}">${ic('x')}</button></div>`).join('') || '<p class="muted">No weights yet.</p>'}
    </div>

    <div class="card wide">
      <div class="row between"><h2>Shots</h2><button class="btn primary sm" data-act="new-shot">+ Record shot</button></div>
      <p class="muted small">Tap ? to see what a shot does. Confirm ${esc(profile().name)}'s schedule with your vet.</p>
      ${shots.map(shotRow).join('')}
      ${needed.length ? `<h3 class="sub">Still needed or not recorded</h3>${needed.map(neededRow).join('')}` : ''}
    </div>

    <div class="card wide">
      <div class="row between"><h2>Vet exams</h2><button class="btn primary sm" data-act="new-exam">+ Add exam</button></div>
      <p class="muted small">${exams.length ? `Last exam: <b>${fmtDate(exams[0].date)}</b> · ${sinceText(exams[0].date)}` : 'Record when the last vet exam was, and any past ones.'}</p>
      ${exams.map((x) => `<div class="entry wrap" tabindex="0" role="button" data-act="edit-exam" data-id="${x.id}"><div class="grow"><b>${esc(x.title || 'Vet exam')}</b> <span class="muted small">${fmtDate(x.date)}${x.vet ? ' · ' + esc(x.vet) : ''}</span>${x.text ? `<div class="muted" style="white-space:pre-wrap;margin-top:4px">${esc(x.text)}</div>` : ''}</div></div>`).join('') || blank('heart', 'No exams recorded', 'Add the last exam and any earlier ones.')}
    </div>

    <div class="card wide">
      <div class="row between"><h2>Medical reports</h2><button class="btn primary sm" data-act="new-report">+ Upload report</button></div>
      <p class="muted small">Upload a PDF or a photo of ${esc(profile().name)}'s medical records. PDFs up to 1.5 MB.</p>
      ${reports.map((x) => `<div class="entry wrap">${x.thumb ? `<button type="button" class="rthumb" data-act="view-report" data-id="${x.id}" aria-label="View"><img src="${x.thumb}" alt=""></button>` : `<span class="rthumb ph">${ic('clipboard')}</span>`}<div class="grow"><b>${esc(x.title)}</b> <span class="muted small">${fmtDate(x.date)}</span></div><button class="btn ghost sm" data-act="view-report" data-id="${x.id}">View</button><button class="x" aria-label="Remove" data-act="del-report" data-id="${x.id}">${ic('x')}</button></div>`).join('') || blank('clipboard', 'No reports yet', 'Upload records from your vet so they are always on hand.')}
    </div>

    <div class="card wide">
      <div class="row between"><h2>Vet notes</h2><button class="btn primary sm" data-act="new-note">+ Add note</button></div>
      <p class="muted small">Type in anything your vet gave you: instructions, diagnoses, prescriptions.</p>
      ${notes.map((n) => `<div class="entry wrap"><div class="grow"><b>${esc(n.title)}</b> <span class="muted small">${fmtDate(n.date)}</span><div style="white-space:pre-wrap;margin-top:4px">${esc(n.text)}</div></div><button class="x" aria-label="Remove" data-act="del-note" data-id="${n.id}">${ic('x')}</button></div>`).join('') || blank('heart', 'No vet notes yet', 'Type in anything your vet tells you.')}
    </div>
  </div>`;
}

const GUIDES = [
  ['Sit', 'The first cue to teach and the base for most others.', ['Hold a treat at your dog\'s nose, then slowly lift it up and back over their head.', 'As their head tilts up, their bottom lowers. The moment it touches the floor, say "Yes!" and give the treat.', 'Repeat 5 to 10 times, then add the word "Sit" just before you move the treat.', 'Fade the treat out of your hand: use the same hand motion with no treat, then reward from your pocket.'], 'Reward quickly, within a second. Don\'t push their bottom down.'],
  ['Down', 'A calm position that helps with settling.', ['Start with your dog sitting. Hold a treat at their nose.', 'Slowly lower it straight to the floor between their paws, then slide it out along the floor.', 'The moment their elbows touch the floor, say "Yes!" and reward.', 'Add the word "Down" once they follow the treat easily, then fade the lure.'], 'If they stand up, go back a step and lower the treat more slowly. Train on a soft surface.'],
  ['Stay', 'Teaches impulse control. Build it slowly.', ['Ask for a Sit. Show your open palm and say "Stay".', 'Wait one second, say "Yes!" and reward while they are still sitting.', 'Slowly build up time first, then distance, then distractions. Only increase one at a time.', 'Always end with a release word like "Okay!" so they know when they are done.'], 'If they break the stay, you went too fast. Make it easier and try again, with no scolding.'],
  ['Come (recall)', 'The most important safety cue. Make it the best thing ever.', ['Start in a quiet room. Say your dog\'s name and "Come!" in a happy voice, then back up.', 'When they reach you, give a great treat and lots of praise.', 'Practice on a long leash outside, gradually adding distractions.', 'Randomly reward with something extra special, like chicken.'], 'Never call your dog to scold them or end the fun. Coming to you should always feel good.'],
  ['Place', 'Sends your dog to a mat or bed and keeps them there.', ['Put a mat or bed on the floor. Toss a treat on it. When all four paws are on, say "Yes!" and reward.', 'Repeat until they run to it. Then say "Place" as they go.', 'Reward for lying down on it, then add short stays with a release word.', 'Slowly increase distance from the mat and the time they stay.'], 'Use the same mat every time. Great for dinner time and visitors.'],
  ['Crate training', 'Gives your dog a safe, calm den.', ['Leave the crate open with a soft bed. Toss treats inside and let them go in and out freely.', 'Feed meals in the crate so it means good things.', 'Close the door for a few seconds while they eat, then open it. Slowly lengthen the time.', 'Leave for short periods with a chew toy. Build to longer stretches.'], 'Never use the crate as punishment. Don\'t let a puppy out while they are whining, wait for a pause first.'],
  ['Leave it', 'Stops your dog from grabbing things they should not have.', ['Hold a treat in a closed fist. Let them sniff and paw at it. Say nothing.', 'The moment they pull away, say "Yes!" and reward from your other hand, not the one they were sniffing.', 'Add the words "Leave it" just before you present the fist.', 'Progress to an open palm, then a treat on the floor under your foot, then dropped treats.'], 'The reward always comes from a different hand. Never give them the thing they were told to leave.'],
  ['Drop it', 'Teaches your dog to let go of what is in their mouth.', ['Offer a toy to chew. Show a tasty treat close to their nose.', 'When they open their mouth and the toy drops, say "Drop it" and "Yes!", then reward.', 'Give the toy back to show that dropping is not a loss.', 'Practice with different objects, and trade up for a better treat.'], 'Don\'t chase or pull items from their mouth. It turns into a game of keep-away.'],
  ['Loose-leash walking', 'Walks without pulling.', ['Reward your dog for being next to you with the leash slack, from inside the house first.', 'Take a step. If they stay beside you, "Yes!" and reward at your leg.', 'The moment the leash tightens, stop and stand still. Walk again when it goes slack.', 'Change direction often so they stay focused on you.'], 'Stop-and-go is boring on purpose. Pulling should never get them where they want to go.'],
  ['Off', 'Keeps paws off furniture, counters and people.', ['When paws go up, turn away and wait. Say nothing.', 'When all four paws are on the floor, say "Yes!" and reward.', 'Add the word "Off" as they put their paws down.', 'Ask visitors to do the same, so everyone is consistent.'], 'Reward sitting on the floor. It is easier than telling them what not to do.'],
];
const GUIDE_GENERAL = ['Keep sessions short: 5 minutes, a few times a day.', 'Use small, soft treats and reward within a second of the right behavior.', 'Teach in a quiet room first, then add distractions slowly.', 'End on a success, and keep it fun.'];

function guidesView() {
  return `<div class="card"><h3 style="margin:0 0 6px">The basics</h3><ul class="tips">${GUIDE_GENERAL.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
  <div class="cards">${GUIDES.map(([name, blurb, steps, tip], i) => `<details class="card guide"><summary><span class="gname">${esc(name)}</span><span class="muted small">${esc(blurb)}</span></summary>
    <ol>${steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol><p class="tip"><b>Tip:</b> ${esc(tip)}</p>
    <button class="btn sm" data-act="train-this" data-id="${i}">Add to my training</button></details>`).join('')}</div>`;
}

function trainView() {
  const tab = `<div class="seg"><button data-act="train-tab" data-id="mine" class="${ui.trainTab !== 'guides' ? 'on' : ''}">My training</button><button data-act="train-tab" data-id="guides" class="${ui.trainTab === 'guides' ? 'on' : ''}">How to train</button></div>`;
  if (ui.trainTab === 'guides') return tab + guidesView();
  return tab + trainMine();
}

function trainMine() {
  const trs = all('training');
  const sessions = all('session').sort((a, b) => b.ts.localeCompare(a.ts));
  const cards = trs.map((tr) => `
    <div class="card">
      <div class="row between"><h3>${ic('graduation')} ${esc(tr.name)}</h3><div class="row"><button class="btn ghost sm" data-act="edit-training" data-id="${tr.id}">Edit</button><button class="btn sm" data-act="rate-session" data-id="${tr.id}">Rate session</button></div></div>
      <div class="chips-row">${tr.times.map((x) => `<span class="pill">${ic('clock')} ${fmtTime(x)}</span>`).join('') || '<span class="muted small">No times set</span>'}</div>
      ${tr.notes ? `<p class="muted">${esc(tr.notes)}</p>` : ''}
    </div>`).join('');
  const hist = sessions.map((s) => {
    const tr = get('training', s.trainingId);
    return `<div class="entry" tabindex="0" role="button" data-act="view-session" data-id="${s.id}"><span class="time">${fmtDate(dayOf(s.ts))}</span><span class="grow">${esc(tr ? tr.name : 'Removed training')}</span><span class="stars-view">${'★'.repeat(s.stars)}<span class="off">${'★'.repeat(5 - s.stars)}</span></span></div>`;
  }).join('');
  return `
  <div class="row end"><button class="btn primary sm" data-act="new-training">+ New training</button><button class="btn ghost sm" data-act="rate-session">Rate a session</button></div>
  <div class="cards">${cards || `<div class="card wide">${blank('cap', 'Nothing in training yet', 'Add what you are working on and when to practice it.')}</div>`}</div>
  <div class="card" style="margin-top:16px"><h2>Past sessions</h2>${hist || blank('cap', 'No sessions yet', 'Rate one after you train.')}</div>`;
}

function supView() {
  const list = all('supply').sort((a, b) => Number(a.bought) - Number(b.bought) || a.name.localeCompare(b.name));
  const toGet = list.filter((s) => !s.bought);
  const total = toGet.filter((s) => s.price).reduce((n, s) => n + Number(s.price), 0);
  const card = (s) => `
    <div class="card supply${s.bought ? ' got' : ''}">
      <div class="sup-img">${s.photo ? `<img src="${s.photo}" alt="">` : `<span>${s.icon ? esc(s.icon) : ic('box', 'lg')}</span>`}</div>
      <div><b>${esc(s.name)}</b>${s.price ? ` <span class="pill">$${Number(s.price).toFixed(2)}</span>` : ''}${s.notes ? `<div class="muted small">${esc(s.notes)}</div>` : ''}</div>
      <div class="row">${s.url ? `<button class="btn ghost sm" data-act="open-link" data-id="${s.id}">Open link</button>` : ''}<button class="btn ghost sm" data-act="toggle-bought" data-id="${s.id}">${s.bought ? 'Undo' : 'Got it'}</button><button class="x" aria-label="Remove" data-act="del-supply" data-id="${s.id}">${ic('x')}</button></div>
    </div>`;
  return `
  <div class="row end"><span class="muted">${toGet.length} to get${total ? ' · about $' + total.toFixed(2) : ''}</span><button class="btn primary sm" data-act="new-supply">+ Add item</button></div>
  ${list.length ? `<div class="cards supplies">${list.map(card).join('')}</div>` : `<div class="card">${blank('bag', 'Nothing here yet', `Add things ${esc(profile().name)} needs, with a photo or an icon.`)}</div>`}`;
}

function galView() {
  const items = all('photo').sort((a, b) => b.date.localeCompare(a.date) || (b.at || 0) - (a.at || 0));
  const groups = new Map();
  items.forEach((x) => { const k = x.date.slice(0, 7); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); });
  const dob = profile().dob;
  const tile = (x) => {
    const age = ageAt(dob, x.date);
    const cap = `<span class="cap"><b>${esc(x.title || fmtDate(x.date))}</b>${x.title ? `<small>${fmtDate(x.date)}${age ? ' · ' + age : ''}</small>` : age ? `<small>${age}</small>` : ''}</span>`;
    return x.thumb || x.img
      ? `<button class="tile-ph" data-act="view-photo" data-id="${x.id}"><img src="${x.thumb || x.img}" alt="${esc(x.title)}" loading="lazy">${cap}</button>`
      : `<button class="tile-ph note" data-act="view-photo" data-id="${x.id}"><span class="memo">${esc(x.note || x.title)}</span>${cap}</button>`;
  };
  return `
  <div class="row end"><span class="muted">${items.length} ${items.length === 1 ? 'memory' : 'memories'}</span><button class="btn primary sm" data-act="new-photo">+ Add photos</button></div>
  ${items.length ? [...groups].map(([k, list]) => `<section class="gal-group"><div class="gal-head"><h2>${parseYmd(k + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2><span class="muted small">${list.length}</span></div><div class="gal">${list.map(tile).join('')}</div></section>`).join('')
    : `<div class="card">${blank('camera', 'No memories yet', `Add photos and little moments from ${esc(profile().name)}'s life, like first snow or the day they came home.`)}</div>`}`;
}

function openPhotoModal(id) {
  const x = id ? get('photo', id) : { date: '', title: '', note: '' };
  const dob = profile().dob;
  openModal(id ? esc(x.title || 'Memory') : 'Add photos & memories',
    (id && (x.img || x.thumb) ? `<img class="viewimg" src="${x.img || x.thumb}" alt="">` : '') +
    (id ? `<p class="muted small" style="margin-bottom:14px">${ageAt(dob, x.date) || ''}</p>` : field('Photos (choose one or many)', `<input type="file" name="files" accept="image/*" multiple>`)) +
    field(id ? 'Date' : "Date (leave empty to use each photo's own date)", `<input type="date" name="date" ${id ? 'required' : ''} value="${x.date || ''}">`) +
    field('Title (optional)', `<input name="title" value="${esc(x.title)}" placeholder="First snow, Gotcha day, Beach trip…">`) +
    field('Memory / note (optional)', `<textarea name="note" rows="3" placeholder="What made this moment special?">${esc(x.note)}</textarea>`),
    async (f) => {
      const title = f.get('title').trim(), note = f.get('note').trim(), date = f.get('date');
      if (id) return save('photo', { ...x, date, title, note });
      const files = f.getAll('files').filter((file) => file && file.size);
      if (!files.length && !title && !note) throw new Error('Add a photo or write a memory');
      if (!files.length) return save('photo', { date: date || today(), title, note, at: Date.now() });
      for (const file of files) {
        const img = await readImage(file, 1600, 0.82), thumb = await readImage(file, 520, 0.8);
        await save('photo', { date: date || ymd(new Date(file.lastModified || Date.now())), title, note, img, thumb, at: Date.now() });
      }
    }, id ? 'Save' : 'Add',
    id ? `<button type="button" class="btn danger" data-act="del-photo" data-id="${id}">Delete</button>` : '');
}

function setView() {
  const p = profile();
  const head = (title, addAct) => `<div class="sect-head"><h3>${title}</h3>${addAct ? `<button class="btn primary sm" data-act="${addAct}">+ Add</button>` : ''}</div>`;
  const row = (label, value) => `<div class="srow"><span class="label">${label}</span><span class="value">${value}</span></div>`;
  const link = (act, id, left, right) => `<div class="srow" tabindex="0" role="button" data-act="${act}" data-id="${id}">${left}<span class="muted small">${right}</span><span class="go">${ic('chev-right')}</span></div>`;
  return `<div class="settings">
    ${accountHtml()}
    <section>${head('Pet profile')}<div class="group">
      <div class="profile-top">${avatar(p, 'photo sm')}<div class="grow"><div class="big">${esc(p.name)}</div><div class="muted">${esc(p.breed) || 'No breed set'}</div></div><button class="btn" data-act="edit-profile">Edit profile</button></div>
      ${row('Name', esc(p.name))}${row('Breed', esc(p.breed) || '—')}${row('Birthday', fmtDate(p.dob))}${row('Age', ageText(p.dob))}
    </div></section>
    <section>${head('Calendar categories', 'new-cat')}<div class="group">
      ${cats().map((c) => link('edit-cat', c.id, `<span class="dot" style="background:${c.color}"></span><span class="value">${esc(c.name)}</span>`, '')).join('')}
    </div></section>
    <section>${head('Care tasks', 'new-task')}<div class="group">
      ${careTasks().map((k) => link('edit-task', k.id, `<span class="value">${esc(k.name)}</span>`, k.everyDays === 1 ? 'Every day' : `Every ${k.everyDays} days`)).join('')}
    </div></section>
    <section>${head('Daily log trackers', 'new-tracker')}<div class="group">
      ${all('trackType').map((t) => `<div class="srow"><span class="value">${esc(t.name)}${t.freq || t.notes ? `<div class="sub-line">${esc([t.freq, t.notes].filter(Boolean).join(' · '))}</div>` : ''}</span><button class="x" aria-label="Remove" data-act="del-type" data-id="${t.id}">${ic('x')}</button></div>`).join('') || '<div class="srow muted">No custom trackers yet. Pee, poop, meal, water, nap, activity and medication are built in.</div>'}
    </div></section>
    <section><div class="group"><div class="srow"><span class="value">Home layout<div class="sub-line">Press and hold a card on Home to move it.</div></span><button class="btn sm" data-act="reset-home">Reset</button></div></div></section>
    <p class="note">Your data is stored securely in the cloud and cached on this device so Pawlog works offline.</p>
  </div>`;
}

const VIEWS = { notes: notesView, gallery: galView, todo: todoView, dashboard: dashView, calendar: calView, log: logView, care: careView, health: healthView, training: trainView, supplies: supView, settings: setView };

/* ---------- liquid-glass tab bar (phone) ---------- */
// The pill is built once so the glass "lens" can glide between tabs; later renders only move it.
function renderDock() {
  const bar = $('#tabbar');
  if (!bar.querySelector('.pill')) {
    const tabs = [...TABS.map((id) => { const [, icon, label] = PAGES.find((x) => x[0] === id); return `<button data-nav="${id}" aria-label="${label}">${ic(icon)}<span>${label.replace('Dashboard', 'Home')}</span></button>`; }), `<button data-act="more" aria-label="More">${ic('more')}<span>More</span></button>`];
    bar.innerHTML = `<div class="pill"><i class="lens"></i>${tabs.join('')}</div>`;
    bindDockDrag(bar.firstElementChild);
  }
  const pill = bar.firstElementChild, moreOpen = !$('#modal').hidden && !!document.querySelector('#modal .sheet.more:not(.closing):not(.addsheet)'), i = moreOpen ? -1 : TABS.indexOf(ui.page);
  pill.style.setProperty('--i', i < 0 ? TABS.length : i);
  [...pill.querySelectorAll('button')].forEach((b, n) => b.classList.toggle('on', n === (i < 0 ? TABS.length : i)));
}

// Slide a finger across the bar: the lens follows the finger, the tab under it lights up, and lifting commits.
function bindDockDrag(pill) {
  const N = TABS.length + 1;
  let x0 = null, drag = false, swallow = false;
  const idxAt = (x) => { const r = pill.getBoundingClientRect(); return Math.max(0, Math.min(N - 1, Math.floor(((x - r.left) / r.width) * N))); };
  const follow = (x) => {
    const r = pill.getBoundingClientRect(), pad = 5, w = (r.width - pad * 2) / N;
    const e = w * 0.06, c = Math.max(pad + e, Math.min(r.width - pad - w - e, x - r.left - w / 2));
    pill.style.setProperty('--lx', c - pad + 'px');
    const hot = idxAt(x);
    [...pill.querySelectorAll('button')].forEach((b, n) => b.classList.toggle('hot', n === hot));
  };
  pill.addEventListener('pointerdown', (e) => { x0 = e.clientX; drag = false; pill.classList.add('press'); });
  pill.addEventListener('pointermove', (e) => {
    if (x0 === null) return;
    if (!drag && Math.abs(e.clientX - x0) > 8) { drag = true; pill.classList.add('drag'); try { pill.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    if (drag) follow(e.clientX);
  });
  const end = (e, commit) => {
    if (x0 === null) return;
    const was = drag; x0 = null; drag = false;
    pill.classList.remove('press', 'drag');
    [...pill.querySelectorAll('button')].forEach((b) => b.classList.remove('hot'));
    pill.style.removeProperty('--lx');
    if (was && commit) {
      swallow = true; setTimeout(() => { swallow = false; }, 0);
      const n = idxAt(e.clientX);
      if (navigator.vibrate) navigator.vibrate(6);
      if (n < TABS.length) { ui.page = TABS[n]; closeModal(); render(); playEnter(); } else openMore();
    }
  };
  pill.addEventListener('pointerup', (e) => end(e, true));
  pill.addEventListener('pointercancel', (e) => end(e, false));
  pill.addEventListener('click', (e) => { if (swallow) { e.stopPropagation(); e.preventDefault(); } }, true);
}

bindHomeReorder();
function render() {
  $('#nav').innerHTML = PAGES.filter(([id]) => id !== 'settings').map(([id, icon, label]) => `${NAV_SECTIONS[id] ? `<div class="navlbl">${NAV_SECTIONS[id]}</div>` : ''}<button data-nav="${id}" title="${label}" class="${id === ui.page ? 'on' : ''}" >${ic(icon)}<span class="lbl">${label}</span></button>`).join('');
  renderDock();
  const pr = profile();
  const menu = ui.petMenu ? `<div class="menu" role="menu">${pets().map((x) => `<button class="mi" role="menuitem" data-act="pick-pet" data-id="${x.id}">${avatar(x, 'ava sm')}<span class="grow">${esc(x.name)}</span>${x.id === ui.petId ? ic('check') : ''}</button>`).join('')}<hr><button class="mi" role="menuitem" data-act="new-pet">${ic('plus')}<span class="grow">Add a pet…</span></button></div>` : '';
  $('#brand').innerHTML = `<div class="brandwrap"><button class="brandbtn" data-act="pet-menu" aria-haspopup="menu" aria-expanded="${ui.petMenu}"><img class="ava app" src="assets/icon.png" alt=""><span class="lbl bname"><b>Pawlog</b><small>${esc(pr.name || '')}</small></span><span class="lbl chev">${ic('chev-down')}</span></button>${menu}</div>`;
  document.body.dataset.page = ui.page;
  const [, , label] = PAGES.find((x) => x[0] === ui.page);
  $('#title').textContent = ui.page === 'dashboard' ? 'Today' : label;
  const chip = $('#petchip');
  chip.innerHTML = pr.name ? `${avatar(pr, 'photo sm')}<div><b>${esc(pr.name)}</b><div class="muted small">${[esc(pr.breed || ''), pr.dob ? ageText(pr.dob) : ''].filter(Boolean).join(' · ')}</div><div class="status">${esc(statusLine())}</div></div>` : '';
  chip.hidden = !pr.name;
  { const u = me(), nm = u.username || 'Account'; $('#acct').innerHTML = `${u.avatar ? `<img class="ava" src="${esc(u.avatar)}" alt="">` : `<span class="ava ph ini" aria-hidden="true">${esc(nm.trim().charAt(0).toUpperCase() || '?')}</span>`}<span class="an">${esc(nm)}</span>`; }
  $('#greet').textContent = `${greeting()}, ${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`;
  const m = me();
  $('#who').innerHTML = `${m.avatar ? `<img class="ava" src="${esc(m.avatar)}" alt="">` : `<span class="ava ph">${dogArt('awake')}</span>`}<span class="lbl wname"><b>${esc(m.username || 'Account')}</b><small id="syncst"></small></span>`;
  const gear = $('#gear'); gear.innerHTML = ic('settings'); gear.classList.toggle('on', ui.page === 'settings');
  refreshFoot();
  try {
  $('#view').innerHTML = pets().length || ui.page === 'settings' ? VIEWS[ui.page]() : `<div class="card">${blank('heart', 'Add your first pet', 'Create a profile for your dog, or join a Pawlog someone shared with you.')}<div class="row" style="justify-content:center;margin-top:8px"><button class="btn primary" data-act="new-pet">Add a pet</button><button class="btn" data-act="join-hh">Join a Pawlog</button></div></div>`;
  } catch (err) {
    $('#view').innerHTML = `<div class="card"><p>Something went wrong showing this page.</p><p class="muted small">${esc(err.message || err)}</p></div>`;
  }

}

function playEnter() {
  const v = $('#view');
  v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
  clearTimeout(playEnter.t); playEnter.t = setTimeout(() => v.classList.remove('enter'), 900);
}

function setSidebar(collapsed) {
  $('.app').classList.toggle('collapsed', collapsed);
  const b = $('#collapse');
  b.innerHTML = ic('panel');
  b.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  b.title = b.getAttribute('aria-label');
  try { localStorage.setItem('sbCollapsed', collapsed ? '1' : '0'); } catch { /* storage unavailable: state just won't persist */ }
}

/* ---------- modals ---------- */
function openMore() {
  const m = me(), pr = pets();
  const rest = PAGES.filter(([id]) => !TABS.includes(id) && id !== 'settings');
  $('#modal').innerHTML = `<div class="sheet more" role="dialog" aria-modal="true" aria-label="More">
    <div class="row between"><h2>More</h2><button type="button" class="x" aria-label="Close" data-act="close">${ic('x')}</button></div>
    <button class="mprofile" data-nav="settings">${m.avatar ? `<img class="ava" src="${esc(m.avatar)}" alt="">` : `<span class="ava ph ini" aria-hidden="true">${esc((m.username || 'A').trim().charAt(0).toUpperCase())}</span>`}<span class="grow"><b>${esc(m.username || 'Account')}</b><small>Profile &amp; settings</small></span>${ic('chev-right')}</button>
    <div class="mgrid">${rest.map(([id, icon, label]) => `<button data-nav="${id}" class="${id === ui.page ? 'on' : ''}"><span class="mico">${ic(icon)}</span><span>${label}</span></button>`).join('')}</div>
    <div class="mpets"><span class="mlbl">Pets</span>${pr.map((x) => `<button data-act="more-pet" data-id="${x.id}" class="${x.id === ui.petId ? 'on' : ''}">${avatar(x, 'ava sm')}<span>${esc(x.name)}</span></button>`).join('')}<button data-act="new-pet">${ic('plus')}<span>Add</span></button></div>
  </div>`;
  $('#modal').hidden = false;
  renderDock();
}
/* ---------- motion: springs that start from the live value and inherit the finger's velocity ---------- */
// response = seconds to reach the target; damping 1 = no overshoot (Apple's defaults)
function spring({ from, to, v = 0, response = 0.35, damping = 1, onUpdate, onDone }) {
  const k = (2 * Math.PI / response) ** 2, c = 2 * damping * Math.sqrt(k);
  let x = from, vel = v, last = performance.now(), raf = 0, dead = false;
  const step = (now) => {
    if (dead) return;
    const dt = Math.min((now - last) / 1000, 0.032); last = now;
    for (let n = Math.ceil(dt / 0.004) || 1, h = dt / (n || 1); n > 0; n--) { vel += (-k * (x - to) - c * vel) * h; x += vel * h; }
    onUpdate(x, vel);
    if (Math.abs(x - to) < 0.3 && Math.abs(vel) < 8) { onUpdate(to, 0); if (onDone) onDone(); return; }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return { stop() { dead = true; cancelAnimationFrame(raf); } };
}
const project = (v, d = 0.998) => (v / 1000) * d / (1 - d); // where a flick at v px/s would come to rest
const rubber = (o, dim, c = 0.55) => (o * dim * c) / (dim + c * Math.abs(o)); // resistance past an edge
const isPhone = () => matchMedia('(max-width:700px)').matches;
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const sheetFx = {
  setY(sh, y) {
    sh._y = y; sh.style.transform = y ? `translate3d(0,${y.toFixed(1)}px,0)` : '';
    $('#modal').style.setProperty('--p', String(Math.max(0, Math.min(1, 1 - y / (sh.offsetHeight || 1)))));
  },
  to(sh, target, v, done) {
    if (sh._a) sh._a.stop();
    sh._a = spring({ from: sh._y || 0, to: target, v, response: target ? 0.36 : 0.34, onUpdate: (x) => sheetFx.setY(sh, x), onDone: () => { sh._a = null; if (done) done(); } });
  },
  hide() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; m.style.removeProperty('--p'); renderDock(); },
  dismiss(sh, v) {
    if (sh.classList.contains('closing')) return;
    sh.classList.add('closing'); renderDock();
    sheetFx.to(sh, sh.offsetHeight + 24, v, () => { if (sh.isConnected && sh.classList.contains('closing')) sheetFx.hide(); });
  },
};

function closeModal(now) {
  const m = $('#modal'), sh = m.firstElementChild;
  if (now || m.hidden || !sh || !sh._init || !isPhone() || calm()) { if (sh && sh._a) sh._a.stop(); sheetFx.hide(); return; }
  sheetFx.dismiss(sh, 0);
}

// Sheets rise on a spring when they appear (any open path), and can be grabbed at any instant.
function bindSheets() {
  const ov = $('#modal');
  new MutationObserver(() => {
    const sh = ov.firstElementChild;
    if (!sh || !sh.classList.contains('sheet') || sh._init || ov.hidden || !isPhone() || calm()) return;
    sh._init = true; sh.style.animation = 'none';
    sheetFx.setY(sh, sh.offsetHeight || innerHeight);
    sheetFx.to(sh, 0, 0);
  }).observe(ov, { childList: true });

  let sh = null, sx = 0, sy = 0, y0 = 0, live = false, hist = [];
  ov.addEventListener('touchstart', (e) => {
    const s = e.target.closest('.sheet');
    if (!s || e.touches.length !== 1 || !s._init) return;
    const t = e.touches[0], head = t.clientY - s.getBoundingClientRect().top < 64;
    if (!head && !(s.scrollTop <= 0 && !e.target.closest('input,textarea,select'))) return;
    sh = s; sx = t.clientX; sy = t.clientY; hist = [{ t: e.timeStamp, y: sy }]; y0 = s._y || 0; live = false;
    if (s._a && Math.abs(y0) > 2) { s._a.stop(); s._a = null; s.classList.remove('closing'); live = true; } // grabbed mid-flight
  }, { passive: true });
  ov.addEventListener('touchmove', (e) => {
    if (!sh) return;
    const t = e.touches[0], dy = t.clientY - sy;
    if (!live) {
      if (dy > 10 && dy > Math.abs(t.clientX - sx) * 1.5 && sh.scrollTop <= 0) { live = true; sy = t.clientY; y0 = sh._y || 0; if (sh._a) { sh._a.stop(); sh._a = null; } }
      else return;
    }
    e.preventDefault();
    const y = y0 + (t.clientY - sy);
    sheetFx.setY(sh, y < 0 ? -rubber(-y, sh.offsetHeight) : y);
    hist.push({ t: e.timeStamp, y: t.clientY }); while (hist.length > 2 && e.timeStamp - hist[0].t > 100) hist.shift();
  }, { passive: false });
  const end = () => {
    if (!sh) return;
    const s = sh; sh = null;
    if (!live) return;
    const a = hist[0], b = hist[hist.length - 1], v = b.t > a.t ? ((b.y - a.y) / (b.t - a.t)) * 1000 : 0;
    const h = s.offsetHeight, y = s._y || 0;
    if (navigator.vibrate && y + project(v) > Math.min(h / 2, 260)) navigator.vibrate(5);
    if (y + project(v) > Math.min(h / 2, 260)) sheetFx.dismiss(s, v); else sheetFx.to(s, 0, v);
  };
  ov.addEventListener('touchend', end); ov.addEventListener('touchcancel', end);
}

// Dynamic Type: follow the iOS text-size setting (CSS multiplies phone font sizes by --dt).
function dynType() {
  const r = parseFloat(getComputedStyle(document.documentElement).fontSize) / 17;
  document.documentElement.style.setProperty('--dt', String(Math.min(1.6, Math.max(1, r || 1))));
}

function openModal(title, body, onSubmit, saveLabel = 'Save', extra = '') {
  const m = $('#modal');
  m.innerHTML = `<form class="sheet" id="mform" role="dialog" aria-modal="true">
    <div class="row between"><h2>${title}</h2><button type="button" class="x" aria-label="Close" data-act="close">${ic('x')}</button></div>
    ${body}
    <div class="foot">${extra}<span class="grow"></span>
      <button type="button" class="btn ghost" data-act="close">${onSubmit ? 'Cancel' : 'Close'}</button>
      ${onSubmit ? `<button class="btn primary">${saveLabel}</button>` : ''}
    </div></form>`;
  m.hidden = false;
  if (onSubmit) {
    $('#mform').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await onSubmit(new FormData(e.target)); closeModal(); render(); }
      catch (err) { alert(err.message || err); }
    });
  }
}

function openLogModal(typeId) {
  const info = typeInfo(typeId);
  openModal(`${ic(info.icon)} ${esc(info.name)}`,
    field('Date', `<input type="date" name="day" required value="${ui.logDay}">`) +
    field('Time', `<input type="time" name="time" required value="${nowTime()}">`) +
    (info.detail === 'level' ? field(`How much did ${esc(profile().name)} drink?`, `<select name="level"><option>a little</option><option selected>medium</option><option>a lot</option></select>`) : '') +
    field(info.detail === 'note' ? 'What was it? (optional)' : 'Notes (optional)', `<input name="note">`),
    async (f) => save('log', { type: typeId, ts: stamp(f.get('day'), f.get('time')), level: f.get('level') || '', note: f.get('note').trim() }),
    'Log it');
}

async function quick(id) {
  const info = typeInfo(id);
  if (info.detail || ui.logDay !== today()) return openLogModal(id);
  const rec = await save('log', { type: id, ts: new Date().toISOString(), level: '', note: '' });
  toast('Logged ' + (info.name || id), () => remove('log', rec.id));
}

function openTrackerModal() {
  openModal('New tracker',
    field('What do you want to track?', `<input name="name" required placeholder="e.g. Chewed a shoe">`) +
    field('How often?', `<input name="freq" placeholder="e.g. 3 times a day">`) +
    field('Notes (optional)', `<textarea name="notes" rows="2"></textarea>`),
    async (f) => {
      const name = f.get('name').trim();
      if (!name) throw new Error('Give it a name');
      await save('trackType', { name, freq: f.get('freq').trim(), notes: f.get('notes').trim() });
    });
}

function openTaskModal(id) {
  const k = id ? get('task', id) : { everyDays: 1 };
  openModal(id ? 'Edit care task' : 'New care task',
    field('Name', `<input name="name" required value="${esc(k.name || '')}" placeholder="e.g. Nail trim">`) +
    field('How often (days)', `<input name="every" type="number" min="1" required value="${k.everyDays}">`) +
    `<p class="muted small">1 = every day, 7 = weekly, 30 = monthly.</p>`,
    async (f) => {
      const name = f.get('name').trim();
      if (!name) throw new Error('Give it a name');
      await save('task', { ...k, name, everyDays: Math.max(1, parseInt(f.get('every'), 10) || 1) });
    }, 'Save',
    id && !k.base ? `<button type="button" class="btn danger" data-act="del-task" data-id="${id}">Delete</button>` : '');
}

function openDoneModal(id) {
  const k = get('task', id);
  openModal(`Log: ${esc(k.name)}`,
    field('Date it was done', `<input type="date" name="day" required value="${today()}">`),
    async (f) => save('careLog', { taskId: id, ts: stamp(f.get('day'), '12:00') }));
}

function openEventModal(ev, day) {
  const e = ev || { date: day, time: '', title: '', category: cats()[0]?.id, notes: '' };
  openModal(ev ? 'Edit event' : 'New event',
    field('Title', `<input name="title" required value="${esc(e.title)}" placeholder="Vet checkup, grooming…">`) +
    field('Date', `<input type="date" name="date" required value="${e.date}">`) +
    field('Time (optional)', `<input type="time" name="time" value="${e.time || ''}">`) +
    field('Category', `<select name="category">${cats().map((c) => `<option value="${c.id}" ${c.id === e.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`) +
    field('Notes', `<textarea name="notes" rows="2">${esc(e.notes)}</textarea>`),
    async (f) => {
      const title = f.get('title').trim();
      if (!title) throw new Error('Add a title');
      await save('event', { ...e, title, date: f.get('date'), time: f.get('time'), category: f.get('category'), notes: f.get('notes').trim() });
    }, 'Save',
    ev ? `<button type="button" class="btn danger" data-act="del-event" data-id="${ev.id}">Delete</button>` : '');
}

function openCatModal(id) {
  const c = id ? get('category', id) : { name: '', color: '#8b5cf6' };
  openModal(id ? 'Edit category' : 'New category',
    field('Name', `<input name="name" required value="${esc(c.name)}">`) +
    field('Color', `<input type="color" name="color" value="${c.color}">`),
    async (f) => {
      const name = f.get('name').trim();
      if (!name) throw new Error('Give it a name');
      await save('category', { ...c, name, color: f.get('color') });
    }, 'Save',
    id ? `<button type="button" class="btn danger" data-act="del-cat" data-id="${id}">Delete</button>` : '');
}

function openProfileModal(isNew) {
  const p = isNew ? { name: '', breed: '', dob: '', photo: null } : profile();
  openModal(isNew ? 'Add a pet' : 'Edit profile',
    `<div class="photo-edit">${avatar(p, 'photo', 'id="pPrev"')}<input type="file" name="photo" accept="image/*" data-preview="pPrev"></div>` +
    field('Name', `<input name="name" required value="${esc(p.name)}">`) +
    field('Breed', `<input name="breed" value="${esc(p.breed)}">`) +
    field('Birthday (age updates automatically)', `<input type="date" name="dob" required value="${p.dob || ''}">`),
    async (f) => {
      const file = f.get('photo');
      const photo = file && file.size ? await readImage(file, 800) : p.photo;
      const id = isNew ? crypto.randomUUID() : p.id;
      await save('profile', { ...p, id, order: p.order || Date.now(), name: f.get('name').trim(), breed: f.get('breed').trim(), dob: f.get('dob'), photo });
      if (isNew) {
        await save('vet', { id, name: '', phone: '', address: '' });
        for (const [name, everyDays] of [['Brushing', 1], ['Vitamins', 1], ['Grooming', 30]]) await save('task', { name, everyDays, base: true, pet: id });
        setPet(id);
      }
    }, 'Save', isNew && !pets().length ? `<button type="button" class="btn ghost" data-act="join-hh">Join a shared Pawlog instead</button>` : !isNew && pets().length > 1 ? `<button type="button" class="btn danger" data-act="del-pet" data-id="${p.id}">Remove pet</button>` : '');
}

function openVetModal() {
  const v = vet();
  openModal('Vet info',
    field('Clinic / vet name', `<input name="name" value="${esc(v.name)}">`) +
    field('Phone', `<input name="phone" value="${esc(v.phone)}">`) +
    field('Address', `<input name="address" value="${esc(v.address)}">`),
    async (f) => save('vet', { ...v, id: ui.petId, name: f.get('name').trim(), phone: f.get('phone').trim(), address: f.get('address').trim() }));
}

function openShotModal(id, prefill = '') {
  const s = id ? get('shot', id) : { name: prefill, given: today(), next: '', about: '' };
  openModal(id ? 'Edit shot' : 'Record a shot',
    `<datalist id="shotNames">${RECOMMENDED.map((r) => `<option value="${r.name}">`).join('')}</datalist>` +
    field('Shot', `<input name="name" required list="shotNames" value="${esc(s.name)}" placeholder="e.g. DHPP">`) +
    field('Date given', `<input type="date" name="given" max="${today()}" value="${s.given || ''}">`) +
    field('Next due (optional, leave empty if you don\'t know)', `<input type="date" name="next" value="${s.next || ''}">`) +
    field('What it does (shows when you tap ?)', `<textarea name="about" rows="4">${esc(s.about || shotAbout(s.name))}</textarea>`),
    async (f) => {
      const name = f.get('name').trim();
      if (!name) throw new Error('Name the shot');
      await save('shot', { ...s, name, given: f.get('given'), next: f.get('next'), about: f.get('about').trim() || shotAbout(name) });
    }, 'Save',
    id ? `<button type="button" class="btn danger" data-act="del-shot" data-id="${id}">Delete</button>` : '');
}

function sinceText(d) {
  const n = diffDays(today(), d);
  if (n <= 0) return 'today';
  if (n < 60) return n + ' day' + (n === 1 ? '' : 's') + ' ago';
  return Math.round(n / 30.4) + ' months ago';
}

function openExamModal(id) {
  const x = id ? get('vetNote', id) : { date: today(), title: '', vet: vet().name || '', text: '' };
  openModal(id ? 'Edit vet exam' : 'Add vet exam',
    field('Date of exam', `<input type="date" name="date" required max="${today()}" value="${x.date}">`) +
    field('Reason', `<input name="title" required value="${esc(x.title)}" placeholder="e.g. Annual checkup, Puppy shots, Limping">`) +
    field('Vet or clinic (optional)', `<input name="vet" value="${esc(x.vet || '')}">`) +
    field('Notes (optional)', `<textarea name="text" rows="4">${esc(x.text || '')}</textarea>`),
    async (f) => {
      const title = f.get('title').trim();
      if (!title) throw new Error('Add a reason');
      await save('vetNote', { ...x, kind: 'exam', date: f.get('date'), title, vet: f.get('vet').trim(), text: f.get('text').trim() });
    }, 'Save', id ? `<button type="button" class="btn danger" data-act="del-note" data-id="${id}">Delete</button>` : '');
}

async function pdfThumb(buf) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  const page = await (await pdfjsLib.getDocument({ data: buf }).promise).getPage(1);
  const vp = page.getViewport({ scale: 1 }), k = 360 / vp.width, v = page.getViewport({ scale: k });
  const c = document.createElement('canvas'); c.width = v.width; c.height = v.height;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: g, viewport: v }).promise;
  return c.toDataURL('image/jpeg', 0.75);
}

function openReportModal() {
  openModal('Upload medical report',
    field('File (PDF or photo)', `<input type="file" name="file" accept="application/pdf,image/*" required>`) +
    field('Title', `<input name="title" required placeholder="e.g. Blood work, Vaccine record">`) +
    field('Date', `<input type="date" name="date" required value="${today()}">`),
    async (f) => {
      const file = f.get('file'), title = f.get('title').trim();
      if (!file || !file.size) throw new Error('Choose a file');
      if (!title) throw new Error('Add a title');
      let data, mime, thumb = '';
      if (file.type === 'application/pdf') {
        if (file.size > 1.5e6) throw new Error('That PDF is over 1.5 MB. Try a smaller file or upload a photo of it.');
        data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
        mime = 'application/pdf';
        try { thumb = await pdfThumb(await file.arrayBuffer()); } catch { /* no preview, the file still uploads */ }
      } else { data = await readImage(file, 1800, 0.8); mime = 'image/jpeg'; thumb = await readImage(file, 360, 0.75); }
      await save('vetNote', { kind: 'report', date: f.get('date'), title, file: data, mime, thumb });
    }, 'Upload');
}

function viewReport(id) {
  const x = get('vetNote', id);
  openModal(esc(x.title), `<p class="muted small">${fmtDate(x.date)}</p>` + (x.mime === 'application/pdf'
    ? `<iframe class="rpt" src="${x.file}" title="${esc(x.title)}"></iframe>` : `<img class="rpt" src="${x.file}" alt="${esc(x.title)}">`), null, 'Close');
}

function openWeightModal() {
  openModal('Log weight',
    field('Date', `<input type="date" name="date" required value="${today()}">`) +
    field('Weight (lb)', `<input type="number" name="lb" step="0.1" min="0" required>`),
    async (f) => {
      const lb = parseFloat(f.get('lb'));
      if (!(lb > 0)) throw new Error('Enter a weight');
      await save('weight', { date: f.get('date'), lb, at: Date.now() });
    });
}

function openNoteModal() {
  openModal('Add vet note',
    field('Date', `<input type="date" name="date" required value="${today()}">`) +
    field('Title', `<input name="title" required placeholder="e.g. Ear infection, follow-up">`) +
    field('What did the vet say or give you?', `<textarea name="text" rows="6"></textarea>`),
    async (f) => {
      const title = f.get('title').trim();
      if (!title) throw new Error('Add a title');
      await save('vetNote', { date: f.get('date'), title, text: f.get('text').trim() });
    });
}

function openTrainingModal(id, preset = '') {
  const tr = id ? get('training', id) : { name: preset, times: [], notes: '' };
  openModal(id ? 'Edit training' : 'New training',
    field('What are you working on?', `<input name="name" required value="${esc(tr.name)}" placeholder="e.g. Sit, Leave it, Recall">`) +
    field('Times to practice (comma separated)', `<input name="times" value="${tr.times.map(fmtTime).join(', ')}" placeholder="9:00 AM, 4:30 PM">`) +
    field('Notes (optional)', `<textarea name="notes" rows="2">${esc(tr.notes)}</textarea>`),
    async (f) => {
      const name = f.get('name').trim();
      if (!name) throw new Error('Name the training');
      await save('training', { ...tr, name, times: parseTimes(f.get('times')), notes: f.get('notes').trim() });
    }, 'Save',
    id ? `<button type="button" class="btn danger" data-act="del-training" data-id="${id}">Delete</button>` : '');
}

function openSessionModal(trainingId) {
  const trs = all('training');
  if (!trs.length) throw new Error('Add a training on the Training page first');
  openModal('Rate a session',
    field('Training', `<select name="trainingId">${trs.map((t) => `<option value="${t.id}" ${t.id === trainingId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`) +
    field('Date', `<input type="date" name="day" required value="${today()}">`) +
    field('Time', `<input type="time" name="time" required value="${nowTime()}">`) +
    `<div class="f"><span>How did it go?</span><div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-act="star" data-v="${n}">★</button>`).join('')}</div><input type="hidden" name="stars" value="0"></div>` +
    field('Notes', `<textarea name="notes" rows="3" placeholder="What went well, what to work on next"></textarea>`),
    async (f) => {
      const stars = +f.get('stars');
      if (!stars) throw new Error('Pick a star rating first');
      await save('session', { trainingId: f.get('trainingId'), ts: stamp(f.get('day'), f.get('time')), stars, notes: f.get('notes').trim() });
    }, 'Save session');
}

function viewSession(id) {
  const s = get('session', id), tr = get('training', s.trainingId);
  openModal(esc(tr ? tr.name : 'Session'),
    `<p class="muted">${fmtDate(dayOf(s.ts))} at ${fmtTs(s.ts)}</p>
     <div class="big-stars">${'★'.repeat(s.stars)}${'☆'.repeat(5 - s.stars)}</div>
     <p style="white-space:pre-wrap">${esc(s.notes) || '<span class="muted">No notes.</span>'}</p>`,
    null, 'Close',
    `<button type="button" class="btn danger" data-act="del-session" data-id="${id}">Delete</button>`);
}

function openSupplyModal() {
  openModal('Add to supplies',
    field('What is it?', `<input name="name" required placeholder="e.g. Snuffle mat">`) +
    field('Price (optional)', `<input name="price" type="number" step="0.01" min="0">`) +
    field('Link to the product (optional)', `<input name="url" inputmode="url" placeholder="https://…">`) +
    field('Notes (optional)', `<input name="notes">`) +
    `<div class="f"><span>Pick an icon</span><div class="icons">${SUPPLY_ICONS.map((ic, i) => `<label><input type="radio" name="icon" value="${ic}" ${i === 0 ? 'checked' : ''}><span>${ic}</span></label>`).join('')}</div></div>` +
    field('Or upload a photo (replaces the icon)', `<input type="file" name="photo" accept="image/*">`),
    async (f) => {
      const name = f.get('name').trim();
      if (!name) throw new Error('Name the item');
      const file = f.get('photo');
      const photo = file && file.size ? await readImage(file, 500) : null;
      let url = f.get('url').trim();
      if (url) {
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        try { if (!/^https?:$/.test(new URL(url).protocol)) throw 0; } catch { throw new Error('That link doesn\'t look right.'); }
      }
      await save('supply', { url, name, price: f.get('price') ? +f.get('price') : null, notes: f.get('notes').trim(), icon: f.get('icon'), photo, bought: false });
    }, 'Add');
}

/* ---------- actions (clicks) ---------- */
const actions = {
  ...cloudActions,
  close: closeModal,
  collapse: () => setSidebar(!$('.app').classList.contains('collapsed')),
  'log-day': (el) => { ui.logDay = addDays(ui.logDay, +el.dataset.v); },
  'log-today': () => { ui.logDay = today(); },
  quick: (el, id) => quick(id),
  'del-log': (el, id) => remove('log', id),
  'new-tracker': openTrackerModal,
  'del-type': (el, id) => remove('trackType', id),
  'toggle-task': async (el, id) => {
    const k = get('task', id);
    const want = el.type === 'checkbox' ? el.checked : !doneToday(k);
    if (want) return save('careLog', { taskId: id, ts: new Date().toISOString() });
    for (const c of all('careLog').filter((c) => c.taskId === id && dayOf(c.ts) === today())) await remove('careLog', c.id);
  },
  'task-done': (el, id) => openDoneModal(id),
  'edit-say': openSayModal,
  'reset-say': async () => { await save('profile', { ...profile(), say: '' }); closeModal(); },
  'clear-done': () => {
    const d = all('task').filter((x) => x.todo && x.done);
    openModal('Clear completed?', `<p class="muted">This deletes ${d.length} completed to-do${d.length === 1 ? '' : 's'}. It can't be undone.</p>`,
      async () => { for (const k of d) await remove('task', k.id); }, 'Clear');
  },
  'del-todo-row': (el, id) => remove('task', id),
  'new-todo': () => openTodoModal(),
  'edit-todo': (el, id) => openTodoModal(id),
  'del-todo': async (el, id) => { await remove('task', id); closeModal(); },
  'toggle-todo': (el, id) => { const k = get('task', id); return save('task', { ...k, done: el.checked, doneDay: el.checked ? today() : '' }); },
  'new-task': () => openTaskModal(),
  'edit-task': (el, id) => openTaskModal(id),
  'del-task': async (el, id) => { await remove('task', id); closeModal(); },
  'cal-month': (el) => { const m = ui.calMonth; ui.calMonth = new Date(m.getFullYear(), m.getMonth() + +el.dataset.v, 1); },
  'cal-today': () => { const n = new Date(); ui.calMonth = new Date(n.getFullYear(), n.getMonth(), 1); ui.selDay = today(); },
  'sel-day': (el, id) => { ui.selDay = id; },
  'cat-filter': (el, id) => { ui.hiddenCats.has(id) ? ui.hiddenCats.delete(id) : ui.hiddenCats.add(id); },
  'cal-sort': () => { ui.calSort = ui.calSort === 'time' ? 'category' : 'time'; },
  'new-event': () => openEventModal(null, ui.selDay),
  'edit-event': (el, id) => openEventModal(get('event', id)),
  'del-event': async (el, id) => { await remove('event', id); closeModal(); },
  'edit-vet': openVetModal,
  about: (el, id) => { ui.openAbout.has(id) ? ui.openAbout.delete(id) : ui.openAbout.add(id); },
  'new-shot': (el) => openShotModal(null, el.dataset.v || ''),
  'edit-shot': (el, id) => openShotModal(id),
  'del-shot': async (el, id) => { await remove('shot', id); closeModal(); },
  'new-weight': openWeightModal,
  'del-weight': (el, id) => remove('weight', id),
  'new-note': openNoteModal,
  'del-note': async (el, id) => { await remove('vetNote', id); closeModal(); },
  'new-pnote': () => openNoteEdit(),
  'edit-pnote': (el, id) => openNoteEdit(id),
  'new-exam': () => openExamModal(),
  'edit-exam': (el, id) => openExamModal(id),
  'new-report': openReportModal,
  'view-report': (el, id) => viewReport(id),
  'del-report': (el, id) => openModal('Delete report?', `<p class="muted">${esc(get('vetNote', id).title)} will be deleted for everyone in this Pawlog.</p>`, () => remove('vetNote', id), 'Delete'),
  'new-training': () => openTrainingModal(),
  'train-tab': (el, id) => { ui.trainTab = id; },
  'train-this': (el, id) => openTrainingModal(null, GUIDES[+id][0].replace(/ \(.*\)| training/, '')),
  'edit-training': (el, id) => openTrainingModal(id),
  'del-training': async (el, id) => { await remove('training', id); closeModal(); },
  'rate-session': (el, id) => openSessionModal(id),
  'view-session': (el, id) => viewSession(id),
  'del-session': async (el, id) => { await remove('session', id); closeModal(); },
  'new-supply': openSupplyModal,
  'open-link': (el, id) => { const u = get('supply', id).url; const o = window.__TAURI__ && window.__TAURI__.opener; return o ? o.openUrl(u) : window.open(u, '_blank', 'noopener'); },
  'toggle-bought': async (el, id) => { const s = get('supply', id); await save('supply', { ...s, bought: !s.bought }); },
  'del-supply': (el, id) => remove('supply', id),
  'edit-profile': () => openProfileModal(false),
  'hero-add': openAdd,
  'toast-undo': () => { const t = $('#toast'); if (t && t._undo) { t._undo(); t._undo = null; } if (t) t.classList.remove('show'); render(); },
  'hero-log': () => { const q = document.getElementById('quicklog'); if (q) q.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
  'reset-home': () => { try { localStorage.removeItem('pawlogHome'); } catch { /* ignore */ } render(); },
  'pet-menu': () => { ui.petMenu = !ui.petMenu; },
  'pick-pet': (el, id) => setPet(id),
  more: () => openMore(),
  tour: () => { closeModal(); maybeOnboard(true); },
  'more-pet': (el, id) => { setPet(id); closeModal(); },
  'new-pet': () => { ui.petMenu = false; openProfileModal(true); },
  'del-pet': async (el, id) => {
    if (!armed(el, 'Tap again: deletes all their data')) return;
    for (const k of PET_KINDS) for (const r of allRaw(k)) if (petOf(r) === id) await remove(k, r.id);
    await remove('profile', id); await remove('vet', id);
    setPet(pets()[0]?.id || 'main'); closeModal();
  },
  'new-photo': () => openPhotoModal(),
  'view-photo': (el, id) => openPhotoModal(id),
  'del-photo': async (el, id) => { if (!armed(el, 'Tap again to delete')) return; await remove('photo', id); closeModal(); },
  'new-cat': () => openCatModal(),
  'edit-cat': (el, id) => openCatModal(id),
  'del-cat': async (el, id) => { await remove('category', id); closeModal(); },
  star: (el, _, v) => {
    const wrap = el.parentElement;
    wrap.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i < +v));
    wrap.parentElement.querySelector('input[name=stars]').value = v;
  },
};

document.addEventListener('click', async (e) => {
  if (ui.petMenu && !e.target.closest('.brandwrap')) { ui.petMenu = false; render(); }
  const nav = e.target.closest('[data-nav]');
  if (nav) {
    ui.page = nav.dataset.nav; closeModal(); render(); playEnter();
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const run = async () => {
    try {
      await actions[el.dataset.act]?.(el, el.dataset.id, el.dataset.v);
      render();
    } catch (err) {
      alert(err.message || err);
    }
  };
  // Quick-log waits a beat so a double-click can open the "when did it happen?" popup instead.
  if (el.dataset.act === 'quick') { clearTimeout(ui.quickT); if (e.detail <= 1) ui.quickT = setTimeout(run, 260); return; }
  await run();
});

document.addEventListener('dblclick', (e) => {
  const el = e.target.closest('[data-act="quick"]');
  if (el) { clearTimeout(ui.quickT); openLogModal(el.dataset.id); }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.preview && t.files[0]) {
    const el = $('#' + t.dataset.preview), url = URL.createObjectURL(t.files[0]);
    if (el.tagName === 'IMG') el.src = url; else el.outerHTML = `<img id="${t.dataset.preview}" class="photo" src="${url}" alt="">`;
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('div[data-act]')) { e.preventDefault(); e.target.click(); }
});

$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

// Yesterday's log entries are cleared automatically (also saves storage); today's stay.
async function purgeOldLogs() {
  const t = today();
  for (const l of allRaw('log').filter((x) => dayOf(x.ts) < t)) await remove('log', l.id);
}
let purgeDay = '';
setInterval(() => { if (purgeDay !== today() && cloud.on !== undefined) { purgeDay = today(); purgeOldLogs().then(render); } }, 60000);

// Keep the pet's mood current without needing a click.
setInterval(() => { const h = $('#heroart'); if (h) h.innerHTML = heroArt(); }, 60000);

/* ---------- first-run tour: custom illustrations of the most useful parts ---------- */
const ONB_PAL = '--a:#6244e0;--l:#ece8f8;--m:#cfe8d8;--s:#d5e4f5;--p:#f6d9b8;--d:#27183d';
const ONB = [
  { t: 'Welcome to Pawlog', d: 'One calm place for everything your dog needs: meals, walks, vet visits, training and memories.',
    art: `<svg viewBox="0 0 320 220" role="img" aria-label="A happy puppy surrounded by hearts and paw prints"><circle cx="160" cy="112" r="92" fill="var(--l)"/><circle cx="160" cy="112" r="64" fill="#fff"/><g class="fl"><path d="M58 60c-8-12-26 0-14 14l14 12 14-12c12-14-6-26-14-14z" fill="#f08aa0"/><path d="M268 150c-6-9-19 0-10 10l10 9 10-9c9-10-4-19-10-10z" fill="#f08aa0"/></g><g fill="var(--a)" opacity=".85"><ellipse cx="262" cy="64" rx="7" ry="9"/><circle cx="249" cy="52" r="4.5"/><circle cx="262" cy="46" r="4.5"/><circle cx="275" cy="52" r="4.5"/></g><g fill="#e0b070"><ellipse cx="52" cy="168" rx="7" ry="9"/><circle cx="39" cy="156" r="4.5"/><circle cx="52" cy="150" r="4.5"/><circle cx="65" cy="156" r="4.5"/></g><g transform="translate(160 112)"><ellipse cx="-36" cy="-6" rx="17" ry="30" fill="#c8945a" transform="rotate(14 -36 -6)"/><ellipse cx="36" cy="-6" rx="17" ry="30" fill="#c8945a" transform="rotate(-14 36 -6)"/><circle cx="0" cy="0" r="38" fill="#e0b070"/><ellipse cx="0" cy="14" rx="22" ry="17" fill="#f8e8cf"/><circle cx="-14" cy="-6" r="5" fill="var(--d)"/><circle cx="14" cy="-6" r="5" fill="var(--d)"/><ellipse cx="0" cy="6" rx="7" ry="5" fill="var(--d)"/><path d="M-8 18q8 8 16 0" fill="none" stroke="var(--d)" stroke-width="2.5" stroke-linecap="round"/><ellipse cx="0" cy="26" rx="5" ry="4" fill="#f08aa0"/></g></svg>` },
  { t: 'Your day at a glance', d: 'The Today ring and to-do list show what is done and what is left. Set priorities, pick a day, and see who added each task.',
    art: `<svg viewBox="0 0 320 220" role="img" aria-label="A progress ring beside a checklist"><rect x="22" y="34" width="276" height="160" rx="22" fill="#fff" stroke="var(--l)" stroke-width="2"/><circle cx="92" cy="114" r="40" fill="none" stroke="var(--l)" stroke-width="12"/><circle class="ring" cx="92" cy="114" r="40" fill="none" stroke="var(--a)" stroke-width="12" stroke-linecap="round" stroke-dasharray="168 252" transform="rotate(-90 92 114)"/><text x="92" y="120" text-anchor="middle" font-size="20" font-weight="700" fill="var(--d)">2/3</text><g><circle cx="170" cy="82" r="9" fill="var(--a)"/><path d="m166 82 3 3 5-6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="188" y="77" width="82" height="10" rx="5" fill="var(--l)"/><circle cx="170" cy="114" r="9" fill="var(--a)"/><path d="m166 114 3 3 5-6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="188" y="109" width="64" height="10" rx="5" fill="var(--l)"/><circle cx="170" cy="146" r="9" fill="none" stroke="#c9c2e6" stroke-width="2.5"/><rect x="188" y="141" width="76" height="10" rx="5" fill="var(--l)"/></g><rect x="236" y="20" width="58" height="26" rx="13" fill="#f0a35a"/><text x="265" y="38" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">High</text></svg>` },
  { t: 'Log anything in one tap', d: 'Meals, water, walks, potty breaks and naps. Double-click or double-tap an item to add it for an earlier time you forgot to log.',
    art: `<svg viewBox="0 0 320 220" role="img" aria-label="Four quick-log tiles and a Logged confirmation"><g><rect x="34" y="28" width="116" height="74" rx="18" fill="var(--p)"/><path d="M72 62h40a20 20 0 0 1-40 0z" fill="#fff"/><rect x="68" y="56" width="48" height="7" rx="3.500" fill="#d99a52"/><rect x="170" y="28" width="116" height="74" rx="18" fill="var(--s)"/><path d="M228 44c10 14 16 20 16 28a16 16 0 0 1-32 0c0-8 6-14 16-28z" fill="#5b9be0"/><rect x="34" y="118" width="116" height="74" rx="18" fill="var(--m)"/><g fill="#4f9a6a"><ellipse cx="92" cy="165" rx="12" ry="9"/><circle cx="76" cy="152" r="5"/><circle cx="87" cy="146" r="5"/><circle cx="99" cy="146" r="5"/><circle cx="109" cy="152" r="5"/></g><rect x="170" y="118" width="116" height="74" rx="18" fill="var(--l)"/><path d="M212 166a20 20 0 1 0 28-18 16 16 0 0 1-28 18z" fill="var(--a)"/></g><g class="tap"><circle cx="228" cy="72" r="22" fill="none" stroke="var(--a)" stroke-width="3" opacity=".45"/><circle cx="228" cy="72" r="9" fill="var(--a)" opacity=".9"/></g><rect x="196" y="176" width="108" height="30" rx="15" fill="var(--d)"/><path d="m214 191 4 4 8-9" fill="none" stroke="#9be2b4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><text x="260" y="196" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">Logged</text></svg>` },
  { t: 'Health and vet, organised', d: 'Keep shots, exams, weight and vet reports together, including PDF previews, so nothing is lost before the next visit.',
    art: `<svg viewBox="0 0 320 220" role="img" aria-label="A shield with a cross, a vaccine card and a weight chart"><rect x="22" y="48" width="104" height="132" rx="14" fill="#fff" stroke="var(--l)" stroke-width="2"/><rect x="36" y="64" width="46" height="9" rx="4.500" fill="var(--a)"/><g fill="var(--l)"><rect x="36" y="88" width="74" height="8" rx="4"/><rect x="36" y="108" width="74" height="8" rx="4"/><rect x="36" y="128" width="74" height="8" rx="4"/></g><g fill="none" stroke="#4f9a6a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m96 86 3 3 6-7"/><path d="m96 106 3 3 6-7"/></g><path d="M160 30l40 14v44c0 28-18 48-40 58-22-10-40-30-40-58V44z" fill="var(--a)" transform="translate(0 6)"/><path d="M160 66v34M143 83h34" stroke="#fff" stroke-width="9" stroke-linecap="round"/><rect x="198" y="96" width="102" height="84" rx="14" fill="#fff" stroke="var(--l)" stroke-width="2"/><polyline class="ln" points="212,162 232,146 250,152 270,124 288,116" fill="none" stroke="#4f9a6a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="288" cy="116" r="5" fill="#4f9a6a"/><rect x="212" y="106" width="34" height="7" rx="3.500" fill="var(--l)"/></svg>` },
  { t: 'Training, photos and supplies', d: 'Follow step-by-step guides for sit, place, crate and leave it. Save memories in the gallery and keep a shopping list.',
    art: `<svg viewBox="0 0 320 220" role="img" aria-label="A graduation cap, a photo frame and a shopping bag"><g><rect x="20" y="62" width="82" height="104" rx="16" fill="var(--l)"/><path d="M61 90l30 12-30 12-30-12z" fill="var(--a)"/><path d="M44 110v14c0 6 34 6 34 0v-14" fill="none" stroke="var(--a)" stroke-width="5"/><path d="M91 102v20" stroke="var(--a)" stroke-width="3" stroke-linecap="round"/><rect x="118" y="30" width="86" height="112" rx="16" fill="#fff" stroke="var(--s)" stroke-width="3"/><rect x="128" y="40" width="66" height="70" rx="10" fill="var(--s)"/><circle cx="176" cy="58" r="8" fill="#f6c453"/><path d="M128 110V90l20-20 18 20 10-10 18 20v10z" fill="#4f9a6a"/><rect x="132" y="122" width="40" height="8" rx="4" fill="var(--s)"/><rect x="220" y="70" width="82" height="100" rx="16" fill="var(--p)"/><path d="M242 98v-8a19 19 0 0 1 38 0v8" fill="none" stroke="#d99a52" stroke-width="5" stroke-linecap="round"/><g fill="#d99a52"><ellipse cx="261" cy="140" rx="11" ry="8"/><circle cx="247" cy="128" r="4.500"/><circle cx="258" cy="122" r="4.500"/><circle cx="268" cy="122" r="4.500"/><circle cx="277" cy="128" r="4.500"/></g></g></svg>` },
  { t: 'Share it with family', d: 'Invite family or a sitter into the same Pawlog. Everyone sees the same logs and tasks, kept in sync in real time.',
    art: `<svg viewBox="0 0 320 220" role="img" aria-label="Two computers kept in sync through the cloud"><path d="M118 50a26 26 0 0 1 50-8 22 22 0 0 1 38 14 18 18 0 0 1-4 36h-78a22 22 0 0 1-6-42z" fill="var(--l)" transform="translate(-4 -6)"/><path d="m146 52 8 8 16-18" fill="none" stroke="var(--a)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><rect x="22" y="112" width="118" height="74" rx="10" fill="#fff" stroke="var(--a)" stroke-width="4"/><rect x="12" y="190" width="138" height="8" rx="4" fill="var(--a)"/><circle cx="81" cy="144" r="13" fill="var(--m)"/><circle cx="81" cy="140" r="5" fill="#4f9a6a"/><path d="M71 156a10 8 0 0 1 20 0z" fill="#4f9a6a"/><rect x="180" y="112" width="118" height="74" rx="10" fill="#fff" stroke="var(--a)" stroke-width="4"/><rect x="170" y="190" width="138" height="8" rx="4" fill="var(--a)"/><circle cx="239" cy="144" r="13" fill="var(--p)"/><circle cx="239" cy="140" r="5" fill="#d99a52"/><path d="M229 156a10 8 0 0 1 20 0z" fill="#d99a52"/><g class="dash" fill="none" stroke="var(--a)" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 9"><path d="M104 100c6-12 14-22 22-30"/><path d="M216 100c-6-12-14-22-22-30"/></g></svg>` },
];
function maybeOnboard(force, onDone, onSeen) {
  const key = 'pawlogOnb';
  let seen = null; try { seen = localStorage.getItem(key); } catch { /* private mode */ }
  if (seen && !force) return onSeen && onSeen();
  const intro = !!onDone;   // first-run tour ends in sign-up
  let i = 0;
  const root = document.createElement('div');
  root.className = 'onb'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Welcome tour');
  const finish = (to) => { try { localStorage.setItem(key, '1'); } catch { /* ignore */ } root.remove(); document.removeEventListener('keydown', onKey); if (onDone) onDone(to || 'signup'); };
  const draw = () => {
    const s = ONB[i], last = i === ONB.length - 1;
    root.innerHTML = `<div class="onb-card" style="${ONB_PAL}"><button class="onb-skip" data-o="skip">${last ? '' : 'Skip'}</button>
      <div class="onb-art" key="${i}">${s.art}</div><h2>${s.t}</h2><p>${s.d}</p>
      <div class="onb-dots">${ONB.map((_, n) => `<span class="${n === i ? 'on' : ''}"></span>`).join('')}</div>
      <div class="onb-nav">${i ? '<button class="btn" data-o="back">Back</button>' : '<span></span>'}<button class="btn primary" data-o="next">${last ? (intro ? 'Create my account' : 'Done') : 'Next'}</button></div>${last && intro ? '<button class="onb-have" data-o="have">I already have an account</button>' : ''}</div>`;
    root.querySelector('[data-o=next]').focus();
  };
  const go = (n) => { if (n >= ONB.length) return finish(); i = Math.max(0, n); draw(); };
  const onKey = (e) => { if (e.key === 'ArrowRight') go(i + 1); else if (e.key === 'ArrowLeft') go(i - 1); else if (e.key === 'Escape') finish(); };
  root.addEventListener('click', (e) => { const b = e.target.closest('[data-o]'); if (!b) return; ({ next: () => go(i + 1), back: () => go(i - 1), skip: () => finish(), have: () => finish('signin') })[b.dataset.o](); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(root); draw();
}

boot().catch((err) => alert('Could not start Pawlog: ' + (err.message || err)));
