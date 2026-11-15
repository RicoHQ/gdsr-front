/* =====================================================================
   GDSR · Geometry Dash Song Ratings
   Front-end for the Supabase (Lovable Cloud) database.
   ===================================================================== */
"use strict";

const CONFIG = {
  SUPABASE_URL: "https://c--d7a6c76f-dfcc-4caa-a390-36c8a5e7cafa-prod.lovable.cloud",
  SUPABASE_KEY: "sb_publishable_2Vl-Rwf1mxy8san0hTPeoQ_t5WUv1WV",   // publishable key: safe in front-end code; RLS protects data
  AUDIO_BUCKET: "audio",
  BUCKET: 2,                       // seconds per bar in the favourite-part graph
  MAX_AUDIO_MB: 25
};
const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

/* =====================================================================
   UTILITIES
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const numOrNull = v => (v === null || v === undefined || v === "" || isNaN(+v)) ? null : +v;
const fmt = x => x === null || x === undefined ? "—" : (Math.round(x * 100) / 100).toFixed(2);
const num = n => Number(n || 0).toLocaleString("en-US");
const compact = n => n >= 1e6 ? (n/1e6).toFixed(1).replace(/\.0$/,"") + "M" : n >= 1e3 ? (n/1e3).toFixed(1).replace(/\.0$/,"") + "K" : String(n);
const mmss = s => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s/60) + ":" + String(s % 60).padStart(2,"0"); };
function parseLen(v){
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim(); let m;
  if ((m = s.match(/^(\d+):(\d{1,2})$/))) return +m[1] * 60 + +m[2];
  if ((m = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/))) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  if (/^\d+(\.\d+)?$/.test(s)) return +s;
  return null;
}
const lenText = v => { const p = parseLen(v); return p !== null ? mmss(p) : (v ? String(v) : "—"); };
const dateFmt = d => d ? new Date(d).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"}) : "—";
const tokens = q => (q || "").toLowerCase().split(/\s+/).filter(Boolean);
const matches = (hay, q) => { const t = tokens(q); if (!t.length) return true; const h = hay.toLowerCase(); return t.every(x => h.includes(x)); };
const scoreColor = s => s === null ? "#5a7064" : s >= 90 ? "#5cf09a" : s >= 80 ? "#34d17a" : s >= 70 ? "#9fd24c" : s >= 60 ? "#d9c24a" : "#e0894a";
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s).trim());
const safeName = n => n.normalize("NFKD").replace(/[^\w.\-]+/g, "_").slice(-80);
function hl(text, q){
  text = String(text ?? ""); const t = tokens(q);
  if (!t.length) return esc(text);
  const low = text.toLowerCase(), on = new Array(text.length).fill(false);
  t.forEach(tok => { let i = 0; while ((i = low.indexOf(tok, i)) !== -1){ for (let k = i; k < i + tok.length; k++) on[k] = true; i += tok.length; } });
  let out = "", open = false;
  for (let i = 0; i < text.length; i++){
    if (on[i] && !open){ out += "<mark>"; open = true; }
    if (!on[i] && open){ out += "</mark>"; open = false; }
    out += esc(text[i]);
  }
  return open ? out + "</mark>" : out;
}
function ytId(v){
  if (!v) return null; const s = String(v).trim(); let m;
  if ((m = s.match(/(?:youtu\.be\/|v=|embed\/|shorts\/|live\/)([\w-]{11})/))) return m[1];
  if (/^[\w-]{11}$/.test(s)) return s;
  return null;
}
function audioUrl(path){
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return sb.storage.from(CONFIG.AUDIO_BUCKET).getPublicUrl(path).data.publicUrl;
}
async function run(promise){
  const res = await promise;
  if (res.error) throw new Error(res.error.message || String(res.error));
  return res;
}
const missingRelation = err => /does not exist|could not find|schema cache|PGRST20[05]|42P01/i.test(String(err && err.message || err));
const store = {
  get(k, d){ try { const v = localStorage.getItem("gdsr-" + k); return v === null ? d : JSON.parse(v); } catch(_){ return d; } },
  set(k, v){ try { localStorage.setItem("gdsr-" + k, JSON.stringify(v)); } catch(_){} }
};
function download(filename, text, type = "application/json"){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], {type}));
  a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
async function copyText(t, label = "Copied"){
  try { await navigator.clipboard.writeText(t); toast(label); } catch(_){ toast("Couldn't copy. Select and copy manually.", true); }
}
function storageError(e){
  const m = String(e && e.message || e);
  if (/bucket not found/i.test(m)) return "Audio storage isn't set up yet. An admin needs to run supabase/migration.sql to create the audio bucket.";
  if (/row-level security|unauthorized|not allowed|403/i.test(m)) return "You don't have permission to upload there. Make sure you're signed in.";
  if (/exceeded|too large|payload/i.test(m)) return `That file is too large. The limit is ${CONFIG.MAX_AUDIO_MB} MB.`;
  if (/mime|content type/i.test(m)) return "That file type isn't allowed. Use MP3, OGG, WAV or M4A.";
  return m;
}
function readFile(file){ return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); }); }

/* CSV */
function toCSV(rows, cols){
  const cell = v => { if (v === null || v === undefined) return ""; if (Array.isArray(v) || typeof v === "object") v = JSON.stringify(v); v = String(v); return /[",\n\r]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v; };
  return [cols.join(","), ...rows.map(r => cols.map(c => cell(r[c])).join(","))].join("\r\n");
}
function parseCSV(text){
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (q){ if (c === '"'){ if (text[i+1] === '"'){ cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ","){ row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r"){ if (c === "\r" && text[i+1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur !== "" || row.length){ row.push(cur); rows.push(row); }
  const clean = rows.filter(r => r.some(v => v.trim() !== ""));
  if (!clean.length) return [];
  const head = clean[0].map(h => h.trim());
  return clean.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

/* Toast & modal */
let toastT;
function toast(msg, err = false){
  const t = $("#toast"); t.textContent = msg; t.classList.toggle("err", err); t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600);
}
function openModal({title, body, foot = "", wide = false, onMount}){
  const root = $("#modalRoot");
  root.innerHTML = `<div class="modal-bg" id="modalBg"><div class="modal${wide ? " wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <div class="modal-h"><h3 id="modalTitle">${esc(title)}</h3><button class="xbtn" type="button" data-close aria-label="Close">${ICON.x}</button></div>
    <div class="modal-b">${body}</div>${foot ? `<div class="modal-f">${foot}</div>` : ""}</div></div>`;
  const bg = $("#modalBg");
  bg.addEventListener("mousedown", e => { if (e.target === bg) closeModal(); });
  $$("[data-close]", bg).forEach(b => b.addEventListener("click", closeModal));
  document.addEventListener("keydown", escClose);
  if (onMount) onMount(bg);
  const f = $("input,select,textarea,button.primary", $(".modal-b", bg)) || $("button", bg);
  if (f) setTimeout(() => f.focus(), 30);
  return bg;
}
function escClose(e){ if (e.key === "Escape") closeModal(); }
function closeModal(){ $("#modalRoot").innerHTML = ""; document.removeEventListener("keydown", escClose); }
function confirmBox(message, {ok = "Confirm", danger = false, title = "Are you sure?"} = {}){
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; closeModal(); resolve(v); };
    const bg = openModal({title, body:`<p style="margin:0">${message}</p>`,
      foot:`<button class="btn ghost" type="button" id="cfNo">Cancel</button><button class="btn ${danger ? "danger" : "primary"}" type="button" id="cfYes">${esc(ok)}</button>`});
    $("#cfNo", bg).onclick = () => finish(false);
    $("#cfYes", bg).onclick = () => finish(true);
    $$("[data-close]", bg).forEach(b => b.addEventListener("click", () => finish(false)));
  });
}

const ICON = {
  star:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/></svg>',
  copy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  play:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause:'<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
  next:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 5v14l10-7zM17 5h2v14h-2z"/></svg>',
  prev:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 5v14L9 12zM5 5h2v14H5z"/></svg>',
  shuffle:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
  repeat:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
  list:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h13M3 12h13M3 18h9M19 15v6M16 18h6"/></svg>',
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  x:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  vol:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
  music:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  back:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>',
  up:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 15 6-6 6 6"/></svg>',
  down:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>',
  user:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  shield:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  logout:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  ext:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>'
};

/* =====================================================================
   STATE & DATA
   ===================================================================== */
const TYPES = ["original","mashup","cover","remix"];
const TYPE_LABEL = {original:"Original", mashup:"Mashup", cover:"Cover", remix:"Remix"};
const PLURAL = {mashup:"Mashups", cover:"Covers", remix:"Remixes", original:"Originals"};
const DIFF = {"Auto":"#9fb3a8","Easy":"#5ec8f0","Normal":"#5fd36b","Hard":"#f0c64a","Harder":"#f08a4a","Insane":"#ec6fc9","Easy Demon":"#c58cf2","Medium Demon":"#e97a9a","Hard Demon":"#ef6a6a","Insane Demon":"#f2544e","Extreme Demon":"#ff3434"};
const DIFF_ORDER = Object.keys(DIFF);

const DB = { loaded:false, error:null, levels:[], songs:[], songIds:[], stats:{}, statsSource:"view", songById:{}, levelById:{} };
const ME = { user:null, profile:null, isAdmin:false, ready:false };
const PREF_DEFAULTS = { autoplay:true, shuffleDefault:false, compact:false, reduceMotion:false, showNoAudio:true };
const PREFS = Object.assign({}, PREF_DEFAULTS, store.get("prefs", {}));
function setPref(k, v){ PREFS[k] = v; store.set("prefs", PREFS); applyPrefs(); }
function applyPrefs(){ document.body.classList.toggle("compact", !!PREFS.compact); document.body.classList.toggle("reduce-motion", !!PREFS.reduceMotion); }
const state = {
  listType:"all", listSort:"score", listQ:"", lvQ:"", lvDiff:"all", lvSort:"name",
  searchQ:"", searchTab:"all", levelQ:{}, levelType:{}, chartSel:{},
  admin:{}, storagePath:"", reqStatus:"pending"
};
const app = $("#app"), hq = $("#hq");

async function loadData(){
  try {
    const [lv, sg, si] = await Promise.all([
      run(sb.from("levels").select("*").order("name")),
      run(sb.from("songs").select("*")),
      run(sb.from("song_ids").select("*").order("song_id"))
    ]);
    DB.levels = lv.data || []; DB.songs = sg.data || []; DB.songIds = si.data || [];
    DB.error = null;
  } catch (e){ DB.error = e.message; }
  await loadStats();
  DB.songById = Object.fromEntries(DB.songs.map(s => [s.id, s]));
  DB.levelById = Object.fromEntries(DB.levels.map(l => [l.id, l]));
  DB.loaded = true;
}
async function loadStats(){
  DB.stats = {};
  try {
    const r = await run(sb.from("song_vote_stats").select("song,votes,avg_score"));
    (r.data || []).forEach(x => DB.stats[x.song] = {votes:+x.votes, avg:numOrNull(x.avg_score)});
    DB.statsSource = "view";
  } catch (e){
    DB.statsSource = "stored";   // view not installed yet: fall back to the stored rating columns
  }
}

/* ---------- Scoring ---------- */
const voteCount = s => (DB.stats[s.id] && DB.stats[s.id].votes) || 0;
function ownScore(s){            // originals/covers/remixes: their rating; mashups: mashing quality
  const st = DB.stats[s.id];
  if (st && st.votes && st.avg !== null) return st.avg;
  return numOrNull(s.type === "mashup" ? s.mashing_quality : s.rating);
}
function overall(s, depth = 0){
  if (!s) return null;
  if (s.type !== "mashup") return ownScore(s);
  const q = ownScore(s);
  const a = depth < 3 ? overall(DB.songById[s.song_a], depth + 1) : null;
  const b = depth < 3 ? overall(DB.songById[s.song_b], depth + 1) : null;
  const parts = [a, b, q].filter(v => v !== null);
  return parts.length ? parts.reduce((x, y) => x + y, 0) / parts.length : null;
}
const byScore = (a, b) => { const x = overall(a), y = overall(b); if (x === null && y === null) return a.name.localeCompare(b.name); if (x === null) return 1; if (y === null) return -1; return y - x; };
const ranked = () => DB.songs.slice().sort(byScore);
const songsFor = songId => DB.songs.filter(s => +s.song_id === +songId).sort(byScore);
const levelsFor = songId => DB.levels.filter(l => +l.song_id === +songId);
const originalFor = songId => DB.songs.find(s => +s.song_id === +songId && s.type === "original");
function creditText(s){
  if (s.type === "mashup"){ const a = DB.songById[s.song_a], b = DB.songById[s.song_b]; return [a ? a.name : "?", b ? b.name : "?"].join(" + "); }
  return TYPE_LABEL[s.type] || "Song";
}
const songHay = s => [s.name, s.author, s.type, s.song_id, creditText(s)].join(" ");
const levelHay = l => [l.name, l.level_id, l.song_id, l.verifier, l.creators, l.difficulty].join(" ");

/* =====================================================================
   AUTH
   ===================================================================== */
async function refreshMe(session){
  ME.user = session ? session.user : null; ME.profile = null; ME.isAdmin = false;
  if (ME.user){
    try { const r = await run(sb.from("profiles").select("*").eq("id", ME.user.id).maybeSingle()); ME.profile = r.data; } catch(_){}
    try { const r = await run(sb.rpc("has_role", {_user_id: ME.user.id, _role: "admin"})); ME.isAdmin = r.data === true; }
    catch(_){ try { const r = await run(sb.from("user_roles").select("role").eq("user_id", ME.user.id)); ME.isAdmin = (r.data || []).some(x => x.role === "admin"); } catch(_){} }
  }
  ME.ready = true;
  renderHeader();
}
const myName = () => (ME.profile && ME.profile.username) || (ME.user && ((ME.user.user_metadata || {}).username || (ME.user.email || "").split("@")[0])) || "";
function renderHeader(){
  const a = $("#acctBtn"), menu = $("#acctMenu"), n = myName();
  a.innerHTML = ME.user ? `<span class="av">${esc(n.slice(0,1).toUpperCase() || "U")}</span><span class="nm">${esc(n)}</span>` : `<span class="av">?</span><span class="nm">Sign in</span>`;
  a.setAttribute("aria-label", ME.user ? `Account menu for ${n}` : "Sign in or create an account");
  const item = (href, icon, label, extra = "") => `<a href="${href}" role="menuitem" ${extra}>${icon}${esc(label)}</a>`;
  menu.innerHTML = ME.user
    ? `<div class="mh"><b>${esc(n)}</b><span>${esc(ME.user.email || "")}</span></div>
       ${item("#account", ICON.user, "Profile")}${item("#playlists", ICON.list, "My playlists")}${item("#request", ICON.plus, "Request a level or song")}
       ${ME.isAdmin ? item("#admin", ICON.shield, "Admin panel") : ""}<hr>${item("#settings", ICON.gear, "Settings")}
       <button type="button" role="menuitem" class="danger" id="menuSignOut">${ICON.logout}Sign out</button>`
    : `${item("#login", ICON.user, "Sign in")}${item("#signup", ICON.plus, "Create account")}<hr>${item("#settings", ICON.gear, "Settings")}`;
  $("#adminLink").hidden = !ME.isAdmin;
  const so = $("#menuSignOut");
  if (so) so.onclick = signOut;
}
function toggleMenu(open){
  const a = $("#acctBtn"), m = $("#acctMenu");
  open = open === undefined ? m.hidden : open;
  m.hidden = !open; a.setAttribute("aria-expanded", String(open));
  if (open){ const f = $("a,button", m); if (f) f.focus(); }
}
async function signOut(){ toggleMenu(false); await sb.auth.signOut(); toast("Signed out"); location.hash = "list"; }
function requireLogin(what){
  return `<div class="card card-pad" style="max-width:520px;margin:30px auto;text-align:center"><h2>Sign in to ${esc(what)}</h2>
    <p class="muted">You need an account for this. It only takes a minute.</p>
    <div class="btns" style="justify-content:center;margin-top:14px"><a class="btn primary" href="#login">Sign in</a><a class="btn" href="#signup">Create account</a></div></div>`;
}

/* =====================================================================
   PLAYLISTS  (account playlists in the database; browser playlists when signed out)
   ===================================================================== */
const PL = {
  cache:[], dbMissing:false,
  isLocal(){ return !ME.user || this.dbMissing; },
  localAll(){ return store.get("playlists", []); },
  localSave(list){ store.set("playlists", list); },
  async list(){
    if (!ME.user){ this.cache = this.localAll(); return this.cache; }
    try {
      const r = await run(sb.from("playlists").select("*").eq("user_id", ME.user.id).order("created_at", {ascending:false}));
      this.dbMissing = false; this.cache = r.data || [];
    } catch (e){
      if (missingRelation(e)){ this.dbMissing = true; this.cache = this.localAll(); } else throw e;
    }
    return this.cache;
  },
  async get(id){
    if (String(id).startsWith("local-")) return this.localAll().find(p => p.id === id) || null;
    const r = await run(sb.from("playlists").select("*").eq("id", id).maybeSingle());
    return r.data;
  },
  async create(name, songs = []){
    name = String(name || "").trim().slice(0, 80) || "Untitled playlist";
    if (this.isLocal()){
      const p = {id:"local-" + uid().slice(0, 8), name, songs, is_public:false, created_at:new Date().toISOString(), local:true};
      const all = this.localAll(); all.unshift(p); this.localSave(all); return p;
    }
    const r = await run(sb.from("playlists").insert({user_id:ME.user.id, name, songs}).select().single());
    return r.data;
  },
  async update(id, patch){
    if (String(id).startsWith("local-")){
      const all = this.localAll(); const p = all.find(x => x.id === id); if (!p) return null;
      Object.assign(p, patch); this.localSave(all); return p;
    }
    const r = await run(sb.from("playlists").update({...patch, updated_at:new Date().toISOString()}).eq("id", id).select().single());
    return r.data;
  },
  async remove(id){
    if (String(id).startsWith("local-")){ this.localSave(this.localAll().filter(p => p.id !== id)); return; }
    await run(sb.from("playlists").delete().eq("id", id));
  },
  async addSong(id, songId){
    const p = await this.get(id); if (!p) throw new Error("Playlist not found");
    if ((p.songs || []).includes(songId)) return {p, dup:true};
    const np = await this.update(id, {songs:[...(p.songs || []), songId]});
    return {p:np, dup:false};
  }
};
function exportPlaylist(p){
  const data = {format:"gdsr-playlist", version:1, name:p.name, songs:p.songs || [], exported_at:new Date().toISOString()};
  download(`${safeName(p.name || "playlist")}.gdsr.json`, JSON.stringify(data, null, 2));
}
function parsePlaylistImport(text){
  text = String(text || "").trim(); if (!text) throw new Error("Nothing to import.");
  let name = null, ids = [];
  try {
    const j = JSON.parse(text);
    if (Array.isArray(j)) ids = j;
    else if (j && typeof j === "object"){ name = j.name || null; ids = j.songs || j.song_ids || j.ids || []; }
  } catch(_){ ids = text.split(/[\s,;]+/); }
  ids = ids.map(x => String(x && typeof x === "object" ? (x.id || "") : x).trim()).filter(Boolean);
  const known = [], unknown = [];
  ids.forEach(id => (DB.songById[id] ? (known.includes(id) || known.push(id)) : unknown.push(id)));
  return {name, known, unknown};
}
function openImportModal(after){
  const bg = openModal({title:"Import playlist", wide:true,
    body:`<div class="form">
      <p class="muted small" style="margin:0">Paste an exported playlist (.gdsr.json) or a plain list of song IDs, one per line or separated by commas.</p>
      <label class="f">Playlist name<input class="input" id="impName" placeholder="Use the name from the file"></label>
      <label class="f">Playlist data<textarea class="textarea mono" id="impText" rows="7" placeholder='{"format":"gdsr-playlist","name":"…","songs":["song-id", "…"]}'></textarea></label>
      <label class="f">Or choose a file<input type="file" id="impFile" accept=".json,.txt,application/json,text/plain"></label>
      <p class="small" id="impInfo" style="margin:0"></p></div>`,
    foot:`<button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" id="impGo" type="button">Import</button>`});
  const info = () => {
    try { const r = parsePlaylistImport($("#impText", bg).value); $("#impInfo", bg).innerHTML = `<span style="color:var(--accent-strong)">${r.known.length} song${r.known.length === 1 ? "" : "s"} found</span>${r.unknown.length ? ` · <span class="faint">${r.unknown.length} unknown ID${r.unknown.length === 1 ? "" : "s"} will be skipped</span>` : ""}`; if (r.name && !$("#impName", bg).value) $("#impName", bg).placeholder = r.name; }
    catch(e){ $("#impInfo", bg).textContent = ""; }
  };
  $("#impText", bg).addEventListener("input", info);
  $("#impFile", bg).addEventListener("change", async e => { const f = e.target.files[0]; if (f){ $("#impText", bg).value = await readFile(f); info(); } });
  $("#impGo", bg).onclick = async () => {
    try {
      const r = parsePlaylistImport($("#impText", bg).value);
      if (!r.known.length) throw new Error("None of these song IDs exist on GDSR.");
      const p = await PL.create($("#impName", bg).value.trim() || r.name || "Imported playlist", r.known);
      closeModal(); toast(`Imported ${r.known.length} song${r.known.length === 1 ? "" : "s"}${r.unknown.length ? `, skipped ${r.unknown.length}` : ""}`);
      if (after) after(p); else location.hash = "playlist-" + p.id;
    } catch(e){ $("#impInfo", bg).innerHTML = `<span style="color:var(--danger)">${esc(e.message)}</span>`; }
  };
}
async function openAddToPlaylist(songId){
  const s = DB.songById[songId]; if (!s) return;
  let lists = [];
  try { lists = await PL.list(); } catch(e){ toast(e.message, true); return; }
  const bg = openModal({title:`Add “${s.name}” to a playlist`,
    body:`${PL.isLocal() ? `<p class="small muted" style="margin:0 0 12px">${ME.user ? "Playlists are saved in this browser until the playlists table is installed." : "You're signed out, so playlists are saved in this browser only. Sign in to keep them in your account."}</p>` : ""}
      <ul class="mini-list" style="margin:0">${lists.map(p => `<li><button class="mi btn ghost" style="width:100%;justify-content:space-between" data-pl="${esc(p.id)}" type="button"><span class="grow" style="text-align:left"><span class="nm">${esc(p.name)}</span><span class="sb">${(p.songs || []).length} songs</span></span>${(p.songs || []).includes(songId) ? '<span class="badge approved">Added</span>' : ICON.plus}</button></li>`).join("") || `<li class="muted small">No playlists yet.</li>`}</ul>
      <div class="form" style="margin-top:16px"><label class="f">New playlist<div class="btns" style="flex-wrap:nowrap"><input class="input" id="newPl" placeholder="Playlist name" maxlength="80"><button class="btn primary" id="newPlGo" type="button">Create</button></div></label></div>`});
  $$("[data-pl]", bg).forEach(b => b.onclick = async () => {
    try { const r = await PL.addSong(b.dataset.pl, songId); closeModal(); toast(r.dup ? "Already in that playlist" : `Added to ${r.p.name}`); }
    catch(e){ toast(e.message, true); }
  });
  const go = async () => { try { const p = await PL.create($("#newPl", bg).value, [songId]); closeModal(); toast(`Created ${p.name}`); } catch(e){ toast(e.message, true); } };
  $("#newPlGo", bg).onclick = go;
  $("#newPl", bg).addEventListener("keydown", e => { if (e.key === "Enter") go(); });
}

/* =====================================================================
   MUSIC PLAYER
   ===================================================================== */
const P = {
  audio:new Audio(), queue:[], index:-1, shuffle:store.get("shuffle", store.get("prefs", {}).shuffleDefault || false), repeat:store.get("repeat", "off"), source:"",
  get cur(){ return DB.songById[this.queue[this.index]] || null; },
  playable(id){ const s = DB.songById[id]; return !!(s && s.audio_file); },
  playList(ids, start = 0, source = ""){
    ids = ids.filter(id => this.playable(id));
    if (!ids.length){ toast("None of these songs have audio uploaded yet.", true); return; }
    this.source = source;
    if (this.shuffle){ const first = ids[Math.min(start, ids.length - 1)]; ids = [first, ...shuffleArr(ids.filter(x => x !== first))]; start = 0; }
    this.queue = ids; this.load(Math.min(start, ids.length - 1), true);
  },
  playOne(id, contextIds){
    if (!this.playable(id)){ toast("This song has no audio uploaded yet.", true); return; }
    if (this.cur && this.cur.id === id){ this.toggle(); return; }
    const list = (contextIds || [id]).filter(x => this.playable(x));
    this.playList(list, Math.max(0, list.indexOf(id)), "");
  },
  load(i, autoplay){
    this.index = i; const s = this.cur; if (!s) return;
    this.audio.src = audioUrl(s.audio_file);
    if (autoplay) this.audio.play().catch(() => {});
    renderPlayer(); updateMedia(); markPlaying();
  },
  toggle(){ if (!this.cur) return; this.audio.paused ? this.audio.play().catch(() => {}) : this.audio.pause(); },
  next(auto = false){
    if (!this.queue.length) return;
    if (auto && this.repeat === "one"){ this.audio.currentTime = 0; this.audio.play().catch(() => {}); return; }
    if (this.index < this.queue.length - 1) this.load(this.index + 1, true);
    else if (this.repeat === "all") this.load(0, true);
    else if (!auto) this.load(0, true);
  },
  prev(){ if (this.audio.currentTime > 3 || this.index === 0){ this.audio.currentTime = 0; return; } this.load(this.index - 1, true); },
  seekTo(sec){ if (!this.cur) return; this.audio.currentTime = sec; if (this.audio.paused) this.audio.play().catch(() => {}); },
  enqueue(id){ if (!this.playable(id)){ toast("This song has no audio uploaded yet.", true); return; }
    if (!this.queue.length){ this.playList([id]); return; }
    this.queue.splice(this.index + 1, 0, id); renderQueue(); toast("Plays next"); }
};
P.audio.preload = "metadata";
P.audio.volume = store.get("volume", .8);
function shuffleArr(a){ a = a.slice(); for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function renderPlayer(){
  const el = $("#player"), s = P.cur;
  if (!s){ el.classList.remove("on"); document.documentElement.style.setProperty("--player-h", "0px"); return; }
  el.classList.add("on");
  const paused = P.audio.paused;
  el.innerHTML = `<div class="pl-in" style="position:relative">
    <div class="pl-song"><div class="pl-art">${ICON.music}</div><div class="pl-meta"><a href="#song-${s.id}">${esc(s.name)}</a><span>${esc(s.author || "")} · ${esc(TYPE_LABEL[s.type] || "")}</span></div></div>
    <div class="pl-center">
      <div class="pl-ctrls">
        <button class="ib opt ${P.shuffle ? "on" : ""}" id="plShuf" type="button" aria-label="Shuffle" aria-pressed="${P.shuffle}">${ICON.shuffle}</button>
        <button class="ib" id="plPrev" type="button" aria-label="Previous">${ICON.prev}</button>
        <button class="ib main" id="plPlay" type="button" aria-label="${paused ? "Play" : "Pause"}">${paused ? ICON.play : ICON.pause}</button>
        <button class="ib" id="plNext" type="button" aria-label="Next">${ICON.next}</button>
        <button class="ib opt ${P.repeat !== "off" ? "on" : ""}" id="plRep" type="button" aria-label="Repeat: ${P.repeat}" title="Repeat: ${P.repeat}" style="position:relative">${ICON.repeat}${P.repeat === "one" ? "<small>1</small>" : ""}</button>
      </div>
      <div class="pl-seek"><span id="plCur">0:00</span><input type="range" id="plSeek" min="0" max="1000" value="0" aria-label="Seek"><span id="plDur">0:00</span></div>
    </div>
    <div class="pl-right">
      <button class="ib" id="plAdd" type="button" aria-label="Add to playlist" title="Add to playlist">${ICON.plus}</button>
      <button class="ib" id="plQ" type="button" aria-label="Queue" title="Queue">${ICON.list}</button>
      <span class="ib" aria-hidden="true">${ICON.vol}</span>
      <input type="range" class="pl-vol" id="plVol" min="0" max="100" value="${Math.round(P.audio.volume * 100)}" style="--p:${Math.round(P.audio.volume * 100)}%" aria-label="Volume">
    </div></div>`;
  document.documentElement.style.setProperty("--player-h", el.offsetHeight + "px");
  $("#plPlay").onclick = () => P.toggle();
  $("#plNext").onclick = () => P.next();
  $("#plPrev").onclick = () => P.prev();
  $("#plShuf").onclick = () => { P.shuffle = !P.shuffle; store.set("shuffle", P.shuffle);
    if (P.shuffle && P.queue.length > 1){ const cur = P.queue[P.index]; P.queue = [cur, ...shuffleArr(P.queue.filter((x, i) => i !== P.index))]; P.index = 0; }
    renderPlayer(); renderQueue(); };
  $("#plRep").onclick = () => { P.repeat = {off:"all", all:"one", one:"off"}[P.repeat]; store.set("repeat", P.repeat); renderPlayer(); };
  $("#plAdd").onclick = () => openAddToPlaylist(s.id);
  $("#plQ").onclick = () => { $("#queue").classList.toggle("on"); renderQueue(); };
  const seek = $("#plSeek");
  seek.addEventListener("input", () => { const d = P.audio.duration; if (d) { P.audio.currentTime = seek.value / 1000 * d; } });
  $("#plVol").addEventListener("input", e => { P.audio.volume = e.target.value / 100; e.target.style.setProperty("--p", e.target.value + "%"); store.set("volume", P.audio.volume); });
  updateTime();
}
function updateTime(){
  const seek = $("#plSeek"); if (!seek) return;
  const d = P.audio.duration || 0, c = P.audio.currentTime || 0, pct = d ? c / d * 1000 : 0;
  if (document.activeElement !== seek){ seek.value = pct; }
  seek.style.setProperty("--p", pct / 10 + "%");
  $("#plCur").textContent = mmss(c); $("#plDur").textContent = d ? mmss(d) : lenText(P.cur && P.cur.length);
}
function renderQueue(){
  const el = $("#queue"); if (!el.classList.contains("on")) return;
  el.innerHTML = `<div class="card-head" style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px 0"><h3>Queue</h3><div class="btns"><button class="btn sm ghost" id="qSave" type="button">Save as playlist</button><button class="xbtn" id="qClose" type="button" aria-label="Close queue">${ICON.x}</button></div></div>
    <ul class="mini-list">${P.queue.map((id, i) => { const s = DB.songById[id]; if (!s) return ""; return `<li><div class="mi ${i === P.index ? "q-cur" : ""}"><button class="btn ghost grow" style="justify-content:flex-start;padding:0;border:0;text-align:left" data-qi="${i}" type="button"><span class="grow"><span class="nm">${i === P.index ? "▶ " : ""}${esc(s.name)}</span><span class="sb">${esc(s.author || "")}</span></span></button>${i !== P.index ? `<button class="xbtn" data-qr="${i}" type="button" aria-label="Remove from queue">${ICON.x}</button>` : ""}</div></li>`; }).join("")}</ul>`;
  $("#qClose").onclick = () => el.classList.remove("on");
  $("#qSave").onclick = async () => { try { const p = await PL.create("Queue " + new Date().toLocaleDateString(), P.queue.slice()); toast(`Saved as ${p.name}`); } catch(e){ toast(e.message, true); } };
  $$("[data-qi]", el).forEach(b => b.onclick = () => P.load(+b.dataset.qi, true));
  $$("[data-qr]", el).forEach(b => b.onclick = () => { const i = +b.dataset.qr; P.queue.splice(i, 1); if (i < P.index) P.index--; renderQueue(); });
}
function markPlaying(){
  const id = P.cur && P.cur.id, playing = id && !P.audio.paused;
  $$("[data-play]").forEach(b => { const on = b.dataset.play === id && playing; b.classList.toggle("on", on); b.innerHTML = (on ? ICON.pause : ICON.play) + (b.classList.contains("btn") ? (on ? " Pause" : " Play") : ""); b.setAttribute("aria-label", on ? "Pause" : "Play"); });
  $$(".row[data-song]").forEach(r => r.classList.toggle("playing", r.dataset.song === id));
}
function updateMedia(){
  const s = P.cur; if (!s || !("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({title:s.name, artist:s.author || "", album:"GDSR · Song ID " + s.song_id});
    navigator.mediaSession.setActionHandler("play", () => P.toggle());
    navigator.mediaSession.setActionHandler("pause", () => P.toggle());
    navigator.mediaSession.setActionHandler("nexttrack", () => P.next());
    navigator.mediaSession.setActionHandler("previoustrack", () => P.prev());
  } catch(_){}
}
P.audio.addEventListener("timeupdate", updateTime);
P.audio.addEventListener("loadedmetadata", updateTime);
P.audio.addEventListener("play", () => { renderPlayer(); markPlaying(); });
P.audio.addEventListener("pause", () => { renderPlayer(); markPlaying(); });
P.audio.addEventListener("ended", () => { if (PREFS.autoplay || P.repeat === "one") P.next(true); else { P.audio.currentTime = 0; renderPlayer(); markPlaying(); } });
P.audio.addEventListener("error", () => { if (P.cur) toast("Couldn't play this audio file.", true); });

/* =====================================================================
   COMPONENTS
   ===================================================================== */
const typeBadge = t => `<span class="badge ${esc(t)}">${esc(TYPE_LABEL[t] || t || "—")}</span>`;
const diffBadge = d => d ? `<span class="diff" style="color:${DIFF[d] || "#8aa395"}"><i style="background:${DIFF[d] || "#8aa395"}"></i>${esc(d)}</span>` : `<span class="faint">—</span>`;
const starsBadge = n => n || n === 0 ? `<span class="stars" title="${n} stars">${ICON.star}${n}</span>` : "";
const statusBadge = s => `<span class="badge ${esc(s)}">${esc(s ? s[0].toUpperCase() + s.slice(1) : "")}</span>`;
const playBtn = (s, ctxAttr = "") => `<button class="pbtn" type="button" data-play="${s.id}" ${ctxAttr} ${s.audio_file ? "" : "disabled"} aria-label="${s.audio_file ? "Play" : "No audio"}" title="${s.audio_file ? "Play" : "No audio uploaded"}">${ICON.play}</button>`;
function scoreCell(s){
  const v = overall(s), c = scoreColor(v);
  return `<span class="score"><span class="bar"><i style="width:${v || 0}%;background:${c}"></i></span><span class="num" style="color:${c}">${fmt(v)}</span><span class="votes">${num(voteCount(s))} vote${voteCount(s) === 1 ? "" : "s"}</span></span>`;
}
function songRow(s, rank, q){
  return `<div class="row" data-song="${s.id}">
    <span class="rank${rank && rank <= 3 ? " top" : ""}">${rank || "–"}</span>
    ${playBtn(s)}
    <span class="ttl"><a class="t" href="#song-${s.id}">${hl(s.name, q)}</a><span class="sub">${hl(s.author || "Unknown", q)} · ${hl(creditText(s), q)}</span>
      <span class="meta">${typeBadge(s.type)}<span>ID ${hl(s.song_id ?? "—", q)}</span><span>${lenText(s.length)}</span></span></span>
    <span class="c-type">${typeBadge(s.type)}</span>
    <span class="c-id">${hl(s.song_id ?? "—", q)}</span>
    <span class="c-len">${lenText(s.length)}</span>
    ${scoreCell(s)}
  </div>`;
}
const tableHead = () => `<div class="thead" aria-hidden="true"><span>#</span><span></span><span>Song</span><span class="c-type">Type</span><span class="c-id">Song ID</span><span class="c-len">Length</span><span class="r">Score</span></div>`;
const emptyState = (title, sub = "") => `<div class="empty"><b>${esc(title)}</b>${esc(sub)}</div>`;
const skeleton = n => `<div class="table">${Array.from({length:n}, () => '<div class="skel"></div>').join("")}</div>`;
function bindPlayButtons(root, contextIds){
  $$("[data-play]", root).forEach(b => b.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); P.playOne(b.dataset.play, contextIds); }));
  markPlaying();
}
function levelCard(lv, q){
  const list = songsFor(lv.song_id), best = list.find(s => overall(s) !== null);
  return `<a class="lvcard" href="#level-${lv.id}">
    <div class="lv-top">${diffBadge(lv.difficulty)}${starsBadge(lv.stars)}</div>
    <h3>${hl(lv.name, q)}</h3>
    <p class="muted small">by ${hl(lv.creators || "Unknown", q)}</p>
    <div class="lv-meta">
      <span><small>Level ID</small><b class="mono">${hl(lv.level_id ?? "—", q)}</b></span>
      <span><small>Song ID</small><b class="mono">${hl(lv.song_id ?? "—", q)}</b></span>
      <span><small>Length</small><b class="mono">${esc(lenText(lv.length))}</b></span>
    </div>
    <div class="lv-foot"><span>${list.length} song${list.length === 1 ? "" : "s"}</span><span>Top score <b style="color:${scoreColor(best ? overall(best) : null)}">${fmt(best ? overall(best) : null)}</b></span></div>
  </a>`;
}
function chips(id, options, current, label = "Filter by type"){
  return `<div class="chips" id="${id}" role="group" aria-label="${esc(label)}">${options.map(o =>
    `<button class="chip" type="button" data-v="${esc(o.v)}" aria-pressed="${o.v === current}">${esc(o.label)}${o.n !== undefined ? `<span class="n">${o.n}</span>` : ""}</button>`).join("")}</div>`;
}
const typeOptions = list => [{v:"all", label:"All", n:list.length}, ...TYPES.map(t => ({v:t, label:PLURAL[t], n:list.filter(s => s.type === t).length})).filter(o => o.n > 0)];
function bindChips(el, onPick){
  el.addEventListener("click", ev => { const b = ev.target.closest(".chip"); if (!b) return;
    $$(".chip", el).forEach(c => c.setAttribute("aria-pressed", String(c === b))); onPick(b.dataset.v); });
}
function bindCopy(root){ $$("[data-copy]", root).forEach(b => b.addEventListener("click", () => copyText(b.dataset.copy, `Copied ${b.dataset.copy}`))); }
function dataNotice(){
  if (!DB.error) return "";
  const perm = /permission denied|42501|not allowed/i.test(DB.error);
  return `<div class="notice err"><b>Couldn't load the catalogue.</b> ${perm ? "The database isn't allowing visitors to read songs and levels yet. An admin needs to run <code>supabase/migration.sql</code>." : esc(DB.error)}</div>`;
}

/* =====================================================================
   VIEW: THE LIST
   ===================================================================== */
function viewList(){
  const totalV = DB.songs.reduce((a, s) => a + voteCount(s), 0);
  return `${dataNotice()}
  <section class="hero">
    <div><p class="eyebrow">Geometry Dash · Song replacements</p><h1>The List</h1>
      <p class="lead">Every mashup, cover and remix, ranked by community score from 0 to 100.</p></div>
    <div class="stats">
      <div class="stat"><b>${DB.songs.length}</b><span>Songs</span></div>
      <div class="stat"><b>${DB.songs.filter(s => s.type === "mashup").length}</b><span>Mashups</span></div>
      <div class="stat"><b>${DB.levels.length}</b><span>Levels</span></div>
      <div class="stat"><b>${compact(totalV)}</b><span>Votes</span></div>
    </div>
  </section>
  <div class="toolbar">
    ${chips("listChips", typeOptions(DB.songs), state.listType)}
    <div class="toolbar-right">
      <label class="field"><span class="sr-only">Filter the list</span>${ICON.search}<input id="listQ" type="search" placeholder="Filter the list…" value="${esc(state.listQ)}" autocomplete="off"></label>
      <label><span class="sr-only">Sort by</span><select class="select" id="listSort">
        ${[["score","Top score"],["votes","Most votes"],["newest","Newest"],["length","Longest"],["name","A–Z"]].map(([v,l]) => `<option value="${v}"${state.listSort === v ? " selected" : ""}>${l}</option>`).join("")}
      </select></label>
      <button class="btn" id="listPlay" type="button">${ICON.play} Play all</button>
    </div>
  </div>
  <div class="table" id="listBody"></div>`;
}
function listFiltered(){
  const sorters = {score:byScore, votes:(a,b) => voteCount(b) - voteCount(a), newest:(a,b) => String(b.created_at).localeCompare(String(a.created_at)),
    length:(a,b) => (parseLen(b.length) || 0) - (parseLen(a.length) || 0), name:(a,b) => a.name.localeCompare(b.name)};
  return DB.songs.filter(s => (PREFS.showNoAudio || s.audio_file) && (state.listType === "all" || s.type === state.listType) && matches(songHay(s), state.listQ)).sort(sorters[state.listSort]);
}
function renderListBody(){
  const rankMap = new Map(ranked().filter(s => overall(s) !== null).map((s, i) => [s, i + 1]));
  const list = listFiltered();
  const el = $("#listBody");
  el.innerHTML = list.length ? tableHead() + list.map(s => songRow(s, rankMap.get(s), state.listQ)).join("")
    : emptyState(DB.songs.length ? "No songs match" : "No songs yet", DB.songs.length ? "Try a different filter or search." : "Approved songs will show up here.");
  bindPlayButtons(el, list.map(s => s.id));
}
function mountList(){
  renderListBody();
  bindChips($("#listChips"), v => { state.listType = v; renderListBody(); });
  $("#listQ").addEventListener("input", e => { state.listQ = e.target.value; renderListBody(); });
  $("#listSort").addEventListener("change", e => { state.listSort = e.target.value; renderListBody(); });
  $("#listPlay").onclick = () => P.playList(listFiltered().map(s => s.id), 0, "The List");
}

/* =====================================================================
   VIEW: LEVELS
   ===================================================================== */
function viewLevels(){
  return `${dataNotice()}<section class="hero single"><div><p class="eyebrow">Browse</p><h1>Levels</h1><p class="lead">Pick a level to see every song uploaded to its song ID, ranked by score.</p></div></section>
  <div class="toolbar"><div class="toolbar-right" style="justify-content:flex-start;flex:1 1 100%">
    <label class="field" style="flex:1 1 320px"><span class="sr-only">Search levels</span>${ICON.search}<input id="lvQ" type="search" placeholder="Search by name, ID, creator, verifier…" value="${esc(state.lvQ)}" autocomplete="off"></label>
    <label><span class="sr-only">Difficulty</span><select class="select" id="lvDiff"><option value="all">All difficulties</option>${DIFF_ORDER.map(d => `<option${state.lvDiff === d ? " selected" : ""}>${d}</option>`).join("")}</select></label>
    <label><span class="sr-only">Sort levels</span><select class="select" id="lvSort">${[["name","A–Z"],["diff","Hardest"],["newest","Newest"],["stars","Most stars"]].map(([v,l]) => `<option value="${v}"${state.lvSort === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
    <a class="btn" href="#request">${ICON.plus} Request a level</a>
  </div></div><div id="lvBody"></div>`;
}
function renderLevelsBody(){
  const s = {name:(a,b) => a.name.localeCompare(b.name), diff:(a,b) => DIFF_ORDER.indexOf(b.difficulty) - DIFF_ORDER.indexOf(a.difficulty) || (b.stars || 0) - (a.stars || 0),
             newest:(a,b) => String(b.created_at).localeCompare(String(a.created_at)), stars:(a,b) => (b.stars || 0) - (a.stars || 0)}[state.lvSort];
  const list = DB.levels.filter(l => (state.lvDiff === "all" || l.difficulty === state.lvDiff) && matches(levelHay(l), state.lvQ)).sort(s);
  $("#lvBody").innerHTML = list.length ? `<div class="grid">${list.map(l => levelCard(l, state.lvQ)).join("")}</div>`
    : `<div class="table">${emptyState(DB.levels.length ? "No levels match" : "No levels yet", DB.levels.length ? "Try another name, ID or difficulty." : "Request one to get started.")}</div>`;
}
function mountLevels(){
  renderLevelsBody();
  $("#lvQ").addEventListener("input", e => { state.lvQ = e.target.value; renderLevelsBody(); });
  $("#lvDiff").addEventListener("change", e => { state.lvDiff = e.target.value; renderLevelsBody(); });
  $("#lvSort").addEventListener("change", e => { state.lvSort = e.target.value; renderLevelsBody(); });
}

/* =====================================================================
   VIEW: LEVEL DETAIL
   ===================================================================== */
const info = (k, v) => `<div class="info"><dt>${k}</dt><dd>${v}</dd></div>`;
function viewLevel(lv){
  const list = songsFor(lv.song_id), orig = originalFor(lv.song_id), others = levelsFor(lv.song_id).filter(l => l.id !== lv.id);
  return `<a class="back" href="#levels">${ICON.back} All levels</a>
  <section class="page-head">
    <div><div class="badges">${diffBadge(lv.difficulty)}${starsBadge(lv.stars)}</div>
      <h1>${esc(lv.name)}</h1><p class="lead">by ${esc(lv.creators || "Unknown")}${lv.verifier ? ` · verified by ${esc(lv.verifier)}` : ""}</p></div>
    <div class="ids">
      ${lv.level_id ? `<button class="idchip" type="button" data-copy="${esc(lv.level_id)}" aria-label="Copy level ID"><span><small>Level ID</small><b>${esc(lv.level_id)}</b></span>${ICON.copy}</button>` : ""}
      ${lv.song_id ? `<button class="idchip" type="button" data-copy="${esc(lv.song_id)}" aria-label="Copy song ID"><span><small>Song ID</small><b>${esc(lv.song_id)}</b></span>${ICON.copy}</button>` : ""}
    </div>
  </section>
  <dl class="info-grid">
    ${info("Name", esc(lv.name))}
    ${info("Level ID", `<span class="mono">${esc(lv.level_id ?? "—")}</span>`)}
    ${info("Creators", esc(lv.creators || "—"))}
    ${info("Verifier", esc(lv.verifier || "—"))}
    ${info("Difficulty", diffBadge(lv.difficulty))}
    ${info("Stars", starsBadge(lv.stars) || "—")}
    ${info("Length", `<span class="mono">${esc(lenText(lv.length))}</span>`)}
    ${info("Song ID", `<span class="mono">${esc(lv.song_id ?? "—")}</span>`)}
    ${info("Original song", orig ? `<a class="link" href="#song-${orig.id}">${esc(orig.name)}</a>` : "—")}
    ${info("Songs on this ID", list.length)}
  </dl>
  <section class="section">
    <div class="section-head"><div><h2>Songs for this level</h2><p class="muted small">Everything uploaded to song ID <span class="mono">${esc(lv.song_id ?? "—")}</span>, ranked by score.</p></div>
      <div class="btns"><button class="btn" id="lvlPlay" type="button">${ICON.play} Play all</button><a class="btn" href="#request-song">${ICON.plus} Request a song</a></div></div>
    <div class="toolbar">${chips("lvlChips", typeOptions(list), state.levelType[lv.id] || "all")}
      <div class="toolbar-right"><label class="field"><span class="sr-only">Search songs in this level</span>${ICON.search}<input id="lvlQ" type="search" placeholder="Search songs in ${esc(lv.name)}…" value="${esc(state.levelQ[lv.id] || "")}" autocomplete="off"></label></div></div>
    <div class="table" id="lvlBody"></div>
  </section>
  ${others.length ? `<section class="section"><div class="section-head"><h2>Other levels using this song ID</h2></div><div class="grid">${others.map(l => levelCard(l)).join("")}</div></section>` : ""}`;
}
function levelSongsFiltered(lv){
  const q = state.levelQ[lv.id] || "", t = state.levelType[lv.id] || "all";
  return songsFor(lv.song_id).filter(s => (PREFS.showNoAudio || s.audio_file) && (t === "all" || s.type === t) && matches(songHay(s), q));
}
function renderLevelSongs(lv){
  const all = songsFor(lv.song_id), list = levelSongsFiltered(lv), q = state.levelQ[lv.id] || "";
  const el = $("#lvlBody");
  el.innerHTML = list.length ? tableHead() + list.map(s => songRow(s, all.indexOf(s) + 1, q)).join("")
    : emptyState(all.length ? "No songs match in this level" : "No songs on this song ID yet", all.length ? "Search everything from the bar at the top instead." : "Be the first to request one.");
  bindPlayButtons(el, list.map(s => s.id));
}
function mountLevel(lv){
  renderLevelSongs(lv); bindCopy(app);
  bindChips($("#lvlChips"), v => { state.levelType[lv.id] = v; renderLevelSongs(lv); });
  $("#lvlQ").addEventListener("input", e => { state.levelQ[lv.id] = e.target.value; renderLevelSongs(lv); });
  $("#lvlPlay").onclick = () => P.playList(levelSongsFiltered(lv).map(s => s.id), 0, lv.name);
}

/* =====================================================================
   VIEW: SONG DETAIL
   ===================================================================== */
function ring(s){
  const C = 2 * Math.PI * 52, c = scoreColor(s);
  return `<div class="ring" role="img" aria-label="Overall score ${fmt(s)} out of 100"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" stroke="#1d2b23" stroke-width="9"/><circle cx="60" cy="60" r="52" fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - (s || 0) / 100)}"/></svg><div class="v"><b style="color:${c}">${fmt(s)}</b><span>/ 100</span></div></div>`;
}
function videoBlock(s){
  const id = ytId(s.video);
  if (id) return `<div class="video o-video"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="${esc(s.name)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
  return `<div class="video o-video"><div class="video-ov">
    ${s.audio_file ? `<button class="bigplay" type="button" data-play="${s.id}" aria-label="Play">${ICON.play}</button>` : ""}
    <span class="vt">${esc(s.name)}</span>
    <span class="vs">${s.audio_file ? "No video yet. Press play to listen." : "No video or audio yet."}${s.video ? ` <a class="link" href="${esc(s.video)}" target="_blank" rel="noopener">Open link ↗</a>` : ""}</span></div></div>`;
}
function breakdownCard(s){
  const v = overall(s);
  if (s.type === "mashup"){
    const a = DB.songById[s.song_a], b = DB.songById[s.song_b], q = ownScore(s);
    const item = (lbl, x) => { const sc = x ? overall(x) : null;
      return `<li><span><span class="lbl">${lbl}</span>${x ? `<a class="nm" href="#song-${x.id}">${esc(x.name)}</a><span class="small muted">${esc(x.author || "")}</span>` : `<span class="nm faint">Not set</span>`}</span><span class="val" style="color:${scoreColor(sc)}">${fmt(sc)}</span></li>`; };
    return `<section class="card card-pad o-break"><h3>Score breakdown</h3><ul class="breakdown">${item("Song A", a)}${item("Song B", b)}
      <li><span><span class="lbl">Mashing quality</span><span class="nm">${num(voteCount(s))} vote${voteCount(s) === 1 ? "" : "s"}</span></span><span class="val" style="color:${scoreColor(q)}">${fmt(q)}</span></li></ul>
      <div class="formula">(${fmt(a ? overall(a) : null)} + ${fmt(b ? overall(b) : null)} + ${fmt(q)}) ÷ 3 = <b>${fmt(v)}</b></div></section>`;
  }
  return `<section class="card card-pad o-break"><h3>Score breakdown</h3><ul class="breakdown"><li><span><span class="lbl">Community score</span><span class="nm">${num(voteCount(s))} vote${voteCount(s) === 1 ? "" : "s"}</span></span><span class="val" style="color:${scoreColor(v)}">${fmt(v)}</span></li></ul>
    <div class="formula">Average of all votes = <b>${fmt(v)}</b></div></section>`;
}
function viewSong(s){
  const lvls = levelsFor(s.song_id), sibs = songsFor(s.song_id).filter(x => x.id !== s.id), first = lvls[0];
  const rank = ranked().filter(x => overall(x) !== null).indexOf(s) + 1;
  return `<nav class="crumbs" aria-label="Breadcrumb"><a href="#list">The List</a><span>/</span>${first ? `<a href="#level-${first.id}">${esc(first.name)}</a><span>/</span>` : ""}<span>Song ID ${esc(s.song_id ?? "—")}</span></nav>
  <section class="page-head song-head">
    <div><div class="badges">${typeBadge(s.type)}${rank ? `<span class="pill mono">#${rank} of ${DB.songs.length}</span>` : ""}<span class="pill mono">ID ${esc(s.song_id ?? "—")}</span></div>
      <h1>${esc(s.name)}</h1><p class="lead">${s.type === "original" ? "by" : esc(TYPE_LABEL[s.type] || "") + " by"} ${esc(s.author || "Unknown")}</p>
      <div class="btns" style="margin-top:14px">
        <button class="btn primary" type="button" data-play="${s.id}" ${s.audio_file ? "" : "disabled"}>${ICON.play} ${s.audio_file ? "Play" : "No audio yet"}</button>
        <button class="btn" type="button" id="songQueue" ${s.audio_file ? "" : "disabled"}>${ICON.list} Play next</button>
        <button class="btn" type="button" id="songAdd">${ICON.plus} Add to playlist</button>
        <button class="btn ghost" type="button" data-copy="${s.id}">${ICON.copy} Copy song ID</button>
      </div></div>
    ${ring(overall(s))}
  </section>
  <div class="song-grid">
    <div class="col-main">
      ${videoBlock(s)}
      <section class="card o-chart">
        <div class="card-head"><h2>Favourite parts</h2><p class="muted small">How many players picked each moment as their favourite.${ME.user ? " Tap or click the graph to choose yours." : ` <a class="link" href="#login">Sign in</a> to pick yours.`}</p></div>
        <div class="chart" id="chart" tabindex="0" role="application" aria-label="Favourite parts graph"></div>
        <div class="chart-actions" id="chartActions"></div>
      </section>
      ${sibs.length ? `<section class="o-sibs"><div class="section-head" style="margin-bottom:12px"><h2>Other versions on song ID ${esc(s.song_id)}</h2></div>
        <div class="table compact" id="sibs">${sibs.map(x => songRow(x, songsFor(s.song_id).indexOf(x) + 1, "")).join("")}</div></section>` : ""}
    </div>
    <aside class="col-side">
      ${breakdownCard(s)}
      <section class="card card-pad o-rate" id="rateCard"></section>
      <section class="card card-pad o-details"><h3>Details</h3>
        <dl class="dl">
          <dt>Song ID</dt><dd class="mono">${esc(s.song_id ?? "—")}</dd>
          <dt>Author</dt><dd>${esc(s.author || "—")}</dd>
          <dt>Type</dt><dd>${esc(TYPE_LABEL[s.type] || "—")}</dd>
          ${s.type === "mashup" ? `<dt>Songs</dt><dd>${[s.song_a, s.song_b].map(id => DB.songById[id] ? `<a href="#song-${id}">${esc(DB.songById[id].name)}</a>` : "—").join(" + ")}</dd>` : ""}
          <dt>Length</dt><dd class="mono">${esc(lenText(s.length))}</dd>
          <dt>Votes</dt><dd class="mono">${num(voteCount(s))}</dd>
          <dt>Added</dt><dd>${dateFmt(s.created_at)}</dd>
          ${s.video ? `<dt>Video</dt><dd><a href="${esc(s.video)}" target="_blank" rel="noopener">Open ↗</a></dd>` : ""}
        </dl></section>
      <section class="card card-pad o-levels"><h3>Used in levels</h3>
        ${lvls.length ? `<ul class="mini-list">${lvls.map(l => `<li><a href="#level-${l.id}"><span class="grow"><span class="nm">${esc(l.name)}</span><span class="sb">${esc(l.creators || "")} · <span class="mono">${esc(l.level_id ?? "")}</span></span></span>${diffBadge(l.difficulty)}</a></li>`).join("")}</ul>` : `<p class="muted small">No levels use this song ID yet.</p>`}
      </section>
    </aside>
  </div>`;
}

/* rating card */
const songCtx = { song:null, myVote:null, myFav:null, counts:[], len:180 };
function renderRateCard(){
  const s = songCtx.song, el = $("#rateCard"); if (!el || !s) return;
  const what = s.type === "mashup" ? "mashup" : s.type === "original" ? "song" : (TYPE_LABEL[s.type] || "song").toLowerCase();
  if (!ME.user){ el.innerHTML = `<h3>Rate this ${what}</h3><p class="muted small" style="margin:8px 0 14px">Sign in to vote. Every account gets one vote per song.</p><a class="btn primary" href="#login">Sign in to vote</a>`; return; }
  const mine = songCtx.myVote, start = mine ? Math.round(+mine.score) : Math.round(ownScore(s) ?? 50);
  el.innerHTML = `<h3>Rate this ${what}</h3>
    ${s.type === "mashup" ? `<p class="small muted" style="margin:6px 0 0">Your vote rates the mashing quality. Song A and Song B are rated on their own pages.</p>` : ""}
    <div class="rate-row"><label for="rateIn">${s.type === "mashup" ? "Mashing quality" : "Your score"}</label><output id="rateOut" for="rateIn" style="color:${scoreColor(start)}">${start}</output></div>
    <input type="range" id="rateIn" min="0" max="100" step="1" value="${start}" style="--p:${start}%">
    <div class="btns"><button class="btn primary" id="rateSave" type="button">${mine ? "Update vote" : "Submit vote"}</button>${mine ? `<button class="btn ghost" id="rateClear" type="button">Remove</button>` : ""}</div>
    ${mine ? `<p class="small muted" style="margin:10px 0 0">You voted <b class="mono" style="color:var(--text)">${Math.round(+mine.score)}</b>.</p>` : ""}`;
  const rin = $("#rateIn"), rout = $("#rateOut");
  rin.addEventListener("input", () => { rout.textContent = rin.value; rout.style.color = scoreColor(+rin.value); rin.style.setProperty("--p", rin.value + "%"); });
  $("#rateSave").onclick = async () => {
    const btn = $("#rateSave"); btn.disabled = true;
    try {
      const score = +rin.value;
      if (songCtx.myVote) await run(sb.from("votes").update({score}).eq("id", songCtx.myVote.id));
      else await run(sb.from("votes").insert({user_id:ME.user.id, song:s.id, score}));
      await afterVoteChange(s); toast(`Voted ${score} · score now ${fmt(overall(DB.songById[s.id]))}`);
    } catch(e){ toast(e.message, true); btn.disabled = false; }
  };
  const rc = $("#rateClear");
  if (rc) rc.onclick = async () => { try { await run(sb.from("votes").delete().eq("id", songCtx.myVote.id)); await afterVoteChange(s); toast("Vote removed"); } catch(e){ toast(e.message, true); } };
}
async function afterVoteChange(s){
  try { await sb.rpc("recalc_song", {_song:s.id}); } catch(_){}
  const [st, sg] = await Promise.all([loadStats(), sb.from("songs").select("*").eq("id", s.id).maybeSingle()]);
  if (sg && sg.data){ Object.assign(DB.songById[s.id], sg.data); }
  render({keepScroll:true});
}
async function loadSongExtras(s){
  songCtx.song = s; songCtx.myVote = null; songCtx.myFav = null; songCtx.counts = [];
  const len = parseLen(s.length);
  const tasks = [
    sb.from("favourite_counts").select("time,quantity").eq("song", s.id).then(r => { if (r.error) throw r.error; songCtx.counts = r.data || []; })
      .catch(() => sb.from("favourite_parts").select("time").eq("song", s.id).then(r => { const m = {}; (r.data || []).forEach(x => m[x.time] = (m[x.time] || 0) + 1); songCtx.counts = Object.entries(m).map(([t, q]) => ({time:+t, quantity:q})); }))
  ];
  if (ME.user){
    tasks.push(sb.from("votes").select("id,score").eq("song", s.id).eq("user_id", ME.user.id).maybeSingle().then(r => { songCtx.myVote = r.data || null; }));
    tasks.push(sb.from("favourite_parts").select("id,time").eq("song", s.id).eq("user_id", ME.user.id).maybeSingle().then(r => { songCtx.myFav = r.data || null; }));
  }
  await Promise.allSettled(tasks);
  const maxT = songCtx.counts.reduce((m, c) => Math.max(m, +c.time), 0);
  songCtx.len = Math.max(len || 0, maxT + CONFIG.BUCKET, len ? 0 : 120);
}

/* ---------- favourite-part chart ---------- */
function heat(){
  const n = Math.max(1, Math.ceil(songCtx.len / CONFIG.BUCKET)), h = new Array(n).fill(0);
  songCtx.counts.forEach(c => { const i = Math.min(n - 1, Math.max(0, Math.floor(+c.time / CONFIG.BUCKET))); h[i] += +c.quantity || 0; });
  return h;
}
const argmax = a => a.reduce((bi, v, i) => v > a[bi] ? i : bi, 0);
const bucketRange = i => mmss(i * CONFIG.BUCKET) + "–" + mmss(Math.min(songCtx.len, (i + 1) * CONFIG.BUCKET));
function monotonePath(p){
  const n = p.length; if (n < 2) return "";
  const dx = [], m = [], t = new Array(n);
  for (let i = 0; i < n - 1; i++){ dx[i] = p[i+1][0] - p[i][0]; m[i] = dx[i] ? (p[i+1][1] - p[i][1]) / dx[i] : 0; }
  t[0] = m[0]; t[n-1] = m[n-2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i-1] * m[i] <= 0 ? 0 : (m[i-1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++){
    if (m[i] === 0){ t[i] = 0; t[i+1] = 0; continue; }
    const a = t[i] / m[i], b = t[i+1] / m[i], s = a*a + b*b;
    if (s > 9){ const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i+1] = k * b * m[i]; }
  }
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++){ const h = dx[i] / 3;
    d += `C${(p[i][0]+h).toFixed(1)},${(p[i][1]+t[i]*h).toFixed(1)} ${(p[i+1][0]-h).toFixed(1)},${(p[i+1][1]-t[i+1]*h).toFixed(1)} ${p[i+1][0].toFixed(1)},${p[i+1][1].toFixed(1)}`; }
  return d;
}
function niceMax(v){ const raw = Math.max(v, 4) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))); return ([1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw) || 10 * mag) * 4; }
function drawChart(){
  const el = $("#chart"), s = songCtx.song; if (!el || !s) return;
  const H = heat(), n = H.length, total = H.reduce((a, b) => a + b, 0), pk = argmax(H), sel = state.chartSel[s.id];
  const fav = songCtx.myFav ? Math.min(n - 1, Math.floor(songCtx.myFav.time / CONFIG.BUCKET)) : null;
  const W = Math.max(260, el.clientWidth), Ht = W < 520 ? 210 : 250, L = songCtx.len;
  const P_ = {l:40, r:12, t:22, b:28}, iw = W - P_.l - P_.r, ih = Ht - P_.t - P_.b;
  const yMax = niceMax(Math.max(...H));
  const x = t => P_.l + t / L * iw, y = v => P_.t + ih - v / yMax * ih, cx = i => x(Math.min(L, (i + .5) * CONFIG.BUCKET));
  const pts = H.map((v, i) => [cx(i), y(v)]);
  const line = monotonePath([[x(0), pts[0][1]], ...pts, [x(L), pts[n-1][1]]]);
  const area = line + `L${x(L).toFixed(1)},${y(0)}L${x(0)},${y(0)}Z`;
  let grid = "";
  for (let k = 0; k <= 4; k++){ const v = yMax * k / 4, yy = y(v).toFixed(1);
    grid += `<line x1="${P_.l}" x2="${W - P_.r}" y1="${yy}" y2="${yy}" stroke="#1d2b23" ${k ? 'stroke-dasharray="3 4"' : ""}/><text x="${P_.l - 8}" y="${yy}" dy="4" text-anchor="end" fill="#5a7064" font-size="11" font-family="JetBrains Mono,monospace">${compact(Math.round(v))}</text>`; }
  const step = [5,10,15,20,30,60,90,120,300].find(st => L / st <= Math.max(3, Math.floor(iw / 64))) || 300;
  for (let t = 0; t <= L; t += step) grid += `<text x="${x(t).toFixed(1)}" y="${Ht - 8}" text-anchor="middle" fill="#5a7064" font-size="11" font-family="JetBrains Mono,monospace">${mmss(t)}</text>`;
  const marker = (i, color, label, dash) => `<line x1="${cx(i)}" x2="${cx(i)}" y1="${P_.t}" y2="${y(0)}" stroke="${color}" stroke-width="1.5" ${dash ? 'stroke-dasharray="4 4"' : ""}/><circle cx="${cx(i)}" cy="${y(H[i])}" r="5" fill="#090e0b" stroke="${color}" stroke-width="2.5"/>${label ? `<text x="${Math.min(Math.max(cx(i), P_.l + 40), W - P_.r - 40)}" y="${P_.t - 8}" text-anchor="middle" fill="${color}" font-size="11" font-weight="600" font-family="Inter,sans-serif">${label}</text>` : ""}`;
  el.setAttribute("aria-label", total ? `Favourite parts graph. Most loved ${bucketRange(pk)} with ${H[pk]} players.` : "Favourite parts graph. No picks yet.");
  el.innerHTML = `<svg width="${W}" height="${Ht}" viewBox="0 0 ${W} ${Ht}" aria-hidden="true">
    <defs><linearGradient id="hg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#34d17a" stop-opacity=".45"/><stop offset="1" stop-color="#34d17a" stop-opacity="0"/></linearGradient></defs>
    ${grid}<text x="${P_.l}" y="${P_.t - 8}" fill="#5a7064" font-size="10.5" font-family="Inter,sans-serif">Players</text>
    <path d="${area}" fill="url(#hg)"/><path d="${line}" fill="none" stroke="#34d17a" stroke-width="2.2" stroke-linejoin="round"/>
    ${total ? marker(pk, "#5cf09a", sel === undefined || sel === pk ? "Most loved" : "", false) : `<text x="${P_.l + iw / 2}" y="${P_.t + ih / 2}" text-anchor="middle" fill="#5a7064" font-size="13" font-family="Inter,sans-serif">No favourite picks yet</text>`}
    ${fav !== null && (fav !== pk || !total) ? marker(fav, "#f2d272", fav === sel ? "" : "Your pick", true) : ""}
    ${sel !== undefined && (sel !== pk || !total) && sel !== fav ? marker(sel, "#e3eee7", "Selected", true) : ""}
    <g id="hov" style="display:none"><line id="hovL" y1="${P_.t}" y2="${y(0)}" stroke="#8aa395" stroke-width="1"/><circle id="hovC" r="4" fill="#34d17a"/></g>
    <rect id="hit" x="${P_.l}" y="${P_.t}" width="${iw}" height="${ih}" fill="transparent" style="cursor:crosshair"/>
  </svg><div class="tip" hidden></div>`;
  const svg = $("svg", el), hit = $("#hit", el), hov = $("#hov", el), tip = $(".tip", el);
  const idxAt = ev => { const r = svg.getBoundingClientRect(); const t = (ev.clientX - r.left - P_.l) / iw * L; return Math.max(0, Math.min(n - 1, Math.floor(t / CONFIG.BUCKET))); };
  hit.addEventListener("pointermove", ev => { const i = idxAt(ev), X = cx(i), Y = y(H[i]);
    hov.style.display = ""; $("#hovL", el).setAttribute("x1", X); $("#hovL", el).setAttribute("x2", X); $("#hovC", el).setAttribute("cx", X); $("#hovC", el).setAttribute("cy", Y);
    tip.hidden = false; tip.innerHTML = `${bucketRange(i)} · <b>${num(H[i])}</b> player${H[i] === 1 ? "" : "s"}`; tip.style.left = Math.min(Math.max(X, 70), W - 70) + "px"; tip.style.top = Y + "px"; });
  hit.addEventListener("pointerleave", () => { hov.style.display = "none"; tip.hidden = true; });
  hit.addEventListener("click", ev => { state.chartSel[s.id] = idxAt(ev); drawChart(); renderChartActions(); });
}
function renderChartActions(){
  const box = $("#chartActions"), s = songCtx.song; if (!box || !s) return;
  const H = heat(), total = H.reduce((a, b) => a + b, 0), pk = argmax(H), sel = state.chartSel[s.id];
  const fav = songCtx.myFav ? Math.min(H.length - 1, Math.floor(songCtx.myFav.time / CONFIG.BUCKET)) : null;
  const i = sel !== undefined ? sel : (total ? pk : null);
  const isFav = fav !== null && fav === i;
  box.innerHTML = `<div>${i === null ? `<span class="muted">${total} picks so far.</span>` : `${sel !== undefined ? "Selected" : "Most loved"} <b>${bucketRange(i)}</b> · ${num(H[i])} player${H[i] === 1 ? "" : "s"}`}${fav !== null && !isFav ? ` <span class="muted small">· your pick: ${bucketRange(fav)}</span>` : ""}</div>
    <div class="btns">
      ${i !== null && ME.user ? `<button class="btn ${isFav ? "" : "primary"} sm" type="button" id="favBtn" ${isFav ? "disabled" : ""}>${isFav ? "★ Your favourite" : "Mark as my favourite"}</button>` : ""}
      ${fav !== null ? `<button class="btn ghost sm" type="button" id="favClear">Clear my pick</button>` : ""}
      ${i !== null && s.audio_file ? `<button class="btn ghost sm" type="button" id="favPlay">${ICON.play} Play from ${mmss(i * CONFIG.BUCKET)}</button>` : ""}
    </div>`;
  const fb = $("#favBtn");
  if (fb && !isFav) fb.onclick = () => saveFav(i * CONFIG.BUCKET);
  const fc = $("#favClear");
  if (fc) fc.onclick = async () => { try { await run(sb.from("favourite_parts").delete().eq("id", songCtx.myFav.id)); await refreshFavs(); toast("Favourite cleared"); } catch(e){ toast(e.message, true); } };
  const fp = $("#favPlay");
  if (fp) fp.onclick = () => { if (!P.cur || P.cur.id !== s.id) P.playOne(s.id); setTimeout(() => P.seekTo(i * CONFIG.BUCKET), P.cur && P.cur.id === s.id && P.audio.readyState > 0 ? 0 : 400); };
}
async function saveFav(time){
  const s = songCtx.song;
  try {
    if (songCtx.myFav) await run(sb.from("favourite_parts").update({time}).eq("id", songCtx.myFav.id));
    else await run(sb.from("favourite_parts").insert({user_id:ME.user.id, song:s.id, time}));
    await refreshFavs(); toast(`Favourite set to ${mmss(time)}`);
  } catch(e){ toast(e.message, true); }
}
async function refreshFavs(){ await loadSongExtras(songCtx.song); drawChart(); renderChartActions(); }
async function mountSong(s){
  bindCopy(app); bindPlayButtons(app, [s.id, ...songsFor(s.song_id).filter(x => x.id !== s.id).map(x => x.id)]);
  $("#songAdd").onclick = () => openAddToPlaylist(s.id);
  $("#songQueue").onclick = () => P.enqueue(s.id);
  $("#rateCard").innerHTML = `<h3>Rate</h3><p class="muted small">Loading…</p>`;
  $("#chart").innerHTML = `<div class="skel" style="height:200px;border:0"></div>`;
  await loadSongExtras(s);
  if (route().id !== s.id) return;
  renderRateCard(); drawChart(); renderChartActions();
  const el = $("#chart");
  el.addEventListener("keydown", ev => {
    const n = heat().length, cur = state.chartSel[s.id] !== undefined ? state.chartSel[s.id] : argmax(heat());
    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft"){ ev.preventDefault(); state.chartSel[s.id] = Math.max(0, Math.min(n - 1, cur + (ev.key === "ArrowRight" ? 1 : -1))); drawChart(); renderChartActions(); }
    else if ((ev.key === "Enter" || ev.key === " ") && ME.user){ ev.preventDefault(); saveFav(cur * CONFIG.BUCKET); }
  });
}

/* =====================================================================
   VIEW: SEARCH
   ===================================================================== */
function viewSearch(){
  return `<section class="hero single" style="margin-bottom:18px"><div><p class="eyebrow">Search everything</p><h1>Search</h1><p class="lead" id="searchSummary"></p></div></section>
    <div class="toolbar"><div class="chips" id="searchTabs" role="group" aria-label="Result type"></div></div><div id="searchResults"></div>`;
}
function renderSearch(){
  const q = state.searchQ.trim(), sum = $("#searchSummary"); if (!sum) return;
  const songs = q ? DB.songs.filter(s => matches(songHay(s), q)).sort(byScore) : [];
  const lvls = q ? DB.levels.filter(l => matches(levelHay(l), q)) : [];
  sum.innerHTML = q ? `${songs.length + lvls.length} result${songs.length + lvls.length === 1 ? "" : "s"} for “<b style="color:var(--text)">${esc(q)}</b>” across all levels.` : "Type in the search bar above to search every song and level.";
  $("#searchTabs").innerHTML = [["all","All",songs.length + lvls.length],["songs","Songs",songs.length],["levels","Levels",lvls.length]]
    .map(([v,l,n]) => `<button class="chip" type="button" data-v="${v}" aria-pressed="${state.searchTab === v}">${l}<span class="n">${n}</span></button>`).join("");
  const rankMap = new Map(ranked().filter(s => overall(s) !== null).map((s, i) => [s, i + 1]));
  let html = "";
  if (!q) html = `<div class="table">${emptyState("Start typing", "Search by song, artist, level name, level ID, song ID or creator.")}</div>`;
  else {
    if (state.searchTab !== "levels") html += `<section style="margin-bottom:28px"><div class="section-head"><h2>Songs</h2></div><div class="table" id="srSongs">${songs.length ? tableHead() + songs.map(s => songRow(s, rankMap.get(s), q)).join("") : emptyState("No songs found", "Try fewer words or a song ID.")}</div></section>`;
    if (state.searchTab !== "songs") html += `<section><div class="section-head"><h2>Levels</h2></div>${lvls.length ? `<div class="grid">${lvls.map(l => levelCard(l, q)).join("")}</div>` : `<div class="table">${emptyState("No levels found", "Try a level name, ID or creator.")}</div>`}</section>`;
  }
  $("#searchResults").innerHTML = html;
  bindPlayButtons($("#searchResults"), songs.map(s => s.id));
}
function mountSearch(){
  renderSearch();
  $("#searchTabs").addEventListener("click", e => { const b = e.target.closest(".chip"); if (!b) return; state.searchTab = b.dataset.v; renderSearch(); });
}

/* =====================================================================
   VIEW: LOGIN / SIGN UP
   ===================================================================== */
function viewAuth(mode){
  return `<div class="auth-wrap"><div class="card card-pad">
    <div class="tabs" role="tablist"><button type="button" role="tab" aria-selected="${mode === "login"}" data-mode="login">Sign in</button><button type="button" role="tab" aria-selected="${mode === "signup"}" data-mode="signup">Create account</button></div>
    <form class="form" id="authForm" novalidate>
      ${mode === "signup" ? `<label class="f">Username <input class="input" name="username" autocomplete="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_.\\-]+" placeholder="e.g. Quillon"></label>` : ""}
      <label class="f">Email <input class="input" name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label>
      ${mode !== "reset" ? `<label class="f">Password <input class="input" name="password" type="password" autocomplete="${mode === "signup" ? "new-password" : "current-password"}" required minlength="8" placeholder="At least 8 characters"></label>` : ""}
      <p class="msg" id="authMsg" hidden></p>
      <button class="btn primary block" type="submit">${mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}</button>
      ${mode === "login" ? `<button class="btn ghost sm" type="button" id="forgot" style="justify-self:center">Forgot password?</button>` : ""}
      ${mode === "reset" ? `<a class="btn ghost sm" href="#login" style="justify-self:center">Back to sign in</a>` : ""}
    </form></div></div>`;
}
function mountAuth(mode){
  $$("[data-mode]").forEach(b => b.onclick = () => { location.hash = b.dataset.mode; });
  const fg = $("#forgot"); if (fg) fg.onclick = () => { app.innerHTML = viewAuth("reset"); mountAuth("reset"); };
  const f = $("#authForm"), msg = $("#authMsg");
  const show = (t, ok = false) => { msg.hidden = false; msg.textContent = t; msg.classList.toggle("ok", ok); };
  f.addEventListener("submit", async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(f));
    if (!f.checkValidity()){ const bad = $(":invalid", f); show(bad.name === "username" ? "Username: 3–24 letters, numbers, _ . or -" : bad.name === "password" ? "Password must be at least 8 characters." : "Enter a valid email address."); bad.focus(); return; }
    const btn = $("button[type=submit]", f); btn.disabled = true;
    try {
      if (mode === "signup"){
        const r = await run(sb.auth.signUp({email:d.email, password:d.password, options:{data:{username:d.username}, emailRedirectTo:location.origin + location.pathname}}));
        if (r.data.session){ toast("Welcome to GDSR!"); location.hash = "list"; }
        else show("Check your email to confirm your account, then sign in.", true);
      } else if (mode === "reset"){
        await run(sb.auth.resetPasswordForEmail(d.email, {redirectTo:location.origin + location.pathname + "#account"}));
        show("If that email has an account, a reset link is on its way.", true);
      } else {
        await run(sb.auth.signInWithPassword({email:d.email, password:d.password}));
        toast("Signed in"); location.hash = "list";
      }
    } catch(err){ show(err.message); }
    btn.disabled = false;
  });
}

/* =====================================================================
   VIEW: ACCOUNT
   ===================================================================== */
function viewAccount(){
  if (!ME.user) return requireLogin("see your profile");
  const n = myName();
  return `<section class="page-head" style="margin-bottom:18px"><div style="display:flex;gap:16px;align-items:center">
      <div class="avatar-lg">${esc(n.slice(0,1).toUpperCase() || "U")}</div>
      <div><h1 style="font-size:30px">${esc(n)}</h1><p class="muted" style="margin:4px 0 0">${ME.isAdmin ? `<span class="badge admin">Admin</span> · ` : ""}Member since ${dateFmt(ME.profile && ME.profile.created_at || ME.user.created_at)}</p></div></div>
    <div class="btns"><a class="btn" href="#settings">${ICON.gear} Settings</a><a class="btn primary" href="#request">${ICON.plus} New request</a></div></section>
  <div class="stats" id="profStats" style="margin-bottom:18px">
    <div class="stat"><b id="stVotes">–</b><span>Votes</span></div><div class="stat"><b id="stReqs">–</b><span>Requests</span></div>
    <div class="stat"><b id="stApproved">–</b><span>Approved</span></div><div class="stat"><b id="stPl">–</b><span>Playlists</span></div></div>
  <div class="song-grid" style="margin-top:0;grid-template-columns:1fr 1fr">
    <section class="card card-pad"><h3>My requests</h3><div id="myReqs"><p class="muted small">Loading…</p></div></section>
    <section class="card card-pad"><h3>My votes</h3><div id="myVotes"><p class="muted small">Loading…</p></div></section>
  </div>`;
}
async function mountAccount(){
  if (!ME.user) return;
  const [lr, sr, vt, pl] = await Promise.allSettled([
    run(sb.from("level_requests").select("*").eq("user_id", ME.user.id).order("created_at", {ascending:false})),
    run(sb.from("song_requests").select("*").eq("user_id", ME.user.id).order("created_at", {ascending:false})),
    run(sb.from("votes").select("*").eq("user_id", ME.user.id).order("created_at", {ascending:false})),
    PL.list()
  ]);
  const reqs = [...(lr.value ? lr.value.data.map(r => ({...r, kind:"Level"})) : []), ...(sr.value ? sr.value.data.map(r => ({...r, kind:"Song"})) : [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const votes = vt.value ? vt.value.data : [];
  const mr = $("#myReqs"); if (!mr) return;
  $("#stVotes").textContent = votes.length; $("#stReqs").textContent = reqs.length;
  $("#stApproved").textContent = reqs.filter(r => r.status === "approved").length; $("#stPl").textContent = pl.value ? pl.value.length : 0;
  mr.innerHTML = reqs.length ? `<ul class="mini-list">${reqs.map(r => `<li><div class="mi"><span class="grow"><span class="nm">${esc(r.kind)}: ${esc(r.name || "Untitled")}</span><span class="sb">${dateFmt(r.created_at)}${r.admin_note ? ` · Admin note: ${esc(r.admin_note)}` : ""}</span></span>${statusBadge(r.status)}</div></li>`).join("")}</ul>` : `<p class="muted small">No requests yet.</p>`;
  $("#myVotes").innerHTML = votes.length ? `<ul class="mini-list">${votes.map(v => { const s = DB.songById[v.song]; return `<li><a href="#song-${esc(v.song)}"><span class="grow"><span class="nm">${esc(s ? s.name : "Deleted song")}</span><span class="sb">${dateFmt(v.created_at)}</span></span><b class="mono" style="color:${scoreColor(+v.score)}">${Math.round(+v.score)}</b></a></li>`; }).join("")}</ul>` : `<p class="muted small">You haven't voted yet. Open any song to rate it.</p>`;
}

/* =====================================================================
   VIEW: SETTINGS
   ===================================================================== */
const SETTINGS_TABS = [["profile","Profile",true],["account","Account & security",true],["playback","Playback",false],["display","Display",false],["data","Data & privacy",false]];
const swRow = (key, title, desc) => `<div class="set-row"><div class="lbl"><b>${title}</b><span>${desc}</span></div><div class="ctl"><label class="switch"><input type="checkbox" data-pref="${key}" ${PREFS[key] ? "checked" : ""} aria-label="${esc(title)}"><span></span></label></div></div>`;
function viewSettings(tab){
  const t = SETTINGS_TABS.find(x => x[0] === tab) || SETTINGS_TABS[ME.user ? 0 : 2];
  return `<section class="hero single" style="margin-bottom:18px"><div><h1>Settings</h1><p class="lead">Manage your profile, account and how GDSR works for you.</p></div></section>
  <div class="settings">
    <nav class="side" aria-label="Settings sections">${SETTINGS_TABS.map(([k, l, auth]) => `<a href="#settings-${k}" class="${t[0] === k ? "active" : ""}">${l}${auth && !ME.user ? '<span class="faint small">Sign in</span>' : ""}</a>`).join("")}</nav>
    <div class="set-panel" id="setPanel">${settingsPanel(t[0])}</div>
  </div>`;
}
function settingsPanel(tab){
  const n = myName(), needAuth = `<div class="set-card"><header><h2>Sign in required</h2><p>Sign in to manage this section.</p></header><div class="set-row"><div class="lbl"><b>You're signed out</b><span>Playback, display and data settings still work without an account.</span></div><div class="ctl"><a class="btn primary" href="#login">Sign in</a></div></div></div>`;
  switch (tab){
    case "profile": if (!ME.user) return needAuth;
      return `<div class="set-card"><header><h2>Profile</h2><p>This is how other people see you on GDSR.</p></header>
        <form id="profForm" novalidate>
          <div class="set-row"><div class="lbl" style="display:flex;gap:14px;align-items:center"><div class="avatar-lg" id="avPrev">${esc(n.slice(0,1).toUpperCase() || "U")}</div><div><b>Avatar</b><span>Generated from your username.</span></div></div></div>
          <div class="set-row"><div class="lbl"><b>Username</b><span>3–24 characters: letters, numbers, _ . or -</span></div><div class="ctl"><input class="input" name="username" value="${esc(n)}" minlength="3" maxlength="24" pattern="[A-Za-z0-9_.\\-]+" required autocomplete="username"></div></div>
          <div class="set-row"><div class="lbl"><b>Role</b><span>Roles are managed by admins.</span></div><div class="ctl">${ME.isAdmin ? '<span class="badge admin">Admin</span>' : '<span class="badge">User</span>'}</div></div>
          <div class="set-row" style="justify-content:flex-end"><button class="btn primary" type="submit">Save profile</button></div>
        </form></div>`;
    case "account": if (!ME.user) return needAuth;
      return `<div class="set-card"><header><h2>Account</h2><p>Your sign-in details.</p></header>
          <div class="set-row"><div class="lbl"><b>Email</b><span>Used to sign in and for password resets.</span></div><div class="ctl"><input class="input" value="${esc(ME.user.email || "")}" disabled></div></div>
          <div class="set-row"><div class="lbl"><b>Member since</b><span>&nbsp;</span></div><div class="ctl">${dateFmt(ME.profile && ME.profile.created_at || ME.user.created_at)}</div></div></div>
        <div class="set-card"><header><h2>Password</h2><p>Use at least 8 characters.</p></header>
          <form id="pwForm" novalidate>
            <div class="set-row"><div class="lbl"><b>New password</b></div><div class="ctl"><input class="input" name="password" type="password" minlength="8" autocomplete="new-password" required></div></div>
            <div class="set-row"><div class="lbl"><b>Confirm password</b></div><div class="ctl"><input class="input" name="confirm" type="password" minlength="8" autocomplete="new-password" required></div></div>
            <div class="set-row" style="justify-content:flex-end"><button class="btn primary" type="submit">Change password</button></div>
          </form></div>
        <div class="set-card"><header><h2>Sessions</h2></header>
          <div class="set-row"><div class="lbl"><b>Sign out</b><span>Sign out on this device.</span></div><div class="ctl"><button class="btn" id="soHere" type="button">Sign out</button></div></div>
          <div class="set-row"><div class="lbl"><b>Sign out everywhere</b><span>Ends your session on every device.</span></div><div class="ctl"><button class="btn danger" id="soAll" type="button">Sign out everywhere</button></div></div></div>`;
    case "playback":
      return `<div class="set-card"><header><h2>Playback</h2><p>How the music player behaves. Saved on this device.</p></header>
        <div class="set-row"><div class="lbl"><b>Volume</b><span>Default player volume.</span></div><div class="ctl"><input type="range" id="setVol" min="0" max="100" value="${Math.round(P.audio.volume * 100)}" style="--p:${Math.round(P.audio.volume * 100)}%" aria-label="Volume"><span class="mono small" id="setVolOut" style="width:38px;text-align:right">${Math.round(P.audio.volume * 100)}%</span></div></div>
        ${swRow("autoplay", "Autoplay next song", "Keep playing the next song in the queue when one ends.")}
        ${swRow("shuffleDefault", "Shuffle by default", "Start new queues in shuffle mode.")}
        <div class="set-row"><div class="lbl"><b>Repeat</b><span>What happens at the end of the queue.</span></div><div class="ctl"><select class="select" id="setRepeat">${[["off","Off"],["all","Repeat queue"],["one","Repeat song"]].map(([v, l]) => `<option value="${v}"${P.repeat === v ? " selected" : ""}>${l}</option>`).join("")}</select></div></div></div>`;
    case "display":
      return `<div class="set-card"><header><h2>Display</h2><p>Saved on this device.</p></header>
        ${swRow("compact", "Compact lists", "Shorter rows that hide the second line, so more songs fit on screen.")}
        ${swRow("reduceMotion", "Reduce motion", "Turn off animations and transitions.")}
        ${swRow("showNoAudio", "Show songs without audio", "Include songs that have no audio file in lists.")}</div>`;
    case "data": {
      const local = PL.localAll().length;
      return `<div class="set-card"><header><h2>Your data</h2><p>Download what you've created on GDSR.</p></header>
          <div class="set-row"><div class="lbl"><b>Export playlists</b><span>All your playlists as one JSON file of song IDs.</span></div><div class="ctl"><button class="btn" id="expPl" type="button">Export</button></div></div>
          ${ME.user ? `<div class="set-row"><div class="lbl"><b>Export votes</b><span>Every vote you've cast, as CSV.</span></div><div class="ctl"><button class="btn" id="expVotes" type="button">Export</button></div></div>` : ""}</div>
        <div class="set-card danger-zone"><header><h2>Clear this device</h2><p>Removes data stored in this browser only. Your account is not affected.</p></header>
          <div class="set-row"><div class="lbl"><b>Browser playlists</b><span>${local} playlist${local === 1 ? "" : "s"} saved in this browser.</span></div><div class="ctl"><button class="btn danger" id="clrPl" type="button" ${local ? "" : "disabled"}>Delete</button></div></div>
          <div class="set-row"><div class="lbl"><b>Reset preferences</b><span>Playback and display settings go back to their defaults.</span></div><div class="ctl"><button class="btn danger" id="clrPrefs" type="button">Reset</button></div></div></div>`;
    }
  }
  return "";
}
function mountSettings(tab){
  tab = (SETTINGS_TABS.find(x => x[0] === tab) || SETTINGS_TABS[ME.user ? 0 : 2])[0];
  $$("[data-pref]").forEach(el => el.addEventListener("change", () => { setPref(el.dataset.pref, el.checked); toast("Saved"); }));
  const pf = $("#profForm");
  if (pf){
    const inp = $("[name=username]", pf);
    inp.addEventListener("input", () => { $("#avPrev").textContent = (inp.value.trim()[0] || "U").toUpperCase(); });
    pf.addEventListener("submit", async e => { e.preventDefault();
      if (!inp.checkValidity()){ toast("Username: 3–24 letters, numbers, _ . or -", true); inp.focus(); return; }
      try { await run(sb.from("profiles").update({username:inp.value.trim()}).eq("id", ME.user.id)); await refreshMe((await sb.auth.getSession()).data.session); toast("Profile saved"); }
      catch(err){ toast(/duplicate|unique/i.test(err.message) ? "That username is taken." : err.message, true); } });
  }
  const pw = $("#pwForm");
  if (pw) pw.addEventListener("submit", async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(pw));
    if (d.password.length < 8){ toast("Password must be at least 8 characters.", true); return; }
    if (d.password !== d.confirm){ toast("The passwords don't match.", true); return; }
    try { await run(sb.auth.updateUser({password:d.password})); pw.reset(); toast("Password changed"); } catch(err){ toast(err.message, true); } });
  const soH = $("#soHere"); if (soH) soH.onclick = signOut;
  const soA = $("#soAll"); if (soA) soA.onclick = async () => { if (await confirmBox("Sign out on every device, including this one?", {ok:"Sign out everywhere", danger:true})){ await sb.auth.signOut({scope:"global"}); toast("Signed out everywhere"); location.hash = "list"; } };
  const vol = $("#setVol");
  if (vol) vol.addEventListener("input", () => { P.audio.volume = vol.value / 100; store.set("volume", P.audio.volume); vol.style.setProperty("--p", vol.value + "%"); $("#setVolOut").textContent = vol.value + "%"; const pv = $("#plVol"); if (pv){ pv.value = vol.value; pv.style.setProperty("--p", vol.value + "%"); } });
  const rp = $("#setRepeat"); if (rp) rp.addEventListener("change", () => { P.repeat = rp.value; store.set("repeat", P.repeat); if (P.cur) renderPlayer(); toast("Saved"); });
  const ep = $("#expPl");
  if (ep) ep.onclick = async () => { try { const lists = await PL.list(); download(`gdsr-playlists-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({format:"gdsr-playlists", version:1, playlists:lists.map(p => ({name:p.name, songs:p.songs || []}))}, null, 2)); } catch(e){ toast(e.message, true); } };
  const ev = $("#expVotes");
  if (ev) ev.onclick = async () => { try { const r = await run(sb.from("votes").select("*").eq("user_id", ME.user.id)); download(`gdsr-votes-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(r.data.map(v => ({song_id:v.song, song:(DB.songById[v.song] || {}).name || "", score:v.score, created_at:v.created_at})), ["song_id","song","score","created_at"]), "text/csv"); } catch(e){ toast(e.message, true); } };
  const cp = $("#clrPl"); if (cp) cp.onclick = async () => { if (await confirmBox("Delete all playlists saved in this browser?", {ok:"Delete", danger:true})){ PL.localSave([]); toast("Browser playlists deleted"); render({keepScroll:true}); } };
  const cr = $("#clrPrefs"); if (cr) cr.onclick = async () => { if (await confirmBox("Reset playback and display settings to their defaults?", {ok:"Reset", danger:true})){ Object.assign(PREFS, PREF_DEFAULTS); store.set("prefs", PREFS); applyPrefs(); toast("Preferences reset"); render({keepScroll:true}); } };
}

/* =====================================================================
   VIEW: REQUESTS (users submit levels / songs)
   ===================================================================== */
const LEVEL_FIELDS = [
  {k:"name", label:"Level name", type:"text", req:true},
  {k:"level_id", label:"Level ID", type:"int", req:true},
  {k:"creators", label:"Creators", type:"text", hint:"Comma-separated"},
  {k:"verifier", label:"Verifier", type:"text"},
  {k:"length", label:"Length", type:"text", hint:"m:ss, e.g. 1:52"},
  {k:"difficulty", label:"Difficulty", type:"enum", options:DIFF_ORDER},
  {k:"stars", label:"Stars", type:"int", min:0, max:10},
  {k:"song_id", label:"Song ID", type:"songid", req:true}
];
const SONG_FIELDS = [
  {k:"name", label:"Song name", type:"text", req:true},
  {k:"type", label:"Type", type:"enum", options:TYPES, req:true, labels:TYPE_LABEL},
  {k:"song_id", label:"Song ID", type:"songid", req:true, hint:"The Geometry Dash song ID it replaces"},
  {k:"author", label:"Author", type:"text", hint:"Who made this version"},
  {k:"length", label:"Length", type:"text", hint:"m:ss, e.g. 3:06"},
  {k:"video", label:"Video", type:"url", hint:"YouTube link"},
  {k:"song_a", label:"Song A", type:"song", showIf:v => v.type === "mashup"},
  {k:"song_b", label:"Song B", type:"song", showIf:v => v.type === "mashup"},
  {k:"audio_file", label:"Audio file", type:"audio"}
];
function fieldHtml(f, val, ctx = {}){
  const id = `f_${f.k}`, req = f.req ? ' <span class="req">*</span>' : "", v = val ?? "";
  const wrap = inner => `<label class="f" data-field="${f.k}">${esc(f.label || f.k)}${req}${inner}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ""}</label>`;
  switch (f.type){
    case "enum": { const opts = f.options.slice(); if (v && !opts.includes(v)) opts.unshift(v);
      return wrap(`<select class="select" id="${id}" name="${f.k}" ${f.req ? "required" : ""}><option value="">—</option>${opts.map(o => `<option value="${esc(o)}"${o === v ? " selected" : ""}>${esc((f.labels && f.labels[o]) || o)}</option>`).join("")}</select>`); }
    case "int": case "numeric":
      return wrap(`<input class="input" type="number" id="${id}" name="${f.k}" value="${esc(v)}" ${f.min !== undefined ? `min="${f.min}"` : ""} ${f.max !== undefined ? `max="${f.max}"` : ""} step="${f.type === "int" ? 1 : "0.01"}" ${f.req ? "required" : ""}>`);
    case "songid":
      return wrap(`<input class="input mono" type="number" id="${id}" name="${f.k}" value="${esc(v)}" min="1" step="1" list="songIdList" ${f.req ? "required" : ""}><datalist id="songIdList">${DB.songIds.map(x => `<option value="${x.song_id}">`).join("")}</datalist>`);
    case "song":
      return wrap(`<select class="select" id="${id}" name="${f.k}"><option value="">— none —</option>${DB.songs.slice().sort((a, b) => a.name.localeCompare(b.name)).filter(s => s.id !== ctx.selfId).map(s => `<option value="${s.id}"${s.id === v ? " selected" : ""}>${esc(s.name)} · ${esc(s.author || "")} (${esc(TYPE_LABEL[s.type] || "")})</option>`).join("")}</select>`);
    case "user":
      return wrap(`<select class="select" id="${id}" name="${f.k}" ${f.req ? "required" : ""}><option value="">—</option>${(ctx.users || []).map(u => `<option value="${u.id}"${u.id === v ? " selected" : ""}>${esc(u.username || u.email || u.id)}</option>`).join("")}</select>`);
    case "bool":
      return `<label class="check" data-field="${f.k}"><input type="checkbox" id="${id}" name="${f.k}" ${v ? "checked" : ""}> ${esc(f.label || f.k)}</label>`;
    case "uuidlist":
      return wrap(`<textarea class="textarea mono" id="${id}" name="${f.k}" rows="4">${esc(Array.isArray(v) ? v.join("\n") : v)}</textarea>`);
    case "textarea":
      return wrap(`<textarea class="textarea" id="${id}" name="${f.k}">${esc(v)}</textarea>`);
    case "audio":
      return wrap(`<input type="hidden" id="${id}" name="${f.k}" value="${esc(v)}">
        <span class="upload"><input type="file" id="${id}_file" accept="audio/*"><span class="small muted" id="${id}_info">${v ? esc(String(v).split("/").pop()) : "MP3, OGG, WAV… up to " + CONFIG.MAX_AUDIO_MB + " MB"}</span>
        ${v ? `<audio controls preload="none" src="${esc(audioUrl(v))}"></audio>` : ""}${ctx.admin ? `<input class="input mono small" style="flex:1 1 220px" data-audio-path="${f.k}" value="${esc(v)}" placeholder="or a storage path / URL">` : ""}</span>`);
    case "url":
      return wrap(`<input class="input" type="url" id="${id}" name="${f.k}" value="${esc(v)}" placeholder="https://…" ${f.req ? "required" : ""}>`);
    case "ro":
      return wrap(`<input class="input" value="${esc(v)}" disabled>`);
    default:
      return wrap(`<input class="input" type="text" id="${id}" name="${f.k}" value="${esc(v)}" ${f.req ? "required" : ""} maxlength="300">`);
  }
}
function applyShowIf(form, fields){
  const vals = Object.fromEntries(new FormData(form));
  fields.forEach(f => { if (!f.showIf) return; const el = $(`[data-field="${f.k}"]`, form); if (el) el.style.display = f.showIf(vals) ? "" : "none"; });
}
function bindAudioUpload(form, fields, folder){
  fields.filter(f => f.type === "audio").forEach(f => {
    const fileIn = $(`#f_${f.k}_file`, form), hidden = $(`#f_${f.k}`, form), infoEl = $(`#f_${f.k}_info`, form), pathIn = $(`[data-audio-path="${f.k}"]`, form);
    if (pathIn) pathIn.addEventListener("input", () => { hidden.value = pathIn.value.trim(); });
    fileIn.addEventListener("change", async () => {
      const file = fileIn.files[0]; if (!file) return;
      if (!/^audio\//.test(file.type) && !/\.(mp3|ogg|wav|m4a|flac|aac|opus)$/i.test(file.name)){ toast("Please choose an audio file.", true); fileIn.value = ""; return; }
      if (file.size > CONFIG.MAX_AUDIO_MB * 1024 * 1024){ toast(`Audio must be under ${CONFIG.MAX_AUDIO_MB} MB.`, true); fileIn.value = ""; return; }
      const path = `${folder}/${Date.now()}-${safeName(file.name)}`;
      infoEl.textContent = "Uploading…"; form.dataset.uploading = "1";
      try {
        await run(sb.storage.from(CONFIG.AUDIO_BUCKET).upload(path, file, {contentType:file.type || "audio/mpeg", upsert:false}));
        hidden.value = path; if (pathIn) pathIn.value = path;
        infoEl.innerHTML = `Uploaded <span class="mono">${esc(file.name)}</span>`;
        const old = $("audio", infoEl.parentElement); if (old) old.remove();
        infoEl.insertAdjacentHTML("afterend", `<audio controls preload="metadata" src="${esc(audioUrl(path))}"></audio>`);
        const dur = await audioDuration(file); const lenIn = $(`[name="length"]`, form);
        if (dur && lenIn && !lenIn.value) lenIn.value = mmss(dur);
      } catch(e){ const msg = storageError(e); infoEl.textContent = "Upload failed: " + msg; toast(msg, true); fileIn.value = ""; }
      delete form.dataset.uploading;
    });
  });
}
function audioDuration(file){ return new Promise(res => { const a = document.createElement("audio"); a.preload = "metadata"; a.onloadedmetadata = () => { res(isFinite(a.duration) ? a.duration : null); URL.revokeObjectURL(a.src); }; a.onerror = () => res(null); a.src = URL.createObjectURL(file); }); }
function readForm(form, fields){
  const fd = new FormData(form), out = {};
  for (const f of fields){
    if (f.type === "ro") continue;
    const el = $(`[data-field="${f.k}"]`, form); if (el && el.style.display === "none"){ out[f.k] = null; continue; }
    let v = f.type === "bool" ? fd.has(f.k) : fd.get(f.k);
    if (f.type === "bool"){ out[f.k] = v; continue; }
    v = v === null ? "" : String(v).trim();
    if (f.req && v === "") throw new Error(`${f.label || f.k} is required.`);
    if (v === ""){ out[f.k] = null; continue; }
    if (f.type === "int" || f.type === "songid"){ if (!/^-?\d+$/.test(v)) throw new Error(`${f.label || f.k} must be a whole number.`); v = parseInt(v, 10);
      if (f.min !== undefined && v < f.min || f.max !== undefined && v > f.max) throw new Error(`${f.label || f.k} must be between ${f.min} and ${f.max}.`); }
    else if (f.type === "numeric"){ v = +v; if (isNaN(v)) throw new Error(`${f.label || f.k} must be a number.`); if (f.min !== undefined && v < f.min || f.max !== undefined && v > f.max) throw new Error(`${f.label || f.k} must be between ${f.min} and ${f.max}.`); }
    else if (f.type === "url"){ if (!/^https?:\/\//i.test(v)) throw new Error(`${f.label || f.k} must be a link starting with https://`); }
    else if (f.type === "uuidlist"){ v = v.split(/[\s,;]+/).filter(Boolean); const bad = v.find(x => !isUuid(x)); if (bad) throw new Error(`“${bad}” is not a valid song ID.`); }
    out[f.k] = v;
  }
  return out;
}
function viewRequest(kind){
  if (!ME.user) return requireLogin("request levels and songs");
  const fields = kind === "song" ? SONG_FIELDS : LEVEL_FIELDS;
  return `<section class="hero single"><div><p class="eyebrow">Contribute</p><h1>Request a ${kind}</h1><p class="lead">Admins review every request. You can follow its status on your account page.</p></div></section>
  <div class="auth-wrap" style="max-width:640px;margin-top:0"><div class="card card-pad">
    <div class="tabs" role="tablist"><button type="button" role="tab" aria-selected="${kind === "level"}" data-kind="request">Level</button><button type="button" role="tab" aria-selected="${kind === "song"}" data-kind="request-song">Song</button></div>
    <form class="form" id="reqForm" novalidate>
      ${kind === "song" ? `<div class="row2">${fieldHtml(fields[0])}${fieldHtml(fields[1], "original")}</div><div class="row2">${fieldHtml(fields[2])}${fieldHtml(fields[3])}</div><div class="row2">${fieldHtml(fields[4])}${fieldHtml(fields[5])}</div><div class="row2">${fieldHtml(fields[6])}${fieldHtml(fields[7])}</div>${fieldHtml(fields[8])}`
        : `<div class="row2">${fieldHtml(fields[0])}${fieldHtml(fields[1])}</div><div class="row2">${fieldHtml(fields[2])}${fieldHtml(fields[3])}</div><div class="row2">${fieldHtml(fields[4])}${fieldHtml(fields[5])}</div><div class="row2">${fieldHtml(fields[6])}${fieldHtml(fields[7])}</div>`}
      <p class="msg" id="reqMsg" hidden></p>
      <button class="btn primary" type="submit">Submit request</button>
    </form></div></div>`;
}
function mountRequest(kind){
  if (!ME.user) return;
  const fields = kind === "song" ? SONG_FIELDS : LEVEL_FIELDS, form = $("#reqForm"), msg = $("#reqMsg");
  $$("[data-kind]").forEach(b => b.onclick = () => { location.hash = b.dataset.kind; });
  applyShowIf(form, fields); form.addEventListener("change", () => applyShowIf(form, fields));
  bindAudioUpload(form, fields, `requests/${ME.user.id}`);
  form.addEventListener("submit", async e => {
    e.preventDefault(); msg.hidden = true;
    if (form.dataset.uploading){ toast("Wait for the audio upload to finish.", true); return; }
    try {
      const data = readForm(form, fields);
      if (kind === "song" && data.type === "mashup" && (!data.song_a || !data.song_b)) throw new Error("A mashup needs both Song A and Song B.");
      if (kind === "song" && data.song_a && data.song_a === data.song_b) throw new Error("Song A and Song B must be different songs.");
      await run(sb.from(kind === "song" ? "song_requests" : "level_requests").insert({...data, user_id:ME.user.id, status:"pending"}));
      form.reset(); applyShowIf(form, fields);
      msg.hidden = false; msg.classList.add("ok"); msg.innerHTML = `Request sent! An admin will review it. <a class="link" href="#account">See my requests</a>`;
      toast("Request submitted");
    } catch(err){ msg.hidden = false; msg.classList.remove("ok"); msg.textContent = err.message; }
  });
}

/* =====================================================================
   VIEW: PLAYLISTS
   ===================================================================== */
function viewPlaylists(){
  return `<section class="hero single"><div><p class="eyebrow">Music</p><h1>Playlists</h1><p class="lead">Build playlists, play them in the player, and share them as a file of song IDs.</p></div></section>
    <div id="plNotice"></div>
    <div class="toolbar"><div class="btns"><button class="btn primary" id="plNew" type="button">${ICON.plus} New playlist</button><button class="btn" id="plImport" type="button">Import</button></div></div>
    <div id="plBody">${skeleton(3)}</div>`;
}
async function mountPlaylists(){
  $("#plImport").onclick = () => openImportModal();
  $("#plNew").onclick = () => {
    const bg = openModal({title:"New playlist", body:`<div class="form"><label class="f">Name<input class="input" id="npName" maxlength="80" placeholder="My favourite mashups"></label></div>`,
      foot:`<button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" id="npGo" type="button">Create</button>`});
    const go = async () => { try { const p = await PL.create($("#npName", bg).value); closeModal(); location.hash = "playlist-" + p.id; } catch(e){ toast(e.message, true); } };
    $("#npGo", bg).onclick = go; $("#npName", bg).addEventListener("keydown", e => { if (e.key === "Enter") go(); });
  };
  let lists;
  try { lists = await PL.list(); } catch(e){ $("#plBody").innerHTML = `<div class="notice err">${esc(e.message)}</div>`; return; }
  if (!$("#plBody")) return;
  const local = PL.localAll();
  $("#plNotice").innerHTML = !ME.user ? `<div class="notice">You're signed out, so playlists are saved in this browser only. <a class="link" href="#login">Sign in</a> to keep them in your account.</div>`
    : PL.dbMissing ? `<div class="notice">The playlists table isn't installed yet, so playlists are saved in this browser. An admin needs to run <code>supabase/migration.sql</code>.</div>`
    : local.length ? `<div class="notice">You have ${local.length} playlist${local.length === 1 ? "" : "s"} saved in this browser. <button class="btn sm" id="plMigrate" type="button">Move them to my account</button></div>` : "";
  const mg = $("#plMigrate");
  if (mg) mg.onclick = async () => { try { for (const p of local) await PL.create(p.name, p.songs || []); PL.localSave([]); toast("Playlists moved to your account"); render({keepScroll:true}); } catch(e){ toast(e.message, true); } };
  $("#plBody").innerHTML = lists.length ? `<div class="grid">${lists.map(p => { const songs = (p.songs || []).filter(id => DB.songById[id]);
      return `<a class="lvcard" href="#playlist-${esc(p.id)}"><div class="lv-top"><span class="pill">${songs.length} song${songs.length === 1 ? "" : "s"}</span>${p.is_public ? '<span class="badge approved">Public</span>' : ""}</div><h3>${esc(p.name)}</h3><p class="muted small">${songs.slice(0, 3).map(id => esc(DB.songById[id].name)).join(" · ") || "Empty"}</p></a>`; }).join("")}</div>`
    : `<div class="table">${emptyState("No playlists yet", "Create one, or add songs from any song page.")}</div>`;
}
function viewPlaylist(){ return `<div id="plDetail">${skeleton(4)}</div>`; }
async function mountPlaylist(id){
  let p;
  try { p = await PL.get(id); } catch(e){ $("#plDetail").innerHTML = `<div class="notice err">${esc(e.message)}</div>`; return; }
  const box = $("#plDetail"); if (!box) return;
  if (!p){ box.innerHTML = `<div class="table">${emptyState("Playlist not found", "It may have been deleted or is private.")}</div>`; return; }
  const own = String(p.id).startsWith("local-") || (ME.user && p.user_id === ME.user.id);
  const draw = () => {
    const songs = (p.songs || []).map(sid => DB.songById[sid]).filter(Boolean), missing = (p.songs || []).length - songs.length;
    const totalLen = songs.reduce((a, s) => a + (parseLen(s.length) || 0), 0);
    box.innerHTML = `<a class="back" href="#playlists">${ICON.back} Playlists</a>
      <section class="page-head"><div><div class="badges"><span class="pill">${songs.length} song${songs.length === 1 ? "" : "s"}</span>${totalLen ? `<span class="pill mono">${mmss(totalLen)}</span>` : ""}${String(p.id).startsWith("local-") ? '<span class="pill">This browser</span>' : p.is_public ? '<span class="badge approved">Public</span>' : '<span class="pill">Private</span>'}</div>
        <h1>${esc(p.name)}</h1>
        <div class="btns" style="margin-top:14px">
          <button class="btn primary" id="pdPlay" type="button">${ICON.play} Play</button><button class="btn" id="pdShuffle" type="button">${ICON.shuffle} Shuffle</button>
          <button class="btn" id="pdExport" type="button">Export</button><button class="btn" id="pdCopy" type="button">${ICON.copy} Copy IDs</button>
          ${own ? `<button class="btn" id="pdRename" type="button">Rename</button>${!String(p.id).startsWith("local-") ? `<button class="btn" id="pdPublic" type="button">${p.is_public ? "Make private" : "Make public"}</button>` : ""}<button class="btn danger" id="pdDelete" type="button">Delete</button>` : ""}
        </div>${p.is_public && !String(p.id).startsWith("local-") ? `<p class="small muted" style="margin:10px 0 0">Anyone with the link can view: <span class="mono">${esc(location.origin + location.pathname)}#playlist-${esc(p.id)}</span></p>` : ""}</div></section>
      ${missing ? `<div class="notice" style="margin-top:16px">${missing} song${missing === 1 ? " is" : "s are"} no longer on GDSR and ${missing === 1 ? "was" : "were"} hidden.</div>` : ""}
      <section class="section"><div class="table" id="pdList">${songs.length ? songs.map((s, i) => `<div class="row" data-song="${s.id}" style="grid-template-columns:30px 38px minmax(0,1fr) auto ${own ? "auto" : ""}">
          <span class="rank">${i + 1}</span>${playBtn(s)}
          <span class="ttl"><a class="t" href="#song-${s.id}">${esc(s.name)}</a><span class="sub">${esc(s.author || "")} · ${esc(TYPE_LABEL[s.type] || "")} · ${esc(lenText(s.length))}</span></span>
          <span class="score" style="grid-template-columns:auto"><span class="num" style="color:${scoreColor(overall(s))}">${fmt(overall(s))}</span></span>
          ${own ? `<span class="btns" style="position:relative;z-index:1;flex-wrap:nowrap"><button class="ib" data-mv="${i}" data-dir="-1" type="button" aria-label="Move up" ${i === 0 ? "disabled" : ""}>${ICON.up}</button><button class="ib" data-mv="${i}" data-dir="1" type="button" aria-label="Move down" ${i === songs.length - 1 ? "disabled" : ""}>${ICON.down}</button><button class="ib" data-rm="${s.id}" type="button" aria-label="Remove from playlist">${ICON.x}</button></span>` : ""}
        </div>`).join("") : emptyState("This playlist is empty", "Open any song and press “Add to playlist”.")}</div></section>`;
    const ids = songs.map(s => s.id);
    bindPlayButtons(box, ids);
    $("#pdPlay").onclick = () => { const was = P.shuffle; P.shuffle = false; P.playList(ids, 0, p.name); P.shuffle = was; };
    $("#pdShuffle").onclick = () => P.playList(shuffleArr(ids), 0, p.name);
    $("#pdExport").onclick = () => exportPlaylist(p);
    $("#pdCopy").onclick = () => copyText((p.songs || []).join("\n"), "Song IDs copied");
    if (own){
      const save = async patch => { try { p = await PL.update(p.id, patch); draw(); } catch(e){ toast(e.message, true); } };
      $("#pdRename").onclick = () => { const bg = openModal({title:"Rename playlist", body:`<div class="form"><label class="f">Name<input class="input" id="rnName" maxlength="80" value="${esc(p.name)}"></label></div>`, foot:`<button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" id="rnGo" type="button">Save</button>`});
        $("#rnGo", bg).onclick = () => { const n = $("#rnName", bg).value.trim(); if (!n) return; closeModal(); save({name:n}); }; };
      const pub = $("#pdPublic"); if (pub) pub.onclick = () => save({is_public:!p.is_public});
      $("#pdDelete").onclick = async () => { if (await confirmBox(`Delete “${esc(p.name)}”? This can't be undone.`, {ok:"Delete", danger:true})){ try { await PL.remove(p.id); toast("Playlist deleted"); location.hash = "playlists"; } catch(e){ toast(e.message, true); } } };
      $$("[data-mv]", box).forEach(b => b.onclick = () => { const i = +b.dataset.mv, j = i + +b.dataset.dir, arr = ids.slice(); [arr[i], arr[j]] = [arr[j], arr[i]]; save({songs:arr}); });
      $$("[data-rm]", box).forEach(b => b.onclick = () => save({songs:(p.songs || []).filter(x => x !== b.dataset.rm)}));
    }
  };
  draw();
}

/* =====================================================================
   ADMIN PANEL
   ===================================================================== */
const ADMIN_TABLES = {
  levels:{table:"levels", title:"Levels", pk:"id", order:"created_at", fields:LEVEL_FIELDS,
    cols:["name","level_id","creators","verifier","difficulty","stars","length","song_id"], link:r => `#level-${r.id}`},
  songs:{table:"songs", title:"Songs", pk:"id", order:"created_at",
    fields:[...SONG_FIELDS, {k:"rating", label:"Rating (0–100)", type:"numeric", min:0, max:100, hint:"Used when there are no votes yet", showIf:v => v.type !== "mashup"},
      {k:"mashing_quality", label:"Mashing quality (0–100)", type:"numeric", min:0, max:100, hint:"Used when there are no votes yet", showIf:v => v.type === "mashup"}],
    cols:["name","type","author","song_id","length","rating","mashing_quality","audio_file"], link:r => `#song-${r.id}`},
  "song-ids":{table:"song_ids", title:"Song IDs", pk:"song_id", order:"song_id", fields:[{k:"song_id", label:"Song ID", type:"int", req:true, min:1}], cols:["song_id"], noEdit:true},
  votes:{table:"votes", title:"Votes", pk:"id", order:"created_at", needsUsers:true,
    fields:[{k:"user_id", label:"User", type:"user", req:true},{k:"song", label:"Song", type:"song"},{k:"score", label:"Score", type:"numeric", min:0, max:100, req:true}],
    cols:["user_id","song","score","created_at"]},
  favourites:{table:"favourite_parts", title:"Favourite parts", pk:"id", order:"created_at", needsUsers:true,
    fields:[{k:"user_id", label:"User", type:"user", req:true},{k:"song", label:"Song", type:"song"},{k:"time", label:"Time (seconds)", type:"int", min:0, req:true}],
    cols:["user_id","song","time","created_at"]},
  playlists:{table:"playlists", title:"Playlists", pk:"id", order:"created_at", needsUsers:true,
    fields:[{k:"name", label:"Name", type:"text", req:true},{k:"user_id", label:"Owner", type:"user", req:true},{k:"songs", label:"Song IDs (one per line)", type:"uuidlist"},{k:"is_public", label:"Public", type:"bool"}],
    cols:["name","user_id","songs","is_public","created_at"]}
};
const ADMIN_NAV = [
  ["Review", [["overview","Overview"],["level-requests","Level requests"],["song-requests","Song requests"]]],
  ["Catalogue", [["levels","Levels"],["songs","Songs"],["song-ids","Song IDs"],["storage","Audio files"]]],
  ["Community", [["users","Users & roles"],["votes","Votes"],["favourites","Favourite parts"],["playlists","Playlists"]]]
];
const ADM = { users:null, pending:{level:0, song:0} };
async function admUsers(force){
  if (ADM.users && !force) return ADM.users;
  const [p, r] = await Promise.all([run(sb.from("profiles").select("*").order("created_at", {ascending:false})), run(sb.from("user_roles").select("*"))]);
  const roles = {}; (r.data || []).forEach(x => (roles[x.user_id] = roles[x.user_id] || []).push(x));
  ADM.users = (p.data || []).map(u => ({...u, roles:roles[u.id] || []}));
  return ADM.users;
}
const userName = id => { const u = (ADM.users || []).find(x => x.id === id); return u ? (u.username || u.email) : (id ? String(id).slice(0, 8) + "…" : "—"); };
async function admPendingCounts(){
  const c = async t => { try { const r = await sb.from(t).select("id", {count:"exact", head:true}).eq("status", "pending"); return r.count || 0; } catch(_){ return 0; } };
  const [l, s] = await Promise.all([c("level_requests"), c("song_requests")]);
  ADM.pending = {level:l, song:s};
  const a = $('.side a[href="#admin-level-requests"] .cnt'), b = $('.side a[href="#admin-song-requests"] .cnt');
  if (a){ a.textContent = l; a.hidden = !l; } if (b){ b.textContent = s; b.hidden = !s; }
}
function viewAdmin(section){
  if (!ME.user) return requireLogin("use the admin panel");
  if (!ME.isAdmin) return `<div class="card card-pad" style="max-width:520px;margin:30px auto;text-align:center"><h2>Admins only</h2><p class="muted">Your account doesn't have the admin role.</p><a class="btn" href="#list">Back to The List</a></div>`;
  return `<div class="admin">
    <nav class="side" aria-label="Admin sections">${ADMIN_NAV.map(([h, items]) => `<h4>${h}</h4>${items.map(([k, l]) => `<a href="#admin-${k}" class="${section === k ? "active" : ""}">${l}${k.endsWith("requests") ? `<span class="cnt" hidden>0</span>` : ""}</a>`).join("")}`).join("")}</nav>
    <div id="admMain">${skeleton(5)}</div></div>`;
}
async function mountAdmin(section){
  if (!ME.isAdmin) return;
  admPendingCounts();
  const main = $("#admMain");
  try {
    if (section === "overview") await admOverview(main);
    else if (section === "level-requests") await admRequests(main, "level");
    else if (section === "song-requests") await admRequests(main, "song");
    else if (section === "users") await admUsersView(main);
    else if (section === "storage") await admStorage(main);
    else if (ADMIN_TABLES[section]) await admTable(main, section);
    else main.innerHTML = `<div class="table">${emptyState("Unknown section")}</div>`;
  } catch(e){ main.innerHTML = `<div class="notice err"><b>Couldn't load this section.</b> ${esc(e.message)}${missingRelation(e) ? " Run <code>supabase/migration.sql</code> to install it." : ""}</div>`; }
}
async function admOverview(main){
  const count = async t => { try { const r = await sb.from(t).select("*", {count:"exact", head:true}); return r.error ? "—" : r.count; } catch(_){ return "—"; } };
  const tables = [["levels","Levels","levels"],["songs","Songs","songs"],["song_ids","Song IDs","song-ids"],["profiles","Users","users"],["votes","Votes","votes"],["favourite_parts","Favourite picks","favourites"],["playlists","Playlists","playlists"]];
  const counts = await Promise.all(tables.map(t => count(t[0])));
  await admPendingCounts();
  const top = ranked().filter(s => overall(s) !== null).slice(0, 5);
  const noAudio = DB.songs.filter(s => !s.audio_file).length, noVideo = DB.songs.filter(s => !s.video).length;
  const orphanIds = DB.songIds.filter(x => !DB.songs.some(s => +s.song_id === +x.song_id) && !DB.levels.some(l => +l.song_id === +x.song_id)).length;
  main.innerHTML = `<div class="section-head" style="margin-top:0"><div><h1 style="font-size:28px">Admin overview</h1><p class="muted">Signed in as ${esc(myName())}</p></div><button class="btn" id="admReload" type="button">Reload data</button></div>
    <div class="stats" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
      <a class="stat" href="#admin-level-requests" style="border-color:${ADM.pending.level ? "rgba(242,210,114,.4)" : ""}"><b style="color:${ADM.pending.level ? "#f2d272" : ""}">${ADM.pending.level}</b><span>Pending level requests</span></a>
      <a class="stat" href="#admin-song-requests" style="border-color:${ADM.pending.song ? "rgba(242,210,114,.4)" : ""}"><b style="color:${ADM.pending.song ? "#f2d272" : ""}">${ADM.pending.song}</b><span>Pending song requests</span></a>
      ${tables.map((t, i) => `<a class="stat" href="#admin-${t[2]}"><b>${counts[i] === "—" ? "—" : num(counts[i])}</b><span>${t[1]}</span></a>`).join("")}
    </div>
    <div class="song-grid" style="grid-template-columns:1fr 1fr">
      <section class="card card-pad"><h3>Top songs</h3>${top.length ? `<ul class="mini-list">${top.map(s => `<li><a href="#song-${s.id}"><span class="grow"><span class="nm">${esc(s.name)}</span><span class="sb">${esc(s.author || "")} · ${num(voteCount(s))} vote${voteCount(s) === 1 ? "" : "s"}</span></span><b class="mono" style="color:${scoreColor(overall(s))}">${fmt(overall(s))}</b></a></li>`).join("")}</ul>` : `<p class="muted small">No rated songs yet.</p>`}</section>
      <section class="card card-pad"><h3>Data health</h3><ul class="mini-list">
        <li><a href="#admin-songs"><span class="grow"><span class="nm">Songs without audio</span></span><b class="mono">${noAudio}</b></a></li>
        <li><a href="#admin-songs"><span class="grow"><span class="nm">Songs without video</span></span><b class="mono">${noVideo}</b></a></li>
        <li><a href="#admin-song-ids"><span class="grow"><span class="nm">Unused song IDs</span></span><b class="mono">${orphanIds}</b></a></li>
        <li><div class="mi"><span class="grow"><span class="nm">Vote stats source</span><span class="sb">${DB.statsSource === "view" ? "Live from votes" : "Stored rating columns (migration not run)"}</span></span></div></li>
      </ul></section></div>`;
  $("#admReload").onclick = async () => { await loadData(); toast("Data reloaded"); render({keepScroll:true}); };
}

/* ---------- requests review ---------- */
async function admRequests(main, kind){
  const table = kind === "song" ? "song_requests" : "level_requests", fields = kind === "song" ? SONG_FIELDS : LEVEL_FIELDS;
  await admUsers();
  const r = await run(sb.from(table).select("*").eq("status", state.reqStatus).order("created_at", {ascending:state.reqStatus === "pending"}).limit(200));
  const rows = r.data || [];
  const val = (f, v) => {
    if (v === null || v === undefined || v === "") return '<span class="faint">—</span>';
    if (f.type === "song") return DB.songById[v] ? `<a class="link" href="#song-${v}">${esc(DB.songById[v].name)}</a>` : `<span class="mono">${esc(v)}</span>`;
    if (f.type === "audio") return `<audio controls preload="none" src="${esc(audioUrl(v))}" style="height:32px;max-width:100%"></audio>`;
    if (f.type === "url") return `<a class="link" href="${esc(v)}" target="_blank" rel="noopener">${esc(v)}</a>`;
    if (f.type === "enum" && f.labels) return esc(f.labels[v] || v);
    return esc(v);
  };
  main.innerHTML = `<div class="section-head" style="margin-top:0"><div><h1 style="font-size:28px">${kind === "song" ? "Song" : "Level"} requests</h1><p class="muted">Approving adds the ${kind} to the catalogue.</p></div></div>
    ${chips("reqTabs", [["pending","Pending"],["approved","Approved"],["rejected","Rejected"]].map(([v, l]) => ({v, label:l})), state.reqStatus, "Request status")}
    <div style="display:grid;gap:14px;margin-top:14px">${rows.length ? rows.map(q => {
      const dupe = kind === "level" ? DB.levels.find(l => +l.level_id === +q.level_id) : DB.songs.find(s => s.name.toLowerCase() === String(q.name || "").toLowerCase() && +s.song_id === +q.song_id);
      return `<section class="card req-card" data-req="${q.id}">
        <div class="req-top"><div><h3 style="font-size:17px">${esc(q.name || "Untitled")}</h3><p class="muted small" style="margin:2px 0 0">by ${esc(userName(q.user_id))} · ${dateFmt(q.created_at)}${q.reviewed_by ? ` · reviewed by ${esc(userName(q.reviewed_by))}` : ""}</p></div>${statusBadge(q.status)}</div>
        ${dupe ? `<div class="notice" style="margin:0">Possible duplicate of <a class="link" href="#${kind === "level" ? "level" : "song"}-${dupe.id}">${esc(dupe.name)}</a>.</div>` : ""}
        <div class="kv">${fields.filter(f => kind !== "song" || !f.showIf || f.showIf(q)).map(f => `<div><small>${esc(f.label)}</small><span>${val(f, q[f.k])}</span></div>`).join("")}</div>
        ${q.admin_note && q.status !== "pending" ? `<p class="small muted" style="margin:0">Note: ${esc(q.admin_note)}</p>` : ""}
        ${q.status === "pending" ? `<div class="form" style="gap:10px"><textarea class="textarea" data-note rows="2" placeholder="Note to the requester (optional, shown on their account page)" style="min-height:60px"></textarea>
          <div class="btns"><button class="btn primary sm" data-approve type="button">Approve</button><button class="btn danger sm" data-reject type="button">Reject</button><button class="btn sm" data-edit type="button">Edit first</button><button class="btn ghost sm" data-del type="button">Delete</button></div></div>`
          : `<div class="btns"><button class="btn ghost sm" data-del type="button">Delete request</button></div>`}
      </section>`; }).join("") : `<div class="table">${emptyState(`No ${state.reqStatus} ${kind} requests`)}</div>`}</div>`;
  bindChips($("#reqTabs"), v => { state.reqStatus = v; admRequests(main, kind); });
  $$("[data-req]", main).forEach(card => {
    const id = card.dataset.req, q = rows.find(x => x.id === id), note = () => ($("[data-note]", card) || {}).value || null;
    const review = async approve => {
      if (!approve && !(await confirmBox(`Reject “${esc(q.name || "this request")}”?`, {ok:"Reject", danger:true}))) return;
      $$("button", card).forEach(b => b.disabled = true);
      try {
        if (approve && q.song_id) await sb.from("song_ids").upsert({song_id:q.song_id}, {onConflict:"song_id", ignoreDuplicates:true});
        await run(sb.rpc(kind === "song" ? "review_song_request" : "review_level_request", {_id:id, _approve:approve, _note:note()}));
        toast(approve ? "Approved and added" : "Rejected");
        if (approve) await loadData();
        admRequests(main, kind); admPendingCounts();
      } catch(e){ toast(e.message, true); $$("button", card).forEach(b => b.disabled = false); }
    };
    const ap = $("[data-approve]", card), rj = $("[data-reject]", card), ed = $("[data-edit]", card), dl = $("[data-del]", card);
    if (ap) ap.onclick = () => review(true);
    if (rj) rj.onclick = () => review(false);
    if (ed) ed.onclick = () => admEditForm({title:`Edit ${kind} request`, fields, row:q, onSave:async data => { await run(sb.from(table).update(data).eq("id", id)); toast("Request updated"); admRequests(main, kind); }, folder:"songs"});
    if (dl) dl.onclick = async () => { if (await confirmBox("Delete this request permanently?", {ok:"Delete", danger:true})){ try { await run(sb.from(table).delete().eq("id", id)); toast("Request deleted"); admRequests(main, kind); admPendingCounts(); } catch(e){ toast(e.message, true); } } };
  });
}

/* ---------- generic edit form ---------- */
function admEditForm({title, fields, row, onSave, folder = "songs", users}){
  const isNew = !row;
  const bg = openModal({title, wide:true,
    body:`<form class="form" id="admForm" novalidate><div class="row2" style="align-items:start">${fields.map(f => fieldHtml(f, row ? row[f.k] : (f.type === "enum" && f.k === "type" ? "original" : undefined), {admin:true, users, selfId:row && row.id})).join("")}</div><p class="msg" id="admMsg" hidden></p></form>`,
    foot:`<button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" id="admSave" type="button">${isNew ? "Add" : "Save changes"}</button>`});
  const form = $("#admForm", bg), msg = $("#admMsg", bg);
  applyShowIf(form, fields); form.addEventListener("change", () => applyShowIf(form, fields));
  bindAudioUpload(form, fields, folder);
  const save = async () => {
    if (form.dataset.uploading){ toast("Wait for the audio upload to finish.", true); return; }
    msg.hidden = true; const btn = $("#admSave", bg); btn.disabled = true;
    try {
      const data = readForm(form, fields);
      if (data.type === "mashup" && data.song_a && data.song_a === data.song_b) throw new Error("Song A and Song B must be different songs.");
      await onSave(data); closeModal();
    } catch(e){ msg.hidden = false; msg.textContent = e.message; btn.disabled = false; }
  };
  $("#admSave", bg).onclick = save;
  form.addEventListener("submit", e => { e.preventDefault(); save(); });
}

/* ---------- generic table manager ---------- */
async function admTable(main, key){
  const cfg = ADMIN_TABLES[key];
  const st = state.admin[key] = state.admin[key] || {q:"", sort:cfg.order, dir:cfg.order === "song_id" ? "asc" : "desc", page:0};
  if (cfg.needsUsers) await admUsers();
  const r = await run(sb.from(cfg.table).select("*").order(cfg.order, {ascending:cfg.order === "song_id"}).limit(10000));
  let rows = r.data || [];
  const PER = 25;
  const show = (c, v) => {
    if (v === null || v === undefined || v === "") return '<span class="faint">—</span>';
    if (c === "user_id") return esc(userName(v));
    if (c === "song" || c === "song_a" || c === "song_b") return DB.songById[v] ? esc(DB.songById[v].name) : `<span class="mono faint">${esc(String(v).slice(0, 8))}…</span>`;
    if (c === "songs") return `${(v || []).length} songs`;
    if (c === "is_public") return v ? "Yes" : "No";
    if (c === "created_at") return dateFmt(v);
    if (c === "type") return typeBadge(v);
    if (c === "difficulty") return diffBadge(v);
    if (c === "audio_file") return `<span title="${esc(v)}">✓ ${esc(String(v).split("/").pop())}</span>`;
    return esc(Array.isArray(v) ? v.join(", ") : v);
  };
  const hay = row => cfg.cols.map(c => c === "user_id" ? userName(row[c]) : (c === "song" ? (DB.songById[row[c]] || {}).name : row[c])).join(" ");
  const draw = () => {
    const filtered = rows.filter(x => matches(hay(x), st.q)).sort((a, b) => {
      let x = a[st.sort], y = b[st.sort];
      if (st.sort === "user_id"){ x = userName(x); y = userName(y); }
      if (st.sort === "song"){ x = (DB.songById[x] || {}).name; y = (DB.songById[y] || {}).name; }
      if (x === y) return 0; if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, {numeric:true});
      return st.dir === "asc" ? c : -c;
    });
    const pages = Math.max(1, Math.ceil(filtered.length / PER)); st.page = Math.min(st.page, pages - 1);
    const pageRows = filtered.slice(st.page * PER, st.page * PER + PER);
    main.innerHTML = `<div class="section-head" style="margin-top:0"><div><h1 style="font-size:28px">${esc(cfg.title)}</h1><p class="muted">${num(rows.length)} record${rows.length === 1 ? "" : "s"} in <span class="mono">${esc(cfg.table)}</span></p></div>
        <div class="btns"><button class="btn primary" id="atAdd" type="button">${ICON.plus} Add</button><button class="btn" id="atExport" type="button">Export CSV</button><label class="btn" style="cursor:pointer">Import CSV<input type="file" id="atImport" accept=".csv,text/csv" hidden></label></div></div>
      <div class="toolbar"><label class="field" style="flex:1 1 300px"><span class="sr-only">Search</span>${ICON.search}<input id="atQ" type="search" placeholder="Search ${esc(cfg.title.toLowerCase())}…" value="${esc(st.q)}" autocomplete="off"></label></div>
      <div class="atable-wrap"><table class="atable"><thead><tr>${cfg.cols.map(c => `<th data-sort="${c}">${esc(c.replace(/_/g, " "))} ${st.sort === c ? `<span class="ar">${st.dir === "asc" ? "↑" : "↓"}</span>` : ""}</th>`).join("")}<th class="nosort"></th></tr></thead>
        <tbody>${pageRows.map(x => `<tr data-pk="${esc(x[cfg.pk])}">${cfg.cols.map(c => `<td>${show(c, x[c])}</td>`).join("")}<td class="act"><span class="btns" style="flex-wrap:nowrap;justify-content:flex-end">${cfg.link ? `<a class="btn sm ghost" href="${cfg.link(x)}">View</a>` : ""}${cfg.noEdit ? "" : `<button class="btn sm" data-ed type="button">Edit</button>`}<button class="btn sm danger" data-dl type="button">Delete</button></span></td></tr>`).join("") || `<tr><td colspan="${cfg.cols.length + 1}">${emptyState(rows.length ? "No matches" : "No records yet")}</td></tr>`}</tbody></table></div>
      <div class="pager"><span>Showing ${filtered.length ? st.page * PER + 1 : 0}–${Math.min(filtered.length, st.page * PER + PER)} of ${num(filtered.length)}</span><span class="btns"><button class="btn sm" id="pgPrev" type="button" ${st.page === 0 ? "disabled" : ""}>Previous</button><button class="btn sm" id="pgNext" type="button" ${st.page >= pages - 1 ? "disabled" : ""}>Next</button></span></div>`;
    const qi = $("#atQ"); qi.addEventListener("input", () => { st.q = qi.value; st.page = 0; const pos = qi.selectionStart; draw(); const n = $("#atQ"); n.focus(); n.setSelectionRange(pos, pos); });
    $$("th[data-sort]", main).forEach(th => th.onclick = () => { const c = th.dataset.sort; st.dir = st.sort === c && st.dir === "asc" ? "desc" : "asc"; st.sort = c; draw(); });
    $("#pgPrev").onclick = () => { st.page--; draw(); }; $("#pgNext").onclick = () => { st.page++; draw(); };
    $("#atExport").onclick = () => download(`${cfg.table}-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(filtered, Object.keys(rows[0] || Object.fromEntries(cfg.cols.map(c => [c, 1])))), "text/csv");
    $("#atImport").onchange = e => importCSV(e.target.files[0], cfg, reload);
    $("#atAdd").onclick = () => admEditForm({title:`Add to ${cfg.title}`, fields:cfg.fields, users:ADM.users, onSave:async data => { await ensureSongId(data, cfg.table); await run(sb.from(cfg.table).insert(data)); toast("Added"); await reload(); }});
    $$("tr[data-pk]", main).forEach(tr => {
      const row = rows.find(x => String(x[cfg.pk]) === tr.dataset.pk);
      const ed = $("[data-ed]", tr);
      if (ed) ed.onclick = () => admEditForm({title:`Edit ${cfg.title.replace(/s$/, "").toLowerCase()}`, fields:cfg.fields, row, users:ADM.users, onSave:async data => { await ensureSongId(data, cfg.table); await run(sb.from(cfg.table).update(data).eq(cfg.pk, row[cfg.pk])); toast("Saved"); await reload(); }});
      $("[data-dl]", tr).onclick = async () => {
        const label = row.name || row.song_id || "this record";
        if (!(await confirmBox(`Delete <b>${esc(label)}</b> from ${esc(cfg.title)}? This can't be undone.`, {ok:"Delete", danger:true}))) return;
        try { await run(sb.from(cfg.table).delete().eq(cfg.pk, row[cfg.pk])); toast("Deleted"); await reload(); }
        catch(e){ toast(/foreign key|violates/i.test(e.message) ? "Can't delete: other records still use this one." : e.message, true); }
      };
    });
  };
  const reload = async () => {
    const r2 = await run(sb.from(cfg.table).select("*").order(cfg.order, {ascending:cfg.order === "song_id"}).limit(10000));
    rows = r2.data || [];
    if (["levels","songs","song_ids"].includes(cfg.table)) await loadData();
    draw();
  };
  draw();
}
async function ensureSongId(data, table){
  if (table === "song_ids") return;
  if (data && data.song_id) await sb.from("song_ids").upsert({song_id:data.song_id}, {onConflict:"song_id", ignoreDuplicates:true});
}
async function importCSV(file, cfg, after){
  if (!file) return;
  let rows;
  try { rows = parseCSV(await readFile(file)); } catch(e){ toast("Couldn't read that file.", true); return; }
  if (!rows.length){ toast("The file has no rows.", true); return; }
  const allowed = new Set([cfg.pk, ...cfg.fields.map(f => f.k)]);
  const ftype = Object.fromEntries(cfg.fields.map(f => [f.k, f.type]));
  const clean = rows.map(r => { const o = {}; for (const [k, v] of Object.entries(r)){ if (!allowed.has(k)) continue;
      if (v === ""){ o[k] = null; continue; }
      const t = ftype[k];
      if (t === "int" || t === "songid") o[k] = parseInt(v, 10);
      else if (t === "numeric") o[k] = +v;
      else if (t === "bool") o[k] = /^(true|1|yes)$/i.test(v);
      else if (t === "uuidlist"){ try { o[k] = JSON.parse(v); } catch(_){ o[k] = v.split(/[\s,;]+/).filter(Boolean); } }
      else o[k] = v; }
    if (o[cfg.pk] === null) delete o[cfg.pk];
    return o; });
  const ignored = Object.keys(rows[0]).filter(k => !allowed.has(k));
  if (!(await confirmBox(`Import <b>${clean.length}</b> rows into ${esc(cfg.title)}? Rows with an existing <span class="mono">${esc(cfg.pk)}</span> will be updated.${ignored.length ? `<br><span class="small muted">Ignored columns: ${esc(ignored.join(", "))}</span>` : ""}`, {ok:"Import"}))) return;
  try {
    const ids = [...new Set(clean.map(r => r.song_id).filter(Boolean))];
    if (ids.length && cfg.table !== "song_ids") await sb.from("song_ids").upsert(ids.map(song_id => ({song_id})), {onConflict:"song_id", ignoreDuplicates:true});
    for (let i = 0; i < clean.length; i += 200) await run(sb.from(cfg.table).upsert(clean.slice(i, i + 200), {onConflict:cfg.pk}));
    toast(`Imported ${clean.length} rows`); await after();
  } catch(e){ toast("Import failed: " + e.message, true); }
}

/* ---------- users & roles ---------- */
async function admUsersView(main){
  const users = await admUsers(true);
  const st = state.admin.users = state.admin.users || {q:""};
  const draw = () => {
    const list = users.filter(u => matches([u.username, u.email, u.id].join(" "), st.q));
    main.innerHTML = `<div class="section-head" style="margin-top:0"><div><h1 style="font-size:28px">Users &amp; roles</h1><p class="muted">${users.length} accounts · ${users.filter(u => u.roles.some(r => r.role === "admin")).length} admins</p></div><button class="btn" id="uExport" type="button">Export CSV</button></div>
      <div class="toolbar"><label class="field" style="flex:1 1 300px">${ICON.search}<input id="uQ" type="search" placeholder="Search by username or email…" value="${esc(st.q)}"></label></div>
      <div class="atable-wrap"><table class="atable"><thead><tr><th class="nosort">Username</th><th class="nosort">Email</th><th class="nosort">Joined</th><th class="nosort">Role</th><th class="nosort"></th></tr></thead><tbody>
      ${list.map(u => { const admin = u.roles.some(r => r.role === "admin"), self = u.id === ME.user.id;
        return `<tr data-u="${u.id}"><td><b>${esc(u.username || "—")}</b>${self ? ' <span class="faint small">(you)</span>' : ""}</td><td>${esc(u.email || "—")}</td><td>${dateFmt(u.created_at)}</td><td>${admin ? '<span class="badge admin">Admin</span>' : '<span class="badge">User</span>'}</td>
          <td class="act"><span class="btns" style="flex-wrap:nowrap;justify-content:flex-end"><button class="btn sm" data-act="activity" type="button">Activity</button><button class="btn sm" data-act="rename" type="button">Rename</button>${admin ? `<button class="btn sm danger" data-act="demote" type="button" ${self ? 'title="You can\'t remove your own admin role"' : ""} ${self ? "disabled" : ""}>Remove admin</button>` : `<button class="btn sm primary" data-act="promote" type="button">Make admin</button>`}</span></td></tr>`; }).join("") || `<tr><td colspan="5">${emptyState("No users found")}</td></tr>`}
      </tbody></table></div><p class="small muted" style="margin-top:10px">To delete an account entirely, remove it from Authentication in the Lovable Cloud / Supabase dashboard.</p>`;
    const qi = $("#uQ"); qi.addEventListener("input", () => { st.q = qi.value; const p = qi.selectionStart; draw(); const n = $("#uQ"); n.focus(); n.setSelectionRange(p, p); });
    $("#uExport").onclick = () => download(`users-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(users.map(u => ({...u, role:u.roles.map(r => r.role).join("|") || "user"})), ["id","username","email","role","created_at"]), "text/csv");
    $$("tr[data-u]", main).forEach(tr => { const u = users.find(x => x.id === tr.dataset.u);
      $$("[data-act]", tr).forEach(b => b.onclick = async () => {
        const act = b.dataset.act;
        try {
          if (act === "promote"){ if (!(await confirmBox(`Give <b>${esc(u.username || u.email)}</b> full admin access?`, {ok:"Make admin"}))) return;
            await run(sb.from("user_roles").insert({user_id:u.id, role:"admin"})); toast("Admin role granted"); }
          else if (act === "demote"){ if (!(await confirmBox(`Remove admin access from <b>${esc(u.username || u.email)}</b>?`, {ok:"Remove admin", danger:true}))) return;
            await run(sb.from("user_roles").delete().eq("user_id", u.id).eq("role", "admin")); toast("Admin role removed"); }
          else if (act === "rename"){ admEditForm({title:"Rename user", fields:[{k:"username", label:"Username", type:"text", req:true}], row:u, onSave:async d => { await run(sb.from("profiles").update(d).eq("id", u.id)); toast("Renamed"); admUsersView(main); }}); return; }
          else if (act === "activity"){ await userActivity(u); return; }
          admUsersView(main);
        } catch(e){ toast(e.message, true); }
      }); });
  };
  draw();
}
async function userActivity(u){
  const [v, lr, sr] = await Promise.allSettled([
    run(sb.from("votes").select("*").eq("user_id", u.id).order("created_at", {ascending:false})),
    run(sb.from("level_requests").select("id,name,status,created_at").eq("user_id", u.id)),
    run(sb.from("song_requests").select("id,name,status,created_at").eq("user_id", u.id))
  ]);
  const votes = v.value ? v.value.data : [], reqs = [...(lr.value ? lr.value.data : []), ...(sr.value ? sr.value.data : [])];
  const bg = openModal({title:`Activity · ${u.username || u.email}`, wide:true,
    body:`<h3>Votes (${votes.length})</h3>${votes.length ? `<ul class="mini-list">${votes.slice(0, 50).map(x => `<li><div class="mi"><span class="grow"><span class="nm">${esc((DB.songById[x.song] || {}).name || "Deleted song")}</span><span class="sb">${dateFmt(x.created_at)}</span></span><b class="mono">${Math.round(+x.score)}</b><button class="btn sm danger" data-dv="${x.id}" type="button">Delete</button></div></li>`).join("")}</ul>` : `<p class="muted small">No votes.</p>`}
      <h3 style="margin-top:18px">Requests (${reqs.length})</h3>${reqs.length ? `<ul class="mini-list">${reqs.map(x => `<li><div class="mi"><span class="grow"><span class="nm">${esc(x.name || "Untitled")}</span><span class="sb">${dateFmt(x.created_at)}</span></span>${statusBadge(x.status)}</div></li>`).join("")}</ul>` : `<p class="muted small">No requests.</p>`}`,
    foot:`${votes.length ? `<button class="btn danger" id="dvAll" type="button">Delete all votes</button>` : ""}<button class="btn" data-close type="button">Close</button>`});
  $$("[data-dv]", bg).forEach(b => b.onclick = async () => { try { await run(sb.from("votes").delete().eq("id", b.dataset.dv)); b.closest("li").remove(); await loadStats(); toast("Vote deleted"); } catch(e){ toast(e.message, true); } });
  const all = $("#dvAll", bg);
  if (all) all.onclick = async () => { closeModal(); if (await confirmBox(`Delete all ${votes.length} votes by <b>${esc(u.username || u.email)}</b>?`, {ok:"Delete all", danger:true})){ try { await run(sb.from("votes").delete().eq("user_id", u.id)); await loadStats(); toast("Votes deleted"); } catch(e){ toast(e.message, true); } } };
}

/* ---------- audio storage ---------- */
async function admStorage(main){
  const path = state.storagePath;
  let r; try { r = await run(sb.storage.from(CONFIG.AUDIO_BUCKET).list(path, {limit:1000, sortBy:{column:"name", order:"asc"}})); } catch(e){ throw new Error(storageError(e)); }
  const items = (r.data || []).filter(x => x.name !== ".emptyFolderPlaceholder");
  const folders = items.filter(x => !x.id), files = items.filter(x => x.id);
  const full = n => (path ? path + "/" : "") + n;
  const used = new Set(DB.songs.map(s => s.audio_file).filter(Boolean));
  const crumbs = ["audio", ...path.split("/").filter(Boolean)];
  main.innerHTML = `<div class="section-head" style="margin-top:0"><div><h1 style="font-size:28px">Audio files</h1><p class="muted">Bucket <span class="mono">${CONFIG.AUDIO_BUCKET}</span> · ${files.length} file${files.length === 1 ? "" : "s"} here</p></div>
      <label class="btn primary" style="cursor:pointer">${ICON.plus} Upload<input type="file" id="stUp" accept="audio/*" multiple hidden></label></div>
    <nav class="crumbs">${crumbs.map((c, i) => `<a href="#admin-storage" data-path="${esc(crumbs.slice(1, i + 1).join("/"))}">${esc(c)}</a>`).join("<span>/</span>")}</nav>
    <div class="card"><ul class="files">
      ${path ? `<li><a href="#admin-storage" data-path="${esc(path.split("/").slice(0, -1).join("/"))}" class="link">↑ Up one folder</a></li>` : ""}
      ${folders.map(f => `<li>📁 <a href="#admin-storage" class="fn link" data-path="${esc(full(f.name))}">${esc(f.name)}</a></li>`).join("")}
      ${files.map(f => { const p = full(f.name), song = DB.songs.find(s => s.audio_file === p);
        return `<li data-file="${esc(p)}"><span class="fn"><b>${esc(f.name)}</b><br><span class="small muted">${f.metadata && f.metadata.size ? (f.metadata.size / 1048576).toFixed(2) + " MB · " : ""}${song ? `used by <a class="link" href="#song-${song.id}">${esc(song.name)}</a>` : used.has(p) ? "in use" : '<span class="faint">not linked to a song</span>'}</span></span>
          <audio controls preload="none" src="${esc(audioUrl(p))}" style="height:32px;width:220px;max-width:40vw"></audio>
          <button class="btn sm" data-cp type="button">Copy path</button><button class="btn sm danger" data-rm type="button">Delete</button></li>`; }).join("")}
      ${!folders.length && !files.length ? `<li class="muted">This folder is empty.</li>` : ""}
    </ul></div>`;
  $$("[data-path]", main).forEach(a => a.onclick = e => { e.preventDefault(); state.storagePath = a.dataset.path; admStorage(main); });
  $$("[data-file]", main).forEach(li => {
    const p = li.dataset.file;
    $("[data-cp]", li).onclick = () => copyText(p, "Path copied");
    $("[data-rm]", li).onclick = async () => {
      const song = DB.songs.find(s => s.audio_file === p);
      if (!(await confirmBox(`Delete <span class="mono">${esc(p)}</span>?${song ? `<br><b>${esc(song.name)}</b> uses this file and will lose its audio.` : ""}`, {ok:"Delete", danger:true}))) return;
      try { await run(sb.storage.from(CONFIG.AUDIO_BUCKET).remove([p])); toast("File deleted"); admStorage(main); } catch(e){ toast(e.message, true); }
    };
  });
  $("#stUp").onchange = async e => {
    const filesIn = [...e.target.files]; if (!filesIn.length) return;
    let ok = 0;
    for (const f of filesIn){
      if (f.size > CONFIG.MAX_AUDIO_MB * 1024 * 1024){ toast(`${f.name} is over ${CONFIG.MAX_AUDIO_MB} MB`, true); continue; }
      try { await run(sb.storage.from(CONFIG.AUDIO_BUCKET).upload(full(`${Date.now()}-${safeName(f.name)}`), f, {contentType:f.type || "audio/mpeg"})); ok++; } catch(err){ toast(`${f.name}: ${storageError(err)}`, true); }
    }
    if (ok) toast(`Uploaded ${ok} file${ok === 1 ? "" : "s"}`);
    admStorage(main);
  };
}

/* =====================================================================
   ROUTER
   ===================================================================== */
function route(){
  const h = decodeURIComponent(location.hash.slice(1)); let m;
  if (!h || h === "list") return {name:"list"};
  if (["levels","search","login","signup","account","playlists","request","request-song"].includes(h)) return {name:h};
  if (h === "settings") return {name:"settings", id:""};
  if ((m = h.match(/^settings-([a-z]+)$/))) return {name:"settings", id:m[1]};
  if (h === "admin") return {name:"admin", id:"overview"};
  if ((m = h.match(/^admin-([a-z-]+)$/))) return {name:"admin", id:m[1]};
  if ((m = h.match(/^level-([\w-]+)$/))) return {name:"level", id:m[1]};
  if ((m = h.match(/^song-([\w-]+)$/))) return {name:"song", id:m[1]};
  if ((m = h.match(/^playlist-([\w-]+)$/))) return {name:"playlist", id:m[1]};
  if (/^(access_token|error)=/.test(h)) return {name:"list"};   // auth redirect fragments
  return {name:"404"};
}
const NEEDS_DATA = new Set(["list","levels","level","song","search","request","request-song","playlists","playlist","admin","account"]);
function render(opts = {}){
  const r = route(), y = window.scrollY;
  $$("[data-nav]").forEach(a => a.classList.toggle("active", a.dataset.nav === r.name || (r.name === "level" && a.dataset.nav === "levels") || (r.name === "playlist" && a.dataset.nav === "playlists") || (r.name === "request-song" && a.dataset.nav === "request")));
  if (r.name !== "search" && document.activeElement !== hq) hq.value = "";
  $("#queue").classList.remove("on"); toggleMenu(false);
  if (NEEDS_DATA.has(r.name) && !DB.loaded){ app.innerHTML = skeleton(8); return; }
  if (["account","request","request-song","admin","settings"].includes(r.name) && !ME.ready){ app.innerHTML = skeleton(4); return; }
  let title = "The List";
  switch (r.name){
    case "list": app.innerHTML = viewList(); mountList(); break;
    case "levels": title = "Levels"; app.innerHTML = viewLevels(); mountLevels(); break;
    case "search": title = "Search"; hq.value = state.searchQ; app.innerHTML = viewSearch(); mountSearch(); break;
    case "level": { const lv = DB.levelById[r.id]; if (!lv){ notFound(); title = "Not found"; break; } title = lv.name; app.innerHTML = viewLevel(lv); mountLevel(lv); break; }
    case "song": { const s = DB.songById[r.id]; if (!s){ notFound(); title = "Not found"; break; } title = s.name; app.innerHTML = viewSong(s); mountSong(s); break; }
    case "login": case "signup": title = r.name === "login" ? "Sign in" : "Create account"; app.innerHTML = viewAuth(r.name); mountAuth(r.name); break;
    case "account": title = "Profile"; app.innerHTML = viewAccount(); mountAccount(); break;
    case "settings": title = "Settings"; app.innerHTML = viewSettings(r.id); mountSettings(r.id); break;
    case "request": case "request-song": title = "Request"; { const k = r.name === "request-song" ? "song" : "level"; app.innerHTML = viewRequest(k); mountRequest(k); } break;
    case "playlists": title = "Playlists"; app.innerHTML = viewPlaylists(); mountPlaylists(); break;
    case "playlist": title = "Playlist"; app.innerHTML = viewPlaylist(); mountPlaylist(r.id); break;
    case "admin": title = "Admin"; app.innerHTML = viewAdmin(r.id); mountAdmin(r.id); break;
    default: notFound(); title = "Not found";
  }
  document.title = `${title} · GDSR`;
  if (opts.keepScroll) window.scrollTo(0, y); else window.scrollTo({top:0, behavior:"instant"});
}
function notFound(){ app.innerHTML = `<div class="table">${emptyState("Page not found", "That page doesn't exist or was removed.")}</div><p style="text-align:center;margin-top:16px"><a class="btn" href="#list">Back to The List</a></p>`; }
window.addEventListener("hashchange", () => render());

/* global search */
hq.addEventListener("input", () => { state.searchQ = hq.value; if (route().name === "search") renderSearch(); else if (hq.value.trim()) location.hash = "search"; });
$("#hsearch").addEventListener("submit", e => { e.preventDefault(); state.searchQ = hq.value; if (route().name !== "search") location.hash = "search"; else renderSearch(); hq.blur(); });
document.addEventListener("keydown", e => {
  if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$("#modalBg")){ e.preventDefault(); hq.focus(); }
});
let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { drawChart(); if (P.cur) document.documentElement.style.setProperty("--player-h", $("#player").offsetHeight + "px"); }, 120); });

/* =====================================================================
   BOOT
   ===================================================================== */
(async function boot(){
  applyPrefs();
  $("#acctBtn").addEventListener("click", e => { e.stopPropagation(); toggleMenu(); });
  document.addEventListener("click", e => { if (!e.target.closest(".menu-wrap")) toggleMenu(false); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#acctMenu").hidden){ toggleMenu(false); $("#acctBtn").focus(); } });
  $("#acctMenu").addEventListener("click", e => { if (e.target.closest("a")) toggleMenu(false); });
  renderHeader();
  render();
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "INITIAL_SESSION") return;
    setTimeout(async () => { await refreshMe(session); if (event === "SIGNED_IN" || event === "SIGNED_OUT") render({keepScroll:true}); }, 0);
  });
  const [{data:{session}}] = await Promise.all([sb.auth.getSession(), loadData()]);
  await refreshMe(session);
  render();
})();
