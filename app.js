/* =====================================================================
   GDSR · Geometry Dash Song Ratings
   Front-end for the Supabase (Lovable Cloud) database.
   ===================================================================== */
"use strict";

const CONFIG = {
  SUPABASE_URL: "https://c--d7a6c76f-dfcc-4caa-a390-36c8a5e7cafa-prod.lovable.cloud",
  SUPABASE_KEY: "sb_publishable_2Vl-Rwf1mxy8san0hTPeoQ_t5WUv1WV",   // publishable key: safe in front-end code; RLS protects data
  MOD_URL: "https://github.com/RicoHQ/gdsr-front/releases/download/geode-mod/ricohq.gdsr.geode",
  AUDIO_BUCKET: "audio",
  BUCKET: 2,                       // seconds per bar in the favourite-part graph
  MAX_AUDIO_MB: 20
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
const AUDIO_CACHE = {};
async function resolveAudio(path){
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const c = AUDIO_CACHE[path];
  if (c && c.exp > Date.now()) return c.url;
  const r = await sb.storage.from(CONFIG.AUDIO_BUCKET).createSignedUrl(path, 3600);   // bucket is private: signed links
  if (r.error || !r.data) throw new Error(r.error ? r.error.message : "No access to this audio file");
  AUDIO_CACHE[path] = {url:r.data.signedUrl, exp:Date.now() + 50 * 60 * 1000};
  return r.data.signedUrl;
}
function hydrateAudio(root = document){
  $$("audio[data-audio]", root).forEach(a => { const p = a.dataset.audio; a.removeAttribute("data-audio");
    resolveAudio(p).then(u => { a.src = u; }).catch(() => { a.replaceWith(Object.assign(document.createElement("span"), {className:"small faint", textContent:"Audio unavailable"})); }); });
}
new MutationObserver(muts => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.matches("audio[data-audio]") || n.querySelector("audio[data-audio]"))) hydrateAudio(n.parentNode || document); })
  .observe(document.documentElement, {childList:true, subtree:true});
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
  if (/row-level security|unauthorized|not allowed|403/i.test(m)) return "The database refused the upload. Make sure you're signed in. If it keeps happening, the storage upload policy needs updating in Lovable.";
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
  flag:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-1.5 4L16 12H5"/></svg>',
  rated:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  heart:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7.1 4.5c2 0 3.6 1.1 4.9 2.8 1.3-1.7 2.9-2.8 4.9-2.8 3.5 0 5.7 3.4 4.4 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>',
  video:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5.5" width="14" height="13" rx="2.5"/><path d="m16.5 10.5 5-3v9l-5-3z"/></svg>',
  bars:'<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="11" width="3" height="9" rx="1"/><rect x="8.5" y="6" width="3" height="14" rx="1"/><rect x="14" y="9" width="3" height="11" rx="1"/><rect x="19.5" y="4" width="3" height="16" rx="1"/></svg>',
  ext:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>'
};

/* =====================================================================
   STATE & DATA
   ===================================================================== */
const TYPES = ["original","mashup","cover","remix","nong"];
const TYPE_LABEL = {original:"Original", mashup:"Mashup", cover:"Cover", remix:"Remix", nong:"NONG"};
const PLURAL = {mashup:"Mashups", cover:"Covers", remix:"Remixes", original:"Originals", nong:"NONGs"};
const DIFF = {"Auto":"#9fb3a8","Easy":"#5ec8f0","Normal":"#5fd36b","Hard":"#f0c64a","Harder":"#f08a4a","Insane":"#ec6fc9","Easy Demon":"#c58cf2","Medium Demon":"#e97a9a","Hard Demon":"#ef6a6a","Insane Demon":"#f2544e","Extreme Demon":"#ff3434"};
const DIFF_ORDER = Object.keys(DIFF);

const DB = { loaded:false, error:null, levels:[], songs:[], songIds:[], stats:{}, statsSource:"view", songById:{}, levelById:{} };
const ME = { user:null, profile:null, isAdmin:false, ready:false, rated:new Set(), faved:new Set() };
const PREF_DEFAULTS = { autoplay:true, shuffleDefault:false, compact:false, reduceMotion:false, showNoAudio:true, visualizer:true, keepPitch:false, markRated:true, markFav:true, songMedia:"video" };
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
  buildAuthors();
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
  DB.statsB = {};
  try {
    const r = await run(sb.from("song_b_vote_stats").select("song,votes,avg_score"));
    (r.data || []).forEach(x => DB.statsB[x.song] = {votes:+x.votes, avg:numOrNull(x.avg_score)});
  } catch (_){}
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
  const b = depth < 3 ? songBScore(s, depth) : null;
  const parts = [a, b, q].filter(v => v !== null);
  return parts.length ? parts.reduce((x, y) => x + y, 0) / parts.length : null;
}
/* Song B of a mashup is either a song on GDSR (song_b) or a typed-in song that isn't (song_b_name), rated on the mashup page */
const hasExtB = s => s.type === "mashup" && !s.song_b && !!s.song_b_name;
const voteCountB = s => (DB.statsB && DB.statsB[s.id] && DB.statsB[s.id].votes) || 0;
function songBScore(s, depth = 0){
  if (s.song_b) return overall(DB.songById[s.song_b], depth + 1);
  if (!s.song_b_name) return null;
  const st = DB.statsB && DB.statsB[s.id];
  if (st && st.votes && st.avg !== null) return st.avg;
  return numOrNull(s.song_b_rating);
}
const songBName = s => s.song_b ? ((DB.songById[s.song_b] || {}).name || "?") : (s.song_b_name || "?");
const byScore = (a, b) => { const x = overall(a), y = overall(b); if (x === null && y === null) return a.name.localeCompare(b.name); if (x === null) return 1; if (y === null) return -1; return y - x; };
const ranked = () => DB.songs.slice().sort(byScore);
const songsFor = songId => DB.songs.filter(s => +s.song_id === +songId).sort(byScore);
const levelsFor = songId => DB.levels.filter(l => +l.song_id === +songId);
const originalFor = songId => DB.songs.find(s => +s.song_id === +songId && s.type === "original");
function creditText(s){
  if (s.type === "mashup"){ const a = DB.songById[s.song_a]; return [a ? a.name : "?", songBName(s)].join(" + "); }
  return TYPE_LABEL[s.type] || "Song";
}
const songHay = s => [s.name, s.author, s.type, s.song_id, creditText(s), s.song_b_author || ""].join(" ");

/* ---------- Authors ---------- */
const AUTHOR_SEP = /(\s*,\s*|\s*&\s*|\s+and\s+|\s+x\s+|\s+feat\.?\s+|\s+ft\.?\s+|\s+vs\.?\s+)/i;
const splitAuthors = a => String(a || "").split(AUTHOR_SEP).filter((p, i) => i % 2 === 0).map(x => x.trim()).filter(Boolean);
const AUTH = { byKey:{}, bySlug:{}, list:[] };
function slugify(name){
  let s = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!s){ let h = 0; for (const c of name) h = (h * 31 + c.codePointAt(0)) >>> 0; s = "a" + h.toString(36); }
  return s.slice(0, 60);
}
function buildAuthors(){
  AUTH.byKey = {}; AUTH.bySlug = {}; AUTH.list = [];
  const get = name => {
    const key = name.toLowerCase();
    if (!AUTH.byKey[key]){
      let slug = slugify(name), n = 2; while (AUTH.bySlug[slug]) slug = slugify(name) + "-" + n++;
      const a = AUTH.byKey[key] = {name, key, slug, songs:[], featured:[]};
      AUTH.bySlug[slug] = a; AUTH.list.push(a);
    }
    return AUTH.byKey[key];
  };
  DB.songs.forEach(s => splitAuthors(s.author).forEach(n => { const a = get(n); if (!a.songs.includes(s)) a.songs.push(s); }));
  // mashups that use a song by this author
  DB.songs.filter(s => s.type === "mashup").forEach(m => [m.song_a, m.song_b].map(id => DB.songById[id]).filter(Boolean)
    .forEach(src => splitAuthors(src.author).forEach(n => { const a = AUTH.byKey[n.toLowerCase()]; if (a && !a.songs.includes(m) && !a.featured.includes(m)) a.featured.push(m); })));
  DB.songs.filter(hasExtB).forEach(m => splitAuthors(m.song_b_author).forEach(n => { const a = get(n); if (!a.songs.includes(m) && !a.featured.includes(m)) a.featured.push(m); }));
}
const authorOf = name => AUTH.byKey[String(name || "").trim().toLowerCase()];
function authorStats(a){
  const scored = a.songs.map(overall).filter(v => v !== null);
  return { count:a.songs.length, avg: scored.length ? scored.reduce((x, y) => x + y, 0) / scored.length : null,
    votes: a.songs.reduce((t, s) => t + voteCount(s), 0), top: a.songs.slice().sort(byScore)[0] || null };
}
function authorLinks(str, q = "", cls = "alink"){
  if (!str) return `<span class="faint">Unknown</span>`;
  return String(str).split(AUTHOR_SEP).map((part, i) => {
    if (i % 2) return esc(part);
    const a = authorOf(part); if (!part.trim()) return esc(part);
    return a ? `<a class="${cls}" href="#author-${a.slug}">${hl(part, q)}</a>` : hl(part, q);
  }).join("");
}
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
  await loadMarks();
  ME.ready = true;
  renderHeader();
}
/* which songs the signed-in user has rated / picked a favourite part on (for the list indicators) */
async function loadMarks(){
  const rated = new Set(), faved = new Set();
  if (ME.user){
    const uid = ME.user.id, ids = (t, sink) => sb.from(t).select("song").eq("user_id", uid).limit(10000).then(r => (r.data || []).forEach(x => sink.add(x.song)), () => {});
    await Promise.all([ids("votes", rated), ids("song_b_votes", rated), ids("favourite_parts", faved)]);
  }
  ME.rated = rated; ME.faved = faved;
}
function marks(s){
  if (!ME.user) return "";
  const r = PREFS.markRated && ME.rated.has(s.id), f = PREFS.markFav && ME.faved.has(s.id);
  if (!r && !f) return "";
  return `<span class="marks">${r ? `<span class="mk mk-r" title="You rated this" aria-label="You rated this">${ICON.rated}</span>` : ""}${f ? `<span class="mk mk-f" title="You picked a favourite part" aria-label="You picked a favourite part">${ICON.heart}</span>` : ""}</span>`;
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
  const at = $("#adminTab"); if (at) at.hidden = !ME.isAdmin;
  document.body.classList.toggle("is-admin", !!ME.isAdmin);
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
    renderPlayer(); updateMedia(); markPlaying();
    const token = this.loadToken = (this.loadToken || 0) + 1;
    resolveAudio(s.audio_file).then(url => {
      if (token !== this.loadToken) return;
      this.audio.src = url; applyRate();
      if (autoplay){ initAudioGraph(); this.audio.play().catch(() => {}); }
    }).catch(e => toast(/not found|denied|unauthorized|security|403/i.test(e.message) ? "You don't have access to play this audio file." : "Couldn't load this audio file.", true));
  },
  toggle(){ if (!this.cur) return; if (this.audio.paused){ initAudioGraph(); this.audio.play().catch(() => {}); } else this.audio.pause(); },
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
P.audio.crossOrigin = "anonymous";          // lets the visualizer read the audio (storage sends CORS headers)
P.rate = store.get("rate", 1);
function applyRate(){
  const a = P.audio, keep = !!PREFS.keepPitch;
  a.defaultPlaybackRate = P.rate; a.playbackRate = P.rate;
  if ("preservesPitch" in a) a.preservesPitch = keep;
  a.mozPreservesPitch = keep; a.webkitPreservesPitch = keep;
}
function setRate(r){
  P.rate = Math.round(Math.min(2, Math.max(0.5, r)) * 100) / 100;
  store.set("rate", P.rate); applyRate();
  const b = $("#plSpd"); if (b) { b.textContent = fmtRate(P.rate); b.classList.toggle("on", P.rate !== 1); }
  const sl = $("#spdRange"); if (sl){ sl.value = P.rate; sl.style.setProperty("--p", ((P.rate - .5) / 1.5 * 100) + "%"); }
  const so = $("#spdOut"); if (so) so.textContent = fmtRate(P.rate);
  $$("[data-rate]").forEach(c => c.setAttribute("aria-pressed", String(+c.dataset.rate === P.rate)));
}
const fmtRate = r => (Math.round(r * 100) / 100).toString().replace(/^0\./, "0.") + "×";

/* ---------- visualizer (Web Audio analyser) ---------- */
const VIS = { ctx:null, analyser:null, data:null, raf:0, level:[] };
function initAudioGraph(){
  if (VIS.ctx || !PREFS.visualizer) { if (VIS.ctx && VIS.ctx.state === "suspended") VIS.ctx.resume(); return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    VIS.ctx = new AC();
    const src = VIS.ctx.createMediaElementSource(P.audio);
    VIS.analyser = VIS.ctx.createAnalyser(); VIS.analyser.fftSize = 256; VIS.analyser.smoothingTimeConstant = .78;
    src.connect(VIS.analyser); VIS.analyser.connect(VIS.ctx.destination);
    VIS.data = new Uint8Array(VIS.analyser.frequencyBinCount);
  } catch(_){ VIS.ctx = null; }
}
function startVis(){ if (!VIS.raf) VIS.raf = requestAnimationFrame(drawVis); }
function drawVis(){
  VIS.raf = 0;
  const canvases = $$("canvas[data-vis]").filter(c => c.offsetParent !== null && (!c.dataset.song || (P.cur && c.dataset.song === P.cur.id)));
  const playing = P.cur && !P.audio.paused;
  let live = false;
  if (VIS.analyser && playing && PREFS.visualizer && !PREFS.reduceMotion) { VIS.analyser.getByteFrequencyData(VIS.data); live = true; }
  let any = false;
  canvases.forEach(cv => {
    const n = +cv.dataset.bars || 24, dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)){ cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const key = cv.dataset.vis + n; const lv = VIS.level[key] = VIS.level[key] || new Array(n).fill(0);
    const gap = Math.max(1, Math.round(w / n * .22)), bw = (w - gap * (n - 1)) / n;
    const grad = g.createLinearGradient(0, h, 0, 0); grad.addColorStop(0, "#1f8f52"); grad.addColorStop(1, "#5cf09a");
    g.fillStyle = grad;
    for (let i = 0; i < n; i++){
      let target = 0;
      if (live){ const bins = VIS.data.length * .72, a = Math.floor(Math.pow(i / n, 1.6) * bins), b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / n, 1.6) * bins));
        let m = 0; for (let k = a; k < b; k++) m = Math.max(m, VIS.data[k]); target = m / 255; }
      lv[i] += (target - lv[i]) * (target > lv[i] ? .55 : .14);
      if (lv[i] > .01) any = true;
      const bh = Math.max(cv.dataset.vis === "big" ? 3 : 2, lv[i] * h);
      const r = Math.min(bw / 2, 3), x = i * (bw + gap), y = h - bh;
      g.beginPath(); if (g.roundRect) g.roundRect(x, y, bw, bh, [r, r, 0, 0]); else g.rect(x, y, bw, bh); g.fill();
    }
  });
  if (live || any) startVis();
}
P.audio.volume = store.get("volume", .8);
function shuffleArr(a){ a = a.slice(); for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function renderPlayer(){
  const el = $("#player"), s = P.cur;
  if (!s){ el.classList.remove("on"); document.documentElement.style.setProperty("--player-h", "0px"); return; }
  el.classList.add("on");
  const paused = P.audio.paused;
  el.innerHTML = `<div class="pl-in" style="position:relative">
    <div class="pl-song"><div class="pl-art">${PREFS.visualizer && !PREFS.reduceMotion ? `<canvas data-vis="mini" data-bars="7" aria-hidden="true"></canvas>` : ICON.music}</div><div class="pl-meta"><a href="#song-${s.id}">${esc(s.name)}</a><span>${authorLinks(s.author, "", "plalink")} · ${esc(TYPE_LABEL[s.type] || "")}</span></div></div>
    <div class="pl-center">
      <div class="pl-ctrls">
        <button class="ib opt ${P.shuffle ? "on" : ""}" id="plShuf" type="button" aria-label="Shuffle" aria-pressed="${P.shuffle}">${ICON.shuffle}</button>
        <button class="ib" id="plPrev" type="button" aria-label="Previous">${ICON.prev}</button>
        <button class="ib main" id="plPlay" type="button" aria-label="${paused ? "Play" : "Pause"}">${paused ? ICON.play : ICON.pause}</button>
        <button class="ib" id="plNext" type="button" aria-label="Next">${ICON.next}</button>
        <button class="ib spd ${P.rate !== 1 ? "on" : ""}" id="plSpd" type="button" aria-label="Playback speed" aria-haspopup="dialog" title="Playback speed">${fmtRate(P.rate)}</button>
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
  $("#plSpd").onclick = e => { e.stopPropagation(); toggleSpeed(); };
  $("#plQ").onclick = () => { $("#queue").classList.toggle("on"); renderQueue(); };
  const seek = $("#plSeek");
  seek.addEventListener("input", () => { const d = P.audio.duration; if (d) { P.audio.currentTime = seek.value / 1000 * d; } });
  $("#plVol").addEventListener("input", e => { P.audio.volume = e.target.value / 100; e.target.style.setProperty("--p", e.target.value + "%"); store.set("volume", P.audio.volume); });
  updateTime(); startVis();
}
function toggleSpeed(open){
  const pop = $("#speedPop"); open = open === undefined ? pop.hidden : open;
  if (!open){ pop.hidden = true; return; }
  const presets = [0.5, 0.75, 1, 1.25, 1.5, 2];
  pop.innerHTML = `<div class="sp-h"><b>Playback speed</b><output id="spdOut" class="mono">${fmtRate(P.rate)}</output></div>
    <input type="range" id="spdRange" min="0.5" max="2" step="0.05" value="${P.rate}" style="--p:${(P.rate - .5) / 1.5 * 100}%" aria-label="Playback speed">
    <div class="chips" style="flex-wrap:wrap">${presets.map(r => `<button class="chip" type="button" data-rate="${r}" aria-pressed="${r === P.rate}">${fmtRate(r)}</button>`).join("")}</div>
    <label class="sp-pitch"><span>Keep original pitch</span><span class="switch"><input type="checkbox" id="spdPitch" ${PREFS.keepPitch ? "checked" : ""}><span></span></span></label>
    <p class="small faint" style="margin:0">${PREFS.keepPitch ? "Only the speed changes." : "Pitch changes with speed: faster sounds higher (nightcore), slower sounds deeper."}</p>`;
  pop.hidden = false;
  $("#spdRange").addEventListener("input", e => setRate(+e.target.value));
  $$("[data-rate]", pop).forEach(c => c.onclick = () => setRate(+c.dataset.rate));
  $("#spdPitch").addEventListener("change", e => { setPref("keepPitch", e.target.checked); applyRate(); toggleSpeed(true); });
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
P.audio.addEventListener("play", () => { renderPlayer(); markPlaying(); startVis(); });
P.audio.addEventListener("pause", () => { renderPlayer(); markPlaying(); startVis(); });
P.audio.addEventListener("ratechange", () => { if (Math.abs(P.audio.playbackRate - P.rate) > .001 && P.audio.src) applyRate(); });
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
    <span class="rank${rank && rank <= 3 ? ` top r${rank}` : ""}">${rank || "–"}</span>
    ${playBtn(s)}
    <span class="ttl"><span class="tline"><a class="t" href="#song-${s.id}">${hl(s.name, q)}</a>${marks(s)}</span><span class="sub">${authorLinks(s.author, q)} · ${hl(creditText(s), q)}</span>
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
  return `<a class="lvcard" href="#level-${lv.id}" style="--dc:${DIFF[lv.difficulty] || "#5a7064"}">
    <div class="lv-top">${diffBadge(lv.difficulty)}${starsBadge(lv.stars)}</div>
    <h3>${hl(lv.name, q)}</h3>
    <p class="muted small">by ${hl(lv.creators || "Unknown", q)}</p>
    <div class="lv-line"><span title="Level ID">ID <b class="mono">${hl(lv.level_id ?? "—", q)}</b></span><span title="Song ID">Song <b class="mono">${hl(lv.song_id ?? "—", q)}</b></span></div>
    <div class="lv-foot"><span>${list.length} song${list.length === 1 ? "" : "s"} · <span class="mono" title="Length">${esc(lenText(lv.length))}</span></span><b class="mono" title="Top score" style="color:${scoreColor(best ? overall(best) : null)}">${fmt(best ? overall(best) : null)}</b></div>
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
    <div><h1>The List</h1>
      <p class="lead">Every mashup, cover, remix and NONG, ranked by community score from 0 to 100.</p></div>
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
        ${[["score","Top score"],["votes","Most votes"],["newest","Newest"],["length","Longest"],["name","A–Z"],["author","Author A–Z"]].map(([v,l]) => `<option value="${v}"${state.listSort === v ? " selected" : ""}>${l}</option>`).join("")}
      </select></label>
      <button class="btn" id="listPlay" type="button">${ICON.play} Play all</button>
    </div>
  </div>
  <div class="table" id="listBody"></div>`;
}
function listFiltered(){
  const sorters = {score:byScore, votes:(a,b) => voteCount(b) - voteCount(a), newest:(a,b) => String(b.created_at).localeCompare(String(a.created_at)),
    length:(a,b) => (parseLen(b.length) || 0) - (parseLen(a.length) || 0), name:(a,b) => a.name.localeCompare(b.name),
    author:(a,b) => (splitAuthors(a.author)[0] || "~").localeCompare(splitAuthors(b.author)[0] || "~", undefined, {sensitivity:"base"}) || byScore(a, b)};
  return DB.songs.filter(s => (PREFS.showNoAudio || s.audio_file) && (state.listType === "all" || s.type === state.listType) && matches(songHay(s), state.listQ)).sort(sorters[state.listSort]);
}
const LIST_PAGE = 40;
let listObserver = null;
function renderListBody(){
  const rankMap = new Map(ranked().filter(s => overall(s) !== null).map((s, i) => [s, i + 1]));
  const list = listFiltered();
  const el = $("#listBody");
  if (listObserver){ listObserver.disconnect(); listObserver = null; }
  if (!list.length){
    el.innerHTML = emptyState(DB.songs.length ? "No songs match" : "No songs yet", DB.songs.length ? "Try a different filter or search." : "Approved songs will show up here.");
    return;
  }
  const ids = list.map(s => s.id);
  let shown = 0;
  el.innerHTML = tableHead() + `<div class="list-more" aria-hidden="true"></div>`;
  const sentinel = $(".list-more", el);
  // render the list in pages; the next page is added when the end comes into view
  const more = () => {
    if (shown >= list.length) return false;
    const box = document.createElement("div");
    box.innerHTML = list.slice(shown, shown + LIST_PAGE).map(s => songRow(s, rankMap.get(s), state.listQ)).join("");
    bindPlayButtons(box, ids);
    while (box.firstChild) el.insertBefore(box.firstChild, sentinel);
    shown = Math.min(list.length, shown + LIST_PAGE);
    if (shown >= list.length){ sentinel.remove(); if (listObserver){ listObserver.disconnect(); listObserver = null; } }
    return true;
  };
  more();
  if (shown < list.length && "IntersectionObserver" in window){
    listObserver = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) more(); }, {rootMargin:"800px 0px"});
    listObserver.observe(sentinel);
  } else while (more());
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
  return `${dataNotice()}<section class="hero single"><div><h1>Levels</h1><p class="lead">Pick a level to see every song uploaded to its song ID, ranked by score.</p></div></section>
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
      <div class="btns"><button class="btn" id="lvlPlay" type="button">${ICON.play} Play all</button><a class="btn" href="#request-song">${ICON.plus} Request a song</a><button class="btn ghost" type="button" data-report="level" data-rid="${lv.id}">${ICON.flag} Report level</button></div></div>
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
  renderLevelSongs(lv); bindCopy(app); bindReport(app);
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
function mediaMode(s){
  const hasV = !!ytId(s.video), hasA = !!s.audio_file;
  if (hasV && hasA) return PREFS.songMedia === "bars" ? "bars" : "video";
  return hasV ? "video" : "bars";
}
function mediaBlock(s){
  const both = !!ytId(s.video) && !!s.audio_file, m = mediaMode(s);
  const tabs = both ? `<div class="media-bar"><div class="seg seg-sm" role="radiogroup" aria-label="Show on this page">
      <label><input type="radio" name="mediaMode" value="video" ${m === "video" ? "checked" : ""}><span>${ICON.video} YouTube video</span></label>
      <label><input type="radio" name="mediaMode" value="bars" ${m === "bars" ? "checked" : ""}><span>${ICON.bars} Music bars</span></label></div></div>` : "";
  return `<div class="o-media">${tabs}<div id="mediaBox">${videoBlock(s, m)}</div></div>`;
}
function videoBlock(s, mode){
  const id = ytId(s.video);
  if (id && mode !== "bars") return `<div class="video o-video"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="${esc(s.name)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
  return `<div class="video o-video">${s.audio_file && PREFS.visualizer && !PREFS.reduceMotion ? `<canvas class="big-vis" data-vis="big" data-bars="48" data-song="${s.id}" aria-hidden="true"></canvas>` : ""}<div class="video-ov">
    ${s.audio_file ? `<button class="bigplay" type="button" data-play="${s.id}" aria-label="Play">${ICON.play}</button>` : ""}
    <span class="vt">${esc(s.name)}</span>
    <span class="vs">${!s.audio_file ? "No video or audio yet." : id ? (PREFS.visualizer && !PREFS.reduceMotion ? "Press play to see the music bars." : `Press play to listen. <a class="link" href="#settings-display">Turn on the visualizer</a> to see bars.`) : "No video yet. Press play to listen."}${s.video && !id ? ` <a class="link" href="${esc(s.video)}" target="_blank" rel="noopener">Open link ↗</a>` : ""}</span></div></div>`;
}
function breakdownCard(s){
  const v = overall(s);
  if (s.type === "mashup"){
    const a = DB.songById[s.song_a], b = DB.songById[s.song_b], q = ownScore(s);
    const item = (lbl, x) => { const sc = x ? overall(x) : null;
      return `<li><span><span class="lbl">${lbl}</span>${x ? `<a class="nm" href="#song-${x.id}">${esc(x.name)}</a><span class="small muted">${esc(x.author || "")}</span>` : `<span class="nm faint">Not set</span>`}</span><span class="val" style="color:${scoreColor(sc)}">${fmt(sc)}</span></li>`; };
    const bScore = songBScore(s);
    const itemB = hasExtB(s)
      ? `<li><span><span class="lbl">Song B · not on GDSR</span><span class="nm">${esc(s.song_b_name)}</span><span class="small muted">${s.song_b_author ? authorLinks(s.song_b_author, "", "alink") + " · " : ""}rated here · ${num(voteCountB(s))} vote${voteCountB(s) === 1 ? "" : "s"}</span></span><span class="val" style="color:${scoreColor(bScore)}">${fmt(bScore)}</span></li>`
      : item("Song B", b);
    return `<section class="card card-pad o-break"><h3>Score breakdown</h3><ul class="breakdown">${item("Song A", a)}${itemB}
      <li><span><span class="lbl">Mashing quality</span><span class="nm">${num(voteCount(s))} vote${voteCount(s) === 1 ? "" : "s"}</span></span><span class="val" style="color:${scoreColor(q)}">${fmt(q)}</span></li></ul>
      <div class="formula">(${fmt(a ? overall(a) : null)} + ${fmt(bScore)} + ${fmt(q)}) ÷ 3 = <b>${fmt(v)}</b></div></section>`;
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
      <h1>${esc(s.name)}</h1><p class="lead">${s.type === "original" ? "by" : esc(TYPE_LABEL[s.type] || "") + " by"} ${authorLinks(s.author, "", "link")}</p>
      <div class="btns" style="margin-top:14px">
        <button class="btn primary" type="button" data-play="${s.id}" ${s.audio_file ? "" : "disabled"}>${ICON.play} ${s.audio_file ? "Play" : "No audio yet"}</button>
        <button class="btn" type="button" id="songQueue" ${s.audio_file ? "" : "disabled"}>${ICON.list} Play next</button>
        <button class="btn" type="button" id="songAdd">${ICON.plus} Add to playlist</button>
        <button class="btn ghost" type="button" data-copy="${s.id}">${ICON.copy} Copy song ID</button>
        <button class="btn ghost" type="button" data-report="song" data-rid="${s.id}">${ICON.flag} Report</button>
      </div></div>
    ${ring(overall(s))}
  </section>
  <div class="song-grid">
    <div class="col-main">
      ${mediaBlock(s)}
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
          <dt>Author</dt><dd>${authorLinks(s.author, "", "")}</dd>
          <dt>Type</dt><dd>${esc(TYPE_LABEL[s.type] || "—")}</dd>
          ${s.type === "mashup" ? `<dt>Songs</dt><dd>${DB.songById[s.song_a] ? `<a href="#song-${s.song_a}">${esc(DB.songById[s.song_a].name)}</a>` : "—"} + ${s.song_b && DB.songById[s.song_b] ? `<a href="#song-${s.song_b}">${esc(DB.songById[s.song_b].name)}</a>` : esc(s.song_b_name || "—")}</dd>` : ""}
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
const songCtx = { song:null, myVote:null, myVoteB:null, myFav:null, counts:[], len:180 };
function renderRateCard(){
  const s = songCtx.song, el = $("#rateCard"); if (!el || !s) return;
  const what = s.type === "mashup" ? "mashup" : s.type === "original" ? "song" : (TYPE_LABEL[s.type] || "song").toLowerCase();
  if (!ME.user){ el.innerHTML = `<h3>Rate this ${what}</h3><p class="muted small" style="margin:8px 0 14px">Sign in to vote. Every account gets one vote per song.</p><a class="btn primary" href="#login">Sign in to vote</a>`; return; }
  if (hasExtB(s)) return renderRateCardExtB(s, el);
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
function renderRateCardExtB(s, el){
  const mq = songCtx.myVote, mb = songCtx.myVoteB, voted = mq || mb;
  const sq = mq ? Math.round(+mq.score) : Math.round(ownScore(s) ?? 50), sbv = mb ? Math.round(+mb.score) : Math.round(songBScore(s) ?? 50);
  const slider = (id, label, val) => `<div class="rate-row"><label for="${id}">${label}</label><output id="${id}Out" for="${id}" style="color:${scoreColor(val)}">${val}</output></div>
    <input type="range" id="${id}" min="0" max="100" step="1" value="${val}" style="--p:${val}%">`;
  el.innerHTML = `<h3>Rate this mashup</h3>
    <p class="small muted" style="margin:6px 0 0">Song B isn't on GDSR, so you rate it here along with the mashing quality. Song A is rated on its own page.</p>
    ${slider("rateB", `Song B: <b style="color:var(--text)">${esc(s.song_b_name)}</b>`, sbv)}
    ${slider("rateIn", "Mashing quality", sq)}
    <div class="btns"><button class="btn primary" id="rateSave" type="button">${voted ? "Update votes" : "Submit votes"}</button>${voted ? `<button class="btn ghost" id="rateClear" type="button">Remove</button>` : ""}</div>
    ${voted ? `<p class="small muted" style="margin:10px 0 0">You voted${mb ? ` <b class="mono" style="color:var(--text)">${Math.round(+mb.score)}</b> for Song B` : ""}${mb && mq ? " and" : ""}${mq ? ` <b class="mono" style="color:var(--text)">${Math.round(+mq.score)}</b> for mashing quality` : ""}.</p>` : ""}`;
  ["rateB", "rateIn"].forEach(id => { const r = $("#" + id), o = $("#" + id + "Out"); r.addEventListener("input", () => { o.textContent = r.value; o.style.color = scoreColor(+r.value); r.style.setProperty("--p", r.value + "%"); }); });
  $("#rateSave").onclick = async () => {
    const btn = $("#rateSave"); btn.disabled = true;
    try {
      const q = +$("#rateIn").value, b = +$("#rateB").value;
      if (songCtx.myVoteB) await run(sb.from("song_b_votes").update({score:b}).eq("id", songCtx.myVoteB.id));
      else await run(sb.from("song_b_votes").insert({user_id:ME.user.id, song:s.id, score:b}));
      if (songCtx.myVote) await run(sb.from("votes").update({score:q}).eq("id", songCtx.myVote.id));
      else await run(sb.from("votes").insert({user_id:ME.user.id, song:s.id, score:q}));
      await afterVoteChange(s); toast(`Votes saved · score now ${fmt(overall(DB.songById[s.id]))}`);
    } catch(e){ toast(e.message, true); btn.disabled = false; }
  };
  const rc = $("#rateClear");
  if (rc) rc.onclick = async () => {
    try {
      if (songCtx.myVoteB) await run(sb.from("song_b_votes").delete().eq("id", songCtx.myVoteB.id));
      if (songCtx.myVote) await run(sb.from("votes").delete().eq("id", songCtx.myVote.id));
      await afterVoteChange(s); toast("Votes removed");
    } catch(e){ toast(e.message, true); }
  };
}
async function afterVoteChange(s){
  try { await sb.rpc("recalc_song", {_song:s.id}); } catch(_){}
  const [st, sg] = await Promise.all([loadStats(), sb.from("songs").select("*").eq("id", s.id).maybeSingle(), loadMarks()]);
  if (sg && sg.data){ Object.assign(DB.songById[s.id], sg.data); }
  render({keepScroll:true});
}
async function loadSongExtras(s){
  songCtx.song = s; songCtx.myVote = null; songCtx.myVoteB = null; songCtx.myFav = null; songCtx.counts = [];
  const len = parseLen(s.length);
  const tasks = [
    sb.from("favourite_counts").select("time,quantity").eq("song", s.id).then(r => { if (r.error) throw r.error; songCtx.counts = r.data || []; })
      .catch(() => sb.from("favourite_parts").select("time").eq("song", s.id).then(r => { const m = {}; (r.data || []).forEach(x => m[x.time] = (m[x.time] || 0) + 1); songCtx.counts = Object.entries(m).map(([t, q]) => ({time:+t, quantity:q})); }))
  ];
  if (ME.user){
    tasks.push(sb.from("votes").select("id,score").eq("song", s.id).eq("user_id", ME.user.id).maybeSingle().then(r => { songCtx.myVote = r.data || null; }));
    if (hasExtB(s)) tasks.push(sb.from("song_b_votes").select("id,score").eq("song", s.id).eq("user_id", ME.user.id).maybeSingle().then(r => { songCtx.myVoteB = r.data || null; }));
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
async function refreshFavs(){ await loadSongExtras(songCtx.song); if (songCtx.myFav) ME.faved.add(songCtx.song.id); else ME.faved.delete(songCtx.song.id); drawChart(); renderChartActions(); }
async function mountSong(s){
  bindCopy(app); bindPlayButtons(app, [s.id, ...songsFor(s.song_id).filter(x => x.id !== s.id).map(x => x.id)]); startVis();
  $("#songAdd").onclick = () => openAddToPlaylist(s.id);
  bindReport(app);
  $$('input[name="mediaMode"]', app).forEach(r => r.addEventListener("change", () => {
    PREFS.songMedia = r.value; store.set("prefs", PREFS);
    $("#mediaBox").innerHTML = videoBlock(s, r.value); bindPlayButtons($("#mediaBox"), [s.id]); startVis();
  }));
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
  return `<section class="hero single" style="margin-bottom:18px"><div><h1>Search</h1><p class="lead" id="searchSummary"></p></div></section>
    <div class="toolbar"><div class="chips" id="searchTabs" role="group" aria-label="Result type"></div></div><div id="searchResults"></div>`;
}
function renderSearch(){
  const q = state.searchQ.trim(), sum = $("#searchSummary"); if (!sum) return;
  const songs = q ? DB.songs.filter(s => matches(songHay(s), q)).sort(byScore) : [];
  const lvls = q ? DB.levels.filter(l => matches(levelHay(l), q)) : [];
  const auths = q ? AUTH.list.filter(a => matches(a.name, q)).sort((x, y) => y.songs.length - x.songs.length) : [];
  sum.innerHTML = q ? `${songs.length + lvls.length + auths.length} result${songs.length + lvls.length + auths.length === 1 ? "" : "s"} for “<b style="color:var(--text)">${esc(q)}</b>” across all levels.` : "Type in the search bar above to search every song and level.";
  $("#searchTabs").innerHTML = [["all","All",songs.length + lvls.length + auths.length],["songs","Songs",songs.length],["authors","Authors",auths.length],["levels","Levels",lvls.length]]
    .map(([v,l,n]) => `<button class="chip" type="button" data-v="${v}" aria-pressed="${state.searchTab === v}">${l}<span class="n">${n}</span></button>`).join("");
  const rankMap = new Map(ranked().filter(s => overall(s) !== null).map((s, i) => [s, i + 1]));
  let html = "";
  if (!q) html = `<div class="table">${emptyState("Start typing", "Search by song, artist, level name, level ID, song ID or creator.")}</div>`;
  else {
    if (state.searchTab === "all" || state.searchTab === "authors") html += auths.length ? `<section style="margin-bottom:28px"><div class="section-head"><h2>Authors</h2></div><div class="grid">${auths.map(a => authorCard(a, q)).join("")}</div></section>` : (state.searchTab === "authors" ? `<div class="table">${emptyState("No authors found", "Try part of a name.")}</div>` : "");
    if (state.searchTab === "all" || state.searchTab === "songs") html += `<section style="margin-bottom:28px"><div class="section-head"><h2>Songs</h2></div><div class="table" id="srSongs">${songs.length ? tableHead() + songs.map(s => songRow(s, rankMap.get(s), q)).join("") : emptyState("No songs found", "Try fewer words or a song ID.")}</div></section>`;
    if (state.searchTab === "all" || state.searchTab === "levels") html += `<section><div class="section-head"><h2>Levels</h2></div>${lvls.length ? `<div class="grid">${lvls.map(l => levelCard(l, q)).join("")}</div>` : `<div class="table">${emptyState("No levels found", "Try a level name, ID or creator.")}</div>`}</section>`;
  }
  $("#searchResults").innerHTML = html;
  bindPlayButtons($("#searchResults"), songs.map(s => s.id));
}
function mountSearch(){
  renderSearch();
  $("#searchTabs").addEventListener("click", e => { const b = e.target.closest(".chip"); if (!b) return; state.searchTab = b.dataset.v; renderSearch(); });
}

/* =====================================================================
   VIEW: AUTHORS
   ===================================================================== */
function authorCard(a, q){
  const st = authorStats(a), types = TYPES.map(t => [t, a.songs.filter(s => s.type === t).length]).filter(x => x[1]);
  return `<a class="lvcard acard" href="#author-${a.slug}">
    <div class="a-top"><span class="avatar-md">${esc(a.name.slice(0, 1).toUpperCase())}</span><span class="grow"><h3>${hl(a.name, q)}</h3><p class="muted small">${st.count} song${st.count === 1 ? "" : "s"}${a.featured.length ? ` · in ${a.featured.length} mashup${a.featured.length === 1 ? "" : "s"}` : ""}</p></span></div>
    <div class="lv-meta" style="grid-template-columns:1fr 1fr"><span><small>Avg score</small><b class="mono" style="color:${scoreColor(st.avg)}">${fmt(st.avg)}</b></span><span><small>Votes</small><b class="mono">${num(st.votes)}</b></span></div>
    <div class="lv-foot"><span>${types.map(([t, n]) => `${n} ${n === 1 ? TYPE_LABEL[t].toLowerCase() : PLURAL[t].toLowerCase()}`).join(" · ")}</span></div>
    ${st.top ? `<p class="small muted" style="margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Top: <span style="color:var(--text)">${esc(st.top.name)}</span></p>` : ""}
  </a>`;
}
function viewAuthors(){
  return `${dataNotice()}<section class="hero single"><div><h1>Authors</h1><p class="lead">Everyone who made a song, mashup, cover or remix on GDSR. Pick one to see all their songs.</p></div></section>
  <div class="toolbar"><div class="toolbar-right" style="justify-content:flex-start;flex:1 1 100%">
    <label class="field" style="flex:1 1 320px"><span class="sr-only">Search authors</span>${ICON.search}<input id="auQ" type="search" placeholder="Search authors…" value="${esc(state.auQ || "")}" autocomplete="off"></label>
    <label><span class="sr-only">Sort authors</span><select class="select" id="auSort">${[["songs","Most songs"],["score","Top average score"],["votes","Most votes"],["name","A–Z"]].map(([v, l]) => `<option value="${v}"${(state.auSort || "songs") === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
  </div></div><div id="auBody"></div>`;
}
function renderAuthorsBody(){
  const q = state.auQ || "", sort = state.auSort || "songs";
  const cmp = {songs:(a, b) => b.songs.length - a.songs.length || a.name.localeCompare(b.name), name:(a, b) => a.name.localeCompare(b.name, undefined, {sensitivity:"base"}),
    score:(a, b) => { const x = authorStats(a).avg, y = authorStats(b).avg; return (y ?? -1) - (x ?? -1); }, votes:(a, b) => authorStats(b).votes - authorStats(a).votes}[sort];
  const list = AUTH.list.filter(a => matches(a.name, q)).sort(cmp);
  $("#auBody").innerHTML = list.length ? `<div class="grid">${list.map(a => authorCard(a, q)).join("")}</div>`
    : `<div class="table">${emptyState(AUTH.list.length ? "No authors match" : "No authors yet", AUTH.list.length ? "Try part of a name." : "Authors appear once songs are added.")}</div>`;
}
function mountAuthors(){
  renderAuthorsBody();
  $("#auQ").addEventListener("input", e => { state.auQ = e.target.value; renderAuthorsBody(); });
  $("#auSort").addEventListener("change", e => { state.auSort = e.target.value; renderAuthorsBody(); });
}
function viewAuthor(a){
  const st = authorStats(a), songs = a.songs.slice().sort(byScore);
  const songIds = [...new Set(a.songs.map(s => s.song_id).filter(v => v !== null && v !== undefined))];
  const lvls = DB.levels.filter(l => songIds.includes(l.song_id));
  return `<a class="back" href="#authors">${ICON.back} All authors</a>
  <section class="page-head"><div style="display:flex;gap:16px;align-items:center">
      <div class="avatar-lg">${esc(a.name.slice(0, 1).toUpperCase())}</div>
      <div><h1 style="font-size:32px">${esc(a.name)}</h1></div></div>
    <div class="btns"><button class="btn primary" id="auPlay" type="button">${ICON.play} Play all</button><button class="btn" id="auShuffle" type="button">${ICON.shuffle} Shuffle</button><button class="btn" id="auSave" type="button">${ICON.plus} Save as playlist</button></div></section>
  <div class="stats" style="margin:16px 0 0">
    <div class="stat"><b>${st.count}</b><span>Songs</span></div>
    <div class="stat"><b style="color:${scoreColor(st.avg)}">${fmt(st.avg)}</b><span>Average score</span></div>
    <div class="stat"><b>${num(st.votes)}</b><span>Votes</span></div>
    <div class="stat"><b>${a.featured.length}</b><span>Used in mashups</span></div>
  </div>
  <section class="section">
    <div class="section-head"><div><h2>Songs by ${esc(a.name)}</h2><p class="muted small">Ranked by score.</p></div></div>
    <div class="toolbar">${chips("auChips", typeOptions(songs), state.auType || "all")}
      <div class="toolbar-right"><label><span class="sr-only">Sort</span><select class="select" id="auSongSort">${[["score","Top score"],["votes","Most votes"],["newest","Newest"],["name","A–Z"]].map(([v, l]) => `<option value="${v}"${(state.auSongSort || "score") === v ? " selected" : ""}>${l}</option>`).join("")}</select></label></div></div>
    <div class="table" id="auSongs"></div>
  </section>
  ${a.featured.length ? `<section class="section"><div class="section-head"><div><h2>Featured in mashups</h2><p class="muted small">Mashups made by others that use a song by ${esc(a.name)}.</p></div></div><div class="table compact" id="auFeat">${a.featured.slice().sort(byScore).map((s, i) => songRow(s, i + 1, "")).join("")}</div></section>` : ""}
  ${lvls.length ? `<section class="section"><div class="section-head"><h2>Levels using their songs</h2></div><div class="grid">${lvls.map(l => levelCard(l)).join("")}</div></section>` : ""}`;
}
function authorSongsFiltered(a){
  const t = state.auType || "all", sort = state.auSongSort || "score";
  const cmp = {score:byScore, votes:(x, y) => voteCount(y) - voteCount(x), newest:(x, y) => String(y.created_at).localeCompare(String(x.created_at)), name:(x, y) => x.name.localeCompare(y.name)}[sort];
  return a.songs.filter(s => t === "all" || s.type === t).sort(cmp);
}
function renderAuthorSongs(a){
  const rankMap = new Map(ranked().filter(s => overall(s) !== null).map((s, i) => [s, i + 1]));
  const list = authorSongsFiltered(a), el = $("#auSongs");
  el.innerHTML = list.length ? tableHead() + list.map(s => songRow(s, rankMap.get(s), "")).join("") : emptyState("No songs of this type");
  bindPlayButtons(el, list.map(s => s.id));
}
function mountAuthor(a){
  state.auType = "all";
  renderAuthorSongs(a);
  const feat = $("#auFeat"); if (feat) bindPlayButtons(feat, a.featured.map(s => s.id));
  bindChips($("#auChips"), v => { state.auType = v; renderAuthorSongs(a); });
  $("#auSongSort").addEventListener("change", e => { state.auSongSort = e.target.value; renderAuthorSongs(a); });
  $("#auPlay").onclick = () => { const was = P.shuffle; P.shuffle = false; P.playList(authorSongsFiltered(a).map(s => s.id), 0, a.name); P.shuffle = was; };
  $("#auShuffle").onclick = () => P.playList(shuffleArr(authorSongsFiltered(a).map(s => s.id)), 0, a.name);
  $("#auSave").onclick = async () => { try { const p = await PL.create(`Songs by ${a.name}`, a.songs.slice().sort(byScore).map(s => s.id)); toast(`Saved “${p.name}”`); } catch(e){ toast(e.message, true); } };
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
   REPORTS (users flag a song or level for admins)
   ===================================================================== */
const REPORT_REASONS = [
  ["wrong_info", "Wrong information", "Name, author, song ID, length or another detail is wrong", ["song","level"]],
  ["broken_audio", "Audio doesn't play", "The audio is missing, broken or the wrong song", ["song"]],
  ["broken_video", "Video doesn't work", "The YouTube video is unavailable or doesn't match", ["song"]],
  ["duplicate", "Duplicate", "This is already on GDSR", ["song","level"]],
  ["inappropriate", "Inappropriate content", "Offensive title, audio or video", ["song","level"]],
  ["spam", "Spam", "Not a real song or level", ["song","level"]],
  ["other", "Something else", "Explain below", ["song","level"]]
];
const REASON_LABEL = Object.fromEntries(REPORT_REASONS.map(r => [r[0], r[1]]));
const reportTarget = (type, id) => type === "level" ? DB.levelById[id] : DB.songById[id];
function bindReport(root){ $$("[data-report]", root).forEach(b => b.onclick = () => openReport(b.dataset.report, b.dataset.rid)); }
function openReport(type, id){
  if (!ME.user){ toast("Sign in to report something.", true); location.hash = "login"; return; }
  const tgt = reportTarget(type, id); if (!tgt) return;
  const reasons = REPORT_REASONS.filter(r => r[3].includes(type));
  const bg = openModal({title:`Report ${type === "level" ? "level" : "song"}`,
    body:`<form class="form" id="repForm" novalidate>
      <p class="muted small" style="margin:0">Reporting <b style="color:var(--text)">${esc(tgt.name)}</b>. Admins review every report.</p>
      <fieldset class="rep-reasons"><legend class="sr-only">Reason</legend>${reasons.map(([v, l, d], i) => `<label class="rep-opt"><input type="radio" name="reason" value="${v}" ${i === 0 ? "checked" : ""}><span><b>${l}</b><small>${d}</small></span></label>`).join("")}</fieldset>
      <label class="f"><span>Details <span class="faint small" id="repReq">(optional)</span></span><textarea class="textarea" name="details" rows="3" maxlength="1000" placeholder="What's wrong? Links or timestamps help."></textarea></label>
      <p class="msg" id="repMsg" hidden></p></form>`,
    foot:`<button class="btn ghost" data-close type="button">Cancel</button><button class="btn danger" id="repSend" type="button">${ICON.flag} Send report</button>`});
  const form = $("#repForm", bg), msg = $("#repMsg", bg);
  const sync = () => { $("#repReq", bg).textContent = form.reason.value === "other" ? "(required)" : "(optional)"; };
  form.addEventListener("change", sync);
  const send = async () => {
    const reason = form.reason.value, details = form.details.value.trim() || null;
    msg.hidden = true;
    if (reason === "other" && !details){ msg.hidden = false; msg.textContent = "Tell us what's wrong."; form.details.focus(); return; }
    const btn = $("#repSend", bg); btn.disabled = true;
    try {
      await run(sb.from("reports").insert({user_id:ME.user.id, target_type:type, target_id:id, reason, details}));
      closeModal(); toast("Report sent. Thanks, an admin will take a look.");
    } catch(e){
      btn.disabled = false; msg.hidden = false;
      msg.textContent = /duplicate|unique/i.test(e.message) ? "You already have an open report on this. An admin will look at it soon." : missingRelation(e) ? "Reports aren't set up on the database yet." : e.message;
    }
  };
  $("#repSend", bg).onclick = send;
  form.addEventListener("submit", e => { e.preventDefault(); send(); });
}
const reportTargetLink = r => { const x = reportTarget(r.target_type, r.target_id); return x ? `<a class="link" href="#${r.target_type}-${r.target_id}">${esc(x.name)}</a>` : `<span class="faint">Deleted ${esc(r.target_type)}</span>`; };

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
    <section class="card card-pad"><h3>My reports</h3><div id="myReports"><p class="muted small">Loading…</p></div></section>
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
  renderMyReports();
  $("#myVotes").innerHTML = votes.length ? `<ul class="mini-list">${votes.map(v => { const s = DB.songById[v.song]; return `<li><a href="#song-${esc(v.song)}"><span class="grow"><span class="nm">${esc(s ? s.name : "Deleted song")}</span><span class="sb">${dateFmt(v.created_at)}</span></span><b class="mono" style="color:${scoreColor(+v.score)}">${Math.round(+v.score)}</b></a></li>`; }).join("")}</ul>` : `<p class="muted small">You haven't voted yet. Open any song to rate it.</p>`;
}

async function renderMyReports(){
  const el = $("#myReports"); if (!el) return;
  let rows = [];
  try { rows = (await run(sb.from("reports").select("*").eq("user_id", ME.user.id).order("created_at", {ascending:false}).limit(100))).data || []; }
  catch(e){ el.innerHTML = `<p class="muted small">${missingRelation(e) ? "Reports aren't set up yet." : esc(e.message)}</p>`; return; }
  el.innerHTML = rows.length ? `<ul class="mini-list">${rows.map(r => `<li><div class="mi"><span class="grow"><span class="nm">${reportTargetLink(r)} · ${esc(REASON_LABEL[r.reason] || r.reason)}</span><span class="sb">${dateFmt(r.created_at)}${r.admin_note ? ` · Admin note: ${esc(r.admin_note)}` : ""}</span></span>${statusBadge(r.status)}${r.status === "open" ? `<button class="btn ghost sm" type="button" data-wd="${r.id}" style="position:relative;z-index:1">Withdraw</button>` : ""}</div></li>`).join("")}</ul>`
    : `<p class="muted small">No reports. Use “Report” on a song or level page if something's wrong.</p>`;
  $$("[data-wd]", el).forEach(b => b.onclick = async () => { try { await run(sb.from("reports").delete().eq("id", b.dataset.wd)); toast("Report withdrawn"); renderMyReports(); } catch(e){ toast(e.message, true); } });
}

/* =====================================================================
   VIEW: SETTINGS
   ===================================================================== */
const SETTINGS_TABS = [["profile","Profile",true],["account","Account & security",true],["playback","Playback",false],["display","Display",false],["data","Data & privacy",false]];
const swRow = (key, title, desc) => `<div class="set-row"><div class="lbl"><b>${title}</b><span>${desc}</span></div><div class="ctl"><label class="switch"><input type="checkbox" data-pref="${key}" ${PREFS[key] ? "checked" : ""} aria-label="${esc(title.replace(/<[^>]*>/g, "").trim())}"><span></span></label></div></div>`;
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
        <div class="set-row"><div class="lbl"><b>Playback speed</b><span>0.5× to 2×. Changes pitch too unless “Keep original pitch” is on.</span></div><div class="ctl"><input type="range" id="setRate" min="0.5" max="2" step="0.05" value="${P.rate}" style="--p:${(P.rate - .5) / 1.5 * 100}%" aria-label="Playback speed"><span class="mono small" id="setRateOut" style="width:46px;text-align:right">${fmtRate(P.rate)}</span></div></div>
        ${swRow("keepPitch", "Keep original pitch", "Change only the speed, not the pitch.")}
        ${swRow("autoplay", "Autoplay next song", "Keep playing the next song in the queue when one ends.")}
        ${swRow("shuffleDefault", "Shuffle by default", "Start new queues in shuffle mode.")}
        <div class="set-row"><div class="lbl"><b>Repeat</b><span>What happens at the end of the queue.</span></div><div class="ctl"><select class="select" id="setRepeat">${[["off","Off"],["all","Repeat queue"],["one","Repeat song"]].map(([v, l]) => `<option value="${v}"${P.repeat === v ? " selected" : ""}>${l}</option>`).join("")}</select></div></div></div>`;
    case "display":
      return `<div class="set-card"><header><h2>Display</h2><p>Saved on this device.</p></header>
        <div class="set-row" id="installRow">${installRowHtml()}</div>
        ${swRow("visualizer", "Music visualizer", "Animated bars in the player and on song pages while music plays.")}
        ${swRow("compact", "Compact lists", "Shorter rows that hide the second line, so more songs fit on screen.")}
        ${swRow("reduceMotion", "Reduce motion", "Turn off animations and transitions.")}
        ${swRow("showNoAudio", "Show songs without audio", "Include songs that have no audio file in lists.")}
        <div class="set-row"><div class="lbl"><b>Song pages show</b><span>When a song has both a YouTube video and audio. You can also switch on each song page.</span></div><div class="ctl"><select class="select" id="setMedia"><option value="video"${PREFS.songMedia !== "bars" ? " selected" : ""}>YouTube video</option><option value="bars"${PREFS.songMedia === "bars" ? " selected" : ""}>Music bars</option></select></div></div></div>
      <div class="set-card"><header><h2>List indicators</h2><p>Small marks next to songs in lists. Only you see them, and only while signed in.</p></header>
        ${swRow("markRated", `<span class="mk mk-r inline">${ICON.rated}</span> Rated`, "Show a check next to songs you've rated.")}
        ${swRow("markFav", `<span class="mk mk-f inline">${ICON.heart}</span> Favourite part`, "Show a heart next to songs where you picked a favourite part.")}</div>`;
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
  const ib = $("#installRowBtn"); if (ib) ib.onclick = installApp;
  const sr = $("#setRate"); if (sr) sr.addEventListener("input", () => { setRate(+sr.value); sr.style.setProperty("--p", ((P.rate - .5) / 1.5 * 100) + "%"); $("#setRateOut").textContent = fmtRate(P.rate); });
  const kp = $('[data-pref="keepPitch"]'); if (kp) kp.addEventListener("change", applyRate);
  const vz = $('[data-pref="visualizer"]'); if (vz) vz.addEventListener("change", () => { if (vz.checked) initAudioGraph(); if (P.cur) renderPlayer(); });
  const sm = $("#setMedia"); if (sm) sm.addEventListener("change", () => { setPref("songMedia", sm.value); toast("Saved"); });
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
  {k:"song_b", label:"Song B", type:"songb", showIf:v => v.type === "mashup"},
  {k:"audio_file", label:"Audio file", type:"audio"}
];
function fieldHtml(f, val, ctx = {}){
  const id = `f_${f.k}`, req = f.req ? ' <span class="req">*</span>' : "", v = val ?? "";
  const wrap = inner => `<label class="f" data-field="${f.k}"><span class="lt">${esc(f.label || f.k)}${req}</span>${inner}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ""}</label>`;
  switch (f.type){
    case "enum": { const opts = f.options.slice(); if (v && !opts.includes(v)) opts.unshift(v);
      return wrap(`<select class="select" id="${id}" name="${f.k}" ${f.req ? "required" : ""}><option value="">—</option>${opts.map(o => `<option value="${esc(o)}"${o === v ? " selected" : ""}>${esc((f.labels && f.labels[o]) || o)}</option>`).join("")}</select>`); }
    case "int": case "numeric":
      return wrap(`<input class="input" type="number" id="${id}" name="${f.k}" value="${esc(v)}" ${f.min !== undefined ? `min="${f.min}"` : ""} ${f.max !== undefined ? `max="${f.max}"` : ""} step="${f.type === "int" ? 1 : "0.01"}" ${f.req ? "required" : ""}>`);
    case "songid":
      return wrap(`<input class="input mono" type="number" id="${id}" name="${f.k}" value="${esc(v)}" min="1" step="1" list="songIdList" ${f.req ? "required" : ""}><datalist id="songIdList">${DB.songIds.map(x => `<option value="${x.song_id}">`).join("")}</datalist>`);
    case "song":
      return wrap(`<select class="select" id="${id}" name="${f.k}"><option value="">— none —</option>${DB.songs.slice().sort((a, b) => a.name.localeCompare(b.name)).filter(s => s.id !== ctx.selfId).map(s => `<option value="${s.id}"${s.id === v ? " selected" : ""}>${esc(s.name)} · ${esc(s.author || "")} (${esc(TYPE_LABEL[s.type] || "")})</option>`).join("")}</select>`);
    case "songb": {
      const row = ctx.row || {}, ext = row.song_b ? false : true;
      return `<div class="f sb-field" data-field="${f.k}" data-songb>
        <span class="sb-label">${esc(f.label)}</span>
        <div class="seg" role="radiogroup" aria-label="Where is Song B?">
          <label><input type="radio" name="song_b_mode" value="ext" ${ext ? "checked" : ""}><span>Not on GDSR · type it</span></label>
          <label><input type="radio" name="song_b_mode" value="site" ${ext ? "" : "checked"}><span>On GDSR · choose it</span></label>
        </div>
        <div class="sb-ext row2">
          <label class="f"><span class="lt">Song name <span class="req">*</span></span><input class="input" name="song_b_name" value="${esc(row.song_b_name || "")}" maxlength="120" placeholder="e.g. Tunak Tunak Tun"></label>
          <label class="f">Original artist<input class="input" name="song_b_author" value="${esc(row.song_b_author || "")}" maxlength="120" placeholder="Optional"></label>
          <span class="hint" style="grid-column:1/-1">People rate this song on the mashup's page.</span>
        </div>
        <div class="sb-site"><select class="select" id="${id}" name="${f.k}"><option value="">Choose a song…</option>${DB.songs.slice().sort((a, b) => a.name.localeCompare(b.name)).filter(x => x.id !== ctx.selfId).map(x => `<option value="${x.id}"${x.id === v ? " selected" : ""}>${esc(x.name)} · ${esc(x.author || "")} (${esc(TYPE_LABEL[x.type] || "")})</option>`).join("")}</select></div>
      </div>`;
    }
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
        ${v ? `<audio controls preload="none" data-audio="${esc((v))}"></audio>` : ""}${ctx.admin ? `<input class="input mono small" style="flex:1 1 220px" data-audio-path="${f.k}" value="${esc(v)}" placeholder="or a storage path / URL">` : ""}</span>`);
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
  $$("[data-songb]", form).forEach(box => { const ext = (vals.song_b_mode || "ext") === "ext"; $(".sb-ext", box).hidden = !ext; $(".sb-site", box).hidden = ext; });
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
        infoEl.insertAdjacentHTML("afterend", `<audio controls preload="metadata" data-audio="${esc((path))}"></audio>`);
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
    const el = $(`[data-field="${f.k}"]`, form);
    if (f.type === "songb"){
      if (el && el.style.display === "none"){ out.song_b = null; out.song_b_name = null; out.song_b_author = null; continue; }
      const ext = (fd.get("song_b_mode") || "ext") === "ext";
      out.song_b = ext ? null : (String(fd.get("song_b") || "").trim() || null);
      out.song_b_name = ext ? (String(fd.get("song_b_name") || "").trim() || null) : null;
      out.song_b_author = ext ? (String(fd.get("song_b_author") || "").trim() || null) : null;
      continue;
    }
    if (el && el.style.display === "none"){ out[f.k] = null; continue; }
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
  return `<section class="hero single"><div><h1>Request a ${kind}</h1><p class="lead">Admins review every request. You can follow its status on your account page.</p></div></section>
  <div class="auth-wrap" style="max-width:640px;margin-top:0"><div class="card card-pad">
    <div class="tabs" role="tablist"><button type="button" role="tab" aria-selected="${kind === "level"}" data-kind="request">Level</button><button type="button" role="tab" aria-selected="${kind === "song"}" data-kind="request-song">Song</button></div>
    <form class="form" id="reqForm" novalidate>
      ${kind === "song" ? `<div class="row2">${fieldHtml(fields[0])}${fieldHtml(fields[1], "original")}</div><div class="row2">${fieldHtml(fields[2])}${fieldHtml(fields[3])}</div><div class="row2">${fieldHtml(fields[4])}${fieldHtml(fields[5])}</div><div class="row2">${fieldHtml(fields[6])}${fieldHtml(fields[7])}</div>${fieldHtml(fields[8])}`
        : `<div class="row2">${fieldHtml(fields[0])}${fieldHtml(fields[1])}</div><div class="row2">${fieldHtml(fields[2])}${fieldHtml(fields[3])}</div><div class="row2">${fieldHtml(fields[4])}${fieldHtml(fields[5])}</div><div class="row2">${fieldHtml(fields[6])}${fieldHtml(fields[7])}</div>`}
      <p class="msg" id="reqMsg" hidden></p>
      <button class="btn primary" type="submit">Submit request</button>
    </form></div>
    <a class="card card-pad mod-cta" href="${CONFIG.MOD_URL}" rel="noopener">
      <span class="mod-ic" aria-hidden="true"><svg viewBox="0 0 32 32"><rect x="8" y="8" width="16" height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.4"/><rect x="12.5" y="12.5" width="7" height="7" rx="1" fill="currentColor"/></svg></span>
      <span class="grow"><b>Request from inside the game</b><span>Get the GDSR Geode mod. A button on every level page sends the level and its song, including your Jukebox song. Works on Windows and Android.</span></span>
      <span class="btn sm">${ICON.ext} Download</span>
    </a></div>`;
}
function mountRequest(kind){
  if (!ME.user) return;
  const fields = kind === "song" ? SONG_FIELDS : LEVEL_FIELDS, form = $("#reqForm"), msg = $("#reqMsg");
  $$("[data-kind]").forEach(b => b.onclick = () => { location.hash = b.dataset.kind; });
  applyShowIf(form, fields); form.addEventListener("change", () => applyShowIf(form, fields));
  bindAudioUpload(form, fields, `${ME.user.id}/requests`);
  form.addEventListener("submit", async e => {
    e.preventDefault(); msg.hidden = true;
    if (form.dataset.uploading){ toast("Wait for the audio upload to finish.", true); return; }
    try {
      const data = readForm(form, fields);
      if (kind === "song" && data.type === "mashup" && !data.song_a) throw new Error("Choose Song A for the mashup.");
      if (kind === "song" && data.type === "mashup" && !data.song_b && !data.song_b_name) throw new Error("Add Song B: type its name, or choose it if it's on GDSR.");
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
  return `<section class="hero single"><div><h1>Playlists</h1><p class="lead">Build playlists, play them in the player, and share them as a file of song IDs.</p></div></section>
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
          <span class="ttl"><span class="tline"><a class="t" href="#song-${s.id}">${esc(s.name)}</a>${marks(s)}</span><span class="sub">${esc(s.author || "")} · ${esc(TYPE_LABEL[s.type] || "")} · ${esc(lenText(s.length))}</span></span>
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
    cols:["name","type","author","song_id","length","rating","mashing_quality","song_b_name","audio_file"], link:r => `#song-${r.id}`},
  "song-b-votes":{table:"song_b_votes", title:"Song B votes", pk:"id", order:"created_at", needsUsers:true,
    fields:[{k:"user_id", label:"User", type:"user", req:true},{k:"song", label:"Mashup", type:"song"},{k:"score", label:"Score", type:"numeric", min:0, max:100, req:true}],
    cols:["user_id","song","score","created_at"]},
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
  ["Review", [["overview","Overview"],["reports","Reports"],["level-requests","Level requests"],["song-requests","Song requests"]]],
  ["Catalogue", [["levels","Levels"],["songs","Songs"],["song-ids","Song IDs"],["storage","Audio files"]]],
  ["Community", [["users","Users & roles"],["votes","Votes"],["song-b-votes","Song B votes"],["favourites","Favourite parts"],["playlists","Playlists"]]]
];
const ADM = { users:null, pending:{level:0, song:0, reports:0} };
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
  const cr = async () => { try { const r = await sb.from("reports").select("id", {count:"exact", head:true}).eq("status", "open"); return r.count || 0; } catch(_){ return 0; } };
  const [l, s, rp] = await Promise.all([c("level_requests"), c("song_requests"), cr()]);
  ADM.pending = {level:l, song:s, reports:rp};
  const rc = $('.side a[href="#admin-reports"] .cnt'); if (rc){ rc.textContent = rp; rc.hidden = !rp; }
  const a = $('.side a[href="#admin-level-requests"] .cnt'), b = $('.side a[href="#admin-song-requests"] .cnt');
  if (a){ a.textContent = l; a.hidden = !l; } if (b){ b.textContent = s; b.hidden = !s; }
}
function viewAdmin(section){
  if (!ME.user) return requireLogin("use the admin panel");
  if (!ME.isAdmin) return `<div class="card card-pad" style="max-width:520px;margin:30px auto;text-align:center"><h2>Admins only</h2><p class="muted">Your account doesn't have the admin role.</p><a class="btn" href="#list">Back to The List</a></div>`;
  return `<div class="admin">
    <nav class="side" aria-label="Admin sections">${ADMIN_NAV.map(([h, items]) => `<h4>${h}</h4>${items.map(([k, l]) => `<a href="#admin-${k}" class="${section === k ? "active" : ""}">${l}${k.endsWith("requests") || k === "reports" ? `<span class="cnt" hidden>0</span>` : ""}</a>`).join("")}`).join("")}</nav>
    <div id="admMain">${skeleton(5)}</div></div>`;
}
async function mountAdmin(section){
  if (!ME.isAdmin) return;
  admPendingCounts();
  const main = $("#admMain");
  try {
    if (section === "overview") await admOverview(main);
    else if (section === "reports") await admReports(main);
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
      <a class="stat" href="#admin-reports" style="border-color:${ADM.pending.reports ? "rgba(240,113,113,.45)" : ""}"><b style="color:${ADM.pending.reports ? "#f07171" : ""}">${ADM.pending.reports}</b><span>Open reports</span></a>
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
  const val = (f, v, q) => {
    if (f.type === "songb") return q.song_b ? (DB.songById[q.song_b] ? `<a class="link" href="#song-${q.song_b}">${esc(DB.songById[q.song_b].name)}</a>` : `<span class="mono">${esc(q.song_b)}</span>`)
      : q.song_b_name ? `${esc(q.song_b_name)}${q.song_b_author ? ` · ${esc(q.song_b_author)}` : ""} <span class="faint">(not on GDSR)</span>` : '<span class="faint">—</span>';
    if (v === null || v === undefined || v === "") return '<span class="faint">—</span>';
    if (f.type === "song") return DB.songById[v] ? `<a class="link" href="#song-${v}">${esc(DB.songById[v].name)}</a>` : `<span class="mono">${esc(v)}</span>`;
    if (f.type === "audio") return `<audio controls preload="none" data-audio="${esc((v))}" style="height:32px;max-width:100%"></audio>`;
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
        <div class="kv">${fields.filter(f => kind !== "song" || !f.showIf || f.showIf(q)).map(f => `<div><small>${esc(f.label)}</small><span>${val(f, q[f.k], q)}</span></div>`).join("")}</div>
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
    if (ed) ed.onclick = () => admEditForm({title:`Edit ${kind} request`, fields, row:q, onSave:async data => { await run(sb.from(table).update(data).eq("id", id)); toast("Request updated"); admRequests(main, kind); }, folder:`${ME.user.id}/songs`});
    if (dl) dl.onclick = async () => { if (await confirmBox("Delete this request permanently?", {ok:"Delete", danger:true})){ try { await run(sb.from(table).delete().eq("id", id)); toast("Request deleted"); admRequests(main, kind); admPendingCounts(); } catch(e){ toast(e.message, true); } } };
  });
}

/* ---------- reports ---------- */
async function admReports(main){
  await admUsers();
  const st = state.repStatus || "open";
  const r = await run(sb.from("reports").select("*").eq("status", st).order("created_at", {ascending:st === "open"}).limit(300));
  const rows = r.data || [];
  const openAll = st === "open" ? rows : ((await sb.from("reports").select("target_type,target_id").eq("status", "open")).data || []);
  const sameCount = q => openAll.filter(x => x.target_type === q.target_type && x.target_id === q.target_id).length;
  main.innerHTML = `<div class="section-head" style="margin-top:0"><div><h1 style="font-size:28px">Reports</h1><p class="muted">Problems users flagged on songs and levels.</p></div></div>
    ${chips("repTabs", [["open","Open"],["resolved","Resolved"],["dismissed","Dismissed"]].map(([v, l]) => ({v, label:l})), st, "Report status")}
    <div style="display:grid;gap:14px;margin-top:14px">${rows.length ? rows.map(q => { const n = sameCount(q), tgt = reportTarget(q.target_type, q.target_id);
      return `<section class="card req-card" data-rep="${q.id}">
        <div class="req-top"><div><h3 style="font-size:17px">${esc(REASON_LABEL[q.reason] || q.reason)}</h3><p class="muted small" style="margin:2px 0 0"><span class="pill">${q.target_type === "level" ? "Level" : "Song"}</span> ${reportTargetLink(q)} · reported by ${esc(userName(q.user_id))} · ${dateFmt(q.created_at)}${q.reviewed_by ? ` · reviewed by ${esc(userName(q.reviewed_by))}` : ""}</p></div>${statusBadge(q.status)}</div>
        ${n > 1 ? `<div class="notice" style="margin:0">${n} open reports on this ${q.target_type}.</div>` : ""}
        ${q.details ? `<blockquote class="rep-details">${esc(q.details)}</blockquote>` : `<p class="small faint" style="margin:0">No details given.</p>`}
        ${q.admin_note && q.status !== "open" ? `<p class="small muted" style="margin:0">Note: ${esc(q.admin_note)}</p>` : ""}
        ${q.status === "open" ? `<div class="form" style="gap:10px"><textarea class="textarea" data-note rows="2" placeholder="Note to the reporter (optional, shown on their account page)" style="min-height:60px"></textarea>
          <div class="btns"><button class="btn primary sm" data-resolve type="button">Mark resolved</button><button class="btn sm" data-dismiss type="button">Dismiss</button>${tgt ? `<button class="btn sm" data-fix type="button">Edit ${q.target_type}</button>` : ""}<button class="btn ghost sm" data-del type="button">Delete</button></div></div>`
          : `<div class="btns"><button class="btn ghost sm" data-reopen type="button">Reopen</button><button class="btn ghost sm" data-del type="button">Delete</button></div>`}
      </section>`; }).join("") : `<div class="table">${emptyState(`No ${st} reports`, st === "open" ? "Nothing needs attention." : "")}</div>`}</div>`;
  bindChips($("#repTabs"), v => { state.repStatus = v; admReports(main); });
  $$("[data-rep]", main).forEach(card => {
    const id = card.dataset.rep, q = rows.find(x => x.id === id), note = () => (($("[data-note]", card) || {}).value || "").trim() || null;
    const setStatus = async status => {
      $$("button", card).forEach(b => b.disabled = true);
      try {
        const upd = status === "open" ? {status, reviewed_by:null, reviewed_at:null} : {status, admin_note:note(), reviewed_by:ME.user.id, reviewed_at:new Date().toISOString()};
        await run(sb.from("reports").update(upd).eq("id", id));
        toast(status === "resolved" ? "Marked resolved" : status === "dismissed" ? "Dismissed" : "Reopened");
        admReports(main); admPendingCounts();
      } catch(e){ toast(/duplicate|unique/i.test(e.message) ? "That user already has another open report on this." : e.message, true); $$("button", card).forEach(b => b.disabled = false); }
    };
    const on = (sel, fn) => { const b = $(sel, card); if (b) b.onclick = fn; };
    on("[data-resolve]", () => setStatus("resolved"));
    on("[data-dismiss]", () => setStatus("dismissed"));
    on("[data-reopen]", () => setStatus("open"));
    on("[data-fix]", () => { const key = q.target_type === "level" ? "levels" : "songs", cfg = ADMIN_TABLES[key], row = reportTarget(q.target_type, q.target_id);
      admEditForm({title:`Edit ${q.target_type}`, fields:cfg.fields, row, users:ADM.users, onSave:async data => { await ensureSongId(data, cfg.table); await run(sb.from(cfg.table).update(data).eq("id", row.id)); await loadData(); toast("Saved"); admReports(main); }}); });
    on("[data-del]", async () => { if (await confirmBox("Delete this report permanently?", {ok:"Delete", danger:true})){ try { await run(sb.from("reports").delete().eq("id", id)); toast("Report deleted"); admReports(main); admPendingCounts(); } catch(e){ toast(e.message, true); } } });
  });
}

/* ---------- generic edit form ---------- */
function admEditForm({title, fields, row, onSave, folder, users}){
  folder = folder || `${ME.user.id}/songs`;
  const isNew = !row;
  const bg = openModal({title, wide:true,
    body:`<form class="form" id="admForm" novalidate><div class="row2" style="align-items:start">${fields.map(f => fieldHtml(f, row ? row[f.k] : (f.type === "enum" && f.k === "type" ? "original" : undefined), {admin:true, users, selfId:row && row.id, row})).join("")}</div><p class="msg" id="admMsg" hidden></p></form>`,
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
      if (data.type === "mashup" && "song_b_name" in data && !data.song_b && !data.song_b_name) throw new Error("Add Song B: type its name, or choose it if it's on GDSR.");
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
  const allowed = new Set([cfg.pk, ...cfg.fields.map(f => f.k), ...(cfg.table === "songs" ? ["song_b_name", "song_b_author"] : [])]);
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
          <audio controls preload="none" data-audio="${esc((p))}" style="height:32px;width:220px;max-width:40vw"></audio>
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
      const dest = path.split("/")[0] === ME.user.id ? full(`${Date.now()}-${safeName(f.name)}`) : `${ME.user.id}/songs/${Date.now()}-${safeName(f.name)}`;
      try { await run(sb.storage.from(CONFIG.AUDIO_BUCKET).upload(dest, f, {contentType:f.type || "audio/mpeg"})); ok++; } catch(err){ toast(`${f.name}: ${storageError(err)}`, true); }
    }
    if (ok) toast(`Uploaded ${ok} file${ok === 1 ? "" : "s"}`);
    admStorage(main);
  };
}

/* =====================================================================
   VIEW: GUESS THE SONG (mini game)
   ===================================================================== */
const GUESS_LEVELS = [
  {k:"easy",    label:"Easy",    clip:8,   mult:1},
  {k:"normal",  label:"Normal",  clip:4,   mult:1.5},
  {k:"hard",    label:"Hard",    clip:2,   mult:2},
  {k:"insane",  label:"Insane",  clip:1,   mult:3},
  {k:"extreme", label:"Extreme", clip:0.5, mult:4},
  {k:"extremeplus", label:"Extreme+", clip:0.2, mult:5}
];
const GUESS_DEFAULT = {types:TYPES.slice(), start:"start", diffs:[], level:"normal", rounds:10};
const G = { cfg:Object.assign({}, GUESS_DEFAULT, store.get("guessCfg", {})), audio:new Audio(), phase:"setup", rounds:[], i:0, score:0, streak:0, best:0, stopT:0, token:0 };
G.audio.preload = "auto"; G.audio.crossOrigin = "anonymous";
const guessLevel = () => GUESS_LEVELS.find(l => l.k === G.cfg.level) || GUESS_LEVELS[1];
function guessPool(cfg = G.cfg){
  let ids = null;
  if (cfg.diffs.length){ ids = new Set(DB.levels.filter(l => cfg.diffs.includes(l.difficulty) && l.song_id).map(l => +l.song_id)); }
  return DB.songs.filter(s => s.audio_file && cfg.types.includes(s.type) && (!ids || ids.has(+s.song_id)));
}
const guessBestKey = () => `guessBest-${G.cfg.level}-${G.cfg.start}`;
function guessStop(){ clearTimeout(G.stopT); G.token++; try { G.audio.pause(); } catch(_){} cancelAnimationFrame(G.raf); }

function viewGuess(){
  return `${dataNotice()}<section class="hero single"><div><h1>Guess the Song</h1>
    <p class="lead">Hear a short clip and pick the right song. Shorter clips score more.</p></div></section>
    <div id="guessBox"></div>`;
}
function mountGuess(){ if (P.cur && !P.audio.paused) P.audio.pause(); G.phase === "play" ? renderGuessRound() : G.phase === "done" ? renderGuessDone() : renderGuessSetup(); }

function renderGuessSetup(){
  G.phase = "setup"; guessStop();
  const box = $("#guessBox"); if (!box) return;
  const c = G.cfg, usedDiffs = DIFF_ORDER.filter(d => DB.levels.some(l => l.difficulty === d && l.song_id));
  const chip = (group, v, label, on) => `<button class="chip" type="button" data-g="${group}" data-v="${esc(v)}" aria-pressed="${on}">${esc(label)}</button>`;
  box.innerHTML = `<div class="card guess-setup">
    <div class="g-row"><div class="g-lab"><b>Song types</b><span>Which kinds of songs can come up.</span></div>
      <div class="chips wrap">${TYPES.map(t => chip("type", t, PLURAL[t], c.types.includes(t))).join("")}</div></div>
    <div class="g-row"><div class="g-lab"><b>Clip starts</b><span>From the very beginning, or anywhere in the song.</span></div>
      <div class="seg seg-sm" role="radiogroup" aria-label="Clip starts">
        <label><input type="radio" name="gStart" value="start"${c.start === "start" ? " checked" : ""}><span>From the start</span></label>
        <label><input type="radio" name="gStart" value="random"${c.start === "random" ? " checked" : ""}><span>Random part</span></label></div></div>
    <div class="g-row"><div class="g-lab"><b>Level difficulty</b><span>Only songs used by levels of these difficulties. None picked means any song.</span></div>
      <div class="chips wrap">${chip("diff", "", "Any", !c.diffs.length)}${usedDiffs.map(d => chip("diff", d, d, c.diffs.includes(d))).join("")}</div></div>
    <div class="g-row"><div class="g-lab"><b>Game difficulty</b><span>Sets how long each clip is.</span></div>
      <div class="g-levels">${GUESS_LEVELS.map(l => `<button type="button" class="g-level" data-level="${l.k}" aria-pressed="${l.k === c.level}"><b>${l.label}</b><span class="mono">${l.clip < 1 ? Math.round(l.clip * 1000) + " ms" : l.clip + " s"}</span><small>×${l.mult} points</small></button>`).join("")}</div></div>
    <div class="g-row"><div class="g-lab"><b>Rounds</b></div>
      <div class="chips">${[5, 10, 15, 20].map(n => chip("rounds", n, n, c.rounds === n)).join("")}</div></div>
    <div class="g-start"><span class="muted small" id="gPool"></span><button class="btn primary lg" type="button" id="gGo">${ICON.play} Start game</button></div>
  </div>`;
  const upd = () => {
    const n = guessPool().length, best = store.get(guessBestKey(), 0);
    $("#gPool").innerHTML = `<b style="color:var(--text)">${n}</b> song${n === 1 ? "" : "s"} match${best ? ` · Best at this setting: <b class="mono" style="color:var(--accent-strong)">${best}</b>` : ""}`;
    $("#gGo").disabled = n < 2;
    if (n < 2) $("#gPool").innerHTML += ` · <span style="color:var(--danger,#ef6a6a)">Need at least 2 songs. Loosen the filters.</span>`;
    store.set("guessCfg", G.cfg);
  };
  box.addEventListener("click", e => {
    const b = e.target.closest("[data-g]"), lv = e.target.closest("[data-level]");
    if (lv){ c.level = lv.dataset.level; $$("[data-level]", box).forEach(x => x.setAttribute("aria-pressed", String(x === lv))); upd(); return; }
    if (!b) return;
    const g = b.dataset.g, v = b.dataset.v;
    if (g === "type"){ c.types = c.types.includes(v) ? c.types.filter(x => x !== v) : [...c.types, v]; if (!c.types.length) c.types = [v]; }
    if (g === "diff"){ c.diffs = !v ? [] : c.diffs.includes(v) ? c.diffs.filter(x => x !== v) : [...c.diffs, v]; }
    if (g === "rounds") c.rounds = +v;
    $$(`[data-g="${g}"]`, box).forEach(x => x.setAttribute("aria-pressed", String(
      g === "type" ? c.types.includes(x.dataset.v) : g === "diff" ? (x.dataset.v ? c.diffs.includes(x.dataset.v) : !c.diffs.length) : +x.dataset.v === c.rounds)));
    upd();
  });
  $$('input[name="gStart"]', box).forEach(r => r.addEventListener("change", () => { c.start = r.value; upd(); }));
  $("#gGo").addEventListener("click", startGuess);
  upd();
}

function startGuess(){
  const pool = shuffleArr(guessPool()); if (pool.length < 2) return;
  const all = DB.songs.filter(s => s.audio_file);
  G.rounds = pool.slice(0, Math.min(G.cfg.rounds, pool.length)).map(s => {
    const others = shuffleArr(pool.filter(x => x.id !== s.id)), extra = shuffleArr(all.filter(x => x.id !== s.id && !others.includes(x)));
    const choices = shuffleArr([s, ...[...others, ...extra].slice(0, 3)]);
    return {id:s.id, choices:choices.map(x => x.id), start:null, plays:0, pick:null, pts:0};
  });
  Object.assign(G, {phase:"play", i:0, score:0, streak:0, best:0});
  renderGuessRound();
}

function renderGuessRound(){
  const box = $("#guessBox"); if (!box) return;
  const r = G.rounds[G.i], lvl = guessLevel(), done = r.pick !== null;
  box.innerHTML = `<div class="card guess-play">
    <div class="g-hud"><span>Round <b>${G.i + 1}</b>/${G.rounds.length}</span><span>Score <b class="mono" id="gScore">${G.score}</b></span><span>Streak <b>${G.streak}</b></span><span class="pill">${lvl.label} · ${lvl.clip < 1 ? Math.round(lvl.clip * 1000) + "ms" : lvl.clip + "s"}</span></div>
    <div class="g-stage">
      <button class="g-play" type="button" id="gPlay" aria-label="Play clip">${ICON.play}<svg class="g-ring" viewBox="0 0 120 120"><circle cx="60" cy="60" r="54"/><circle id="gRing" cx="60" cy="60" r="54"/></svg></button>
      <p class="muted small" id="gHint">${done ? "" : r.plays ? `Played ${r.plays}× · ${3 - r.plays} replay${3 - r.plays === 1 ? "" : "s"} left` : "Press play (or Space) to hear the clip"}</p>
    </div>
    <div class="g-choices">${r.choices.map((id, n) => { const s = DB.songById[id];
      const cls = done ? (id === r.id ? " right" : id === r.pick ? " wrong" : " dim") : "";
      return `<button type="button" class="g-choice${cls}" data-id="${id}"${done ? " disabled" : ""}><kbd>${n + 1}</kbd><span><b>${esc(s.name)}</b><small>${esc(s.author || "")} · ${esc(TYPE_LABEL[s.type] || "")}</small></span></button>`; }).join("")}</div>
    <div class="g-foot">${done
      ? `<span class="g-result ${r.pick === r.id ? "ok" : "bad"}">${r.pick === r.id ? `Correct! +${r.pts}` : r.pick === "skip" ? "Skipped" : "Not quite"} · <a href="#song-${r.id}">${esc(DB.songById[r.id].name)}</a></span>
         <span class="row-gap"><button class="btn" type="button" id="gHear">${ICON.vol} Hear more</button><button class="btn primary" type="button" id="gNext">${G.i + 1 < G.rounds.length ? "Next round" : "See results"}</button></span>`
      : `<button class="btn ghost" type="button" id="gQuit">Quit</button><button class="btn" type="button" id="gSkip">Skip</button>`}</div>
  </div>`;
  $("#gPlay").addEventListener("click", () => done ? guessPlay(r, 15) : guessPlay(r));
  $$(".g-choice", box).forEach(b => b.addEventListener("click", () => guessPick(b.dataset.id)));
  if (done){ $("#gNext").addEventListener("click", guessNext); $("#gHear").addEventListener("click", () => guessPlay(r, 15)); $("#gNext").focus(); }
  else { $("#gSkip").addEventListener("click", () => guessPick("skip")); $("#gQuit").addEventListener("click", renderGuessSetup); if (!r.plays) guessPlay(r); }
}

async function guessPlay(r, len){
  const done = r.pick !== null;
  if (!done && r.plays >= 3){ toast("No replays left. Make your guess."); return; }
  guessStop(); const token = G.token, s = DB.songById[r.id], clip = len || guessLevel().clip, a = G.audio;
  $("#gPlay") && $("#gPlay").classList.add("loading");
  try {
    const url = await resolveAudio(s.audio_file); if (token !== G.token) return;
    if (a.dataset.src !== url){ a.src = url; a.dataset.src = url; }
    if (!(a.readyState >= 1)) await new Promise((ok, bad) => { a.addEventListener("loadedmetadata", ok, {once:true}); a.addEventListener("error", bad, {once:true}); });
    if (token !== G.token) return;
    if (r.start === null){ const d = isFinite(a.duration) ? a.duration : 30;
      r.start = G.cfg.start === "random" ? Math.max(0, Math.random() * Math.max(0, d - guessLevel().clip - 2)) : 0; }
    a.currentTime = r.start; await a.play();
    if (token !== G.token){ a.pause(); return; }
    if (!done){ r.plays++; const h = $("#gHint"); if (h) h.textContent = `Played ${r.plays}× · ${3 - r.plays} replay${3 - r.plays === 1 ? "" : "s"} left`; }
  } catch(e){ toast("Couldn't load this clip. Skipping it.", true); if (!done) guessPick("skip", true); return; }
  finally { $("#gPlay") && $("#gPlay").classList.remove("loading"); }
  const t0 = performance.now(), ring = $("#gRing"), btn = $("#gPlay");
  btn && btn.classList.add("on");
  const tick = () => { const p = Math.min(1, (performance.now() - t0) / (clip * 1000)); if (ring) ring.style.strokeDashoffset = String(339.3 * (1 - p)); if (p < 1 && token === G.token) G.raf = requestAnimationFrame(tick); };
  tick();
  G.stopT = setTimeout(() => { if (token === G.token){ a.pause(); btn && btn.classList.remove("on"); if (ring) ring.style.strokeDashoffset = "339.3"; } }, clip * 1000);
}

function guessPick(id, silent){
  const r = G.rounds[G.i]; if (r.pick !== null) return;
  r.pick = id; guessStop();
  if (id === r.id){
    G.streak++; G.best = Math.max(G.best, G.streak);
    r.pts = Math.round(([100, 100, 75, 50][r.plays] || 50) * guessLevel().mult + Math.min(50, (G.streak - 1) * 10));
    G.score += r.pts;
  } else G.streak = 0;
  renderGuessRound();
}
function guessNext(){ guessStop(); if (G.i + 1 < G.rounds.length){ G.i++; renderGuessRound(); } else renderGuessDone(); }

function renderGuessDone(){
  G.phase = "done"; guessStop();
  const box = $("#guessBox"); if (!box) return;
  const right = G.rounds.filter(r => r.pick === r.id).length, key = guessBestKey(), prev = store.get(key, 0), isBest = G.score > prev;
  if (isBest) store.set(key, G.score);
  box.innerHTML = `<div class="card guess-done">
    <div class="stats g-summary"><div class="stat"><b class="mono" style="color:var(--accent-strong)">${G.score}</b><span>${isBest ? "New best!" : `Best ${Math.max(prev, G.score)}`}</span></div>
      <div class="stat"><b>${right}/${G.rounds.length}</b><span>Correct</span></div><div class="stat"><b>${G.best}</b><span>Best streak</span></div>
      <div class="stat"><b>${guessLevel().label}</b><span>${G.cfg.start === "random" ? "Random parts" : "From the start"}</span></div></div>
    <div class="table compact">${G.rounds.map((r, n) => { const s = DB.songById[r.id], ok = r.pick === r.id;
      return `<div class="row g-recap"><span class="g-mark ${ok ? "ok" : "bad"}">${ok ? "✓" : "✕"}</span><span class="grow"><a href="#song-${s.id}"><b>${esc(s.name)}</b></a><small class="muted"> · ${esc(s.author || "")}</small></span><span class="mono small">${ok ? "+" + r.pts : r.pick === "skip" ? "skipped" : "—"}</span></div>`; }).join("")}</div>
    <div class="g-foot"><button class="btn" type="button" id="gSet">Change settings</button><button class="btn primary" type="button" id="gAgain">Play again</button></div>
  </div>`;
  $("#gSet").addEventListener("click", renderGuessSetup);
  $("#gAgain").addEventListener("click", startGuess);
}
document.addEventListener("keydown", e => {
  if (route().name !== "guess" || G.phase !== "play" || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || $("#modalBg")) return;
  const r = G.rounds[G.i]; if (!r) return;
  if (e.key === " "){ e.preventDefault(); r.pick !== null ? guessNext() : guessPlay(r); }
  else if (/^[1-4]$/.test(e.key) && r.pick === null){ const id = r.choices[+e.key - 1]; if (id) guessPick(id); }
  else if (e.key === "Enter" && r.pick !== null){ e.preventDefault(); guessNext(); }
});
window.addEventListener("hashchange", () => { if (route().name !== "guess") guessStop(); });

/* =====================================================================
   ROUTER
   ===================================================================== */
function route(){
  const h = decodeURIComponent(location.hash.slice(1)); let m;
  if (!h || h === "list") return {name:"list"};
  if (["levels","authors","search","login","signup","account","playlists","request","request-song","guess"].includes(h)) return {name:h};
  if ((m = h.match(/^author-([\w-]+)$/))) return {name:"author", id:m[1]};
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
const NEEDS_DATA = new Set(["guess","list","levels","authors","author","level","song","search","request","request-song","playlists","playlist","admin","account"]);
function render(opts = {}){
  const r = route(), y = window.scrollY;
  if (listObserver){ listObserver.disconnect(); listObserver = null; }
  document.body.dataset.route = r.name;
  if (r.name === "search" && matchMedia("(max-width:760px)").matches && !state.searchQ) setTimeout(() => hq.focus(), 50);
  $$("[data-nav]").forEach(a => a.classList.toggle("active", a.dataset.nav === r.name || (r.name === "level" && a.dataset.nav === "levels") || (r.name === "author" && a.dataset.nav === "authors") || (r.name === "playlist" && a.dataset.nav === "playlists") || (r.name === "request-song" && a.dataset.nav === "request")));
  if (r.name !== "search" && document.activeElement !== hq) hq.value = "";
  $("#queue").classList.remove("on"); toggleMenu(false); toggleSpeed(false);
  if (NEEDS_DATA.has(r.name) && !DB.loaded){ app.innerHTML = skeleton(8); return; }
  if (["account","request","request-song","admin","settings"].includes(r.name) && !ME.ready){ app.innerHTML = skeleton(4); return; }
  let title = "The List";
  switch (r.name){
    case "list": app.innerHTML = viewList(); mountList(); break;
    case "levels": title = "Levels"; app.innerHTML = viewLevels(); mountLevels(); break;
    case "authors": title = "Authors"; app.innerHTML = viewAuthors(); mountAuthors(); break;
    case "author": { const a = AUTH.bySlug[r.id]; if (!a){ notFound(); title = "Not found"; break; } title = a.name; app.innerHTML = viewAuthor(a); mountAuthor(a); break; }
    case "search": title = "Search"; hq.value = state.searchQ; app.innerHTML = viewSearch(); mountSearch(); break;
    case "level": { const lv = DB.levelById[r.id]; if (!lv){ notFound(); title = "Not found"; break; } title = lv.name; app.innerHTML = viewLevel(lv); mountLevel(lv); break; }
    case "song": { const s = DB.songById[r.id]; if (!s){ notFound(); title = "Not found"; break; } title = s.name; app.innerHTML = viewSong(s); mountSong(s); break; }
    case "login": case "signup": title = r.name === "login" ? "Sign in" : "Create account"; app.innerHTML = viewAuth(r.name); mountAuth(r.name); break;
    case "account": title = "Profile"; app.innerHTML = viewAccount(); mountAccount(); break;
    case "settings": title = "Settings"; app.innerHTML = viewSettings(r.id); mountSettings(r.id); break;
    case "request": case "request-song": title = "Request"; { const k = r.name === "request-song" ? "song" : "level"; app.innerHTML = viewRequest(k); mountRequest(k); } break;
    case "guess": title = "Guess the Song"; app.innerHTML = viewGuess(); mountGuess(); break;
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
   INSTALLABLE APP (PWA)
   ===================================================================== */
const PWA = { prompt:null, standalone: matchMedia("(display-mode: standalone)").matches || navigator.standalone === true };
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")){
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
window.addEventListener("beforeinstallprompt", e => {        // Chrome / Edge / Samsung Internet on Android (and desktop)
  e.preventDefault(); PWA.prompt = e; updateInstallUI();
});
window.addEventListener("appinstalled", () => { PWA.prompt = null; PWA.standalone = true; updateInstallUI(); toast("GDSR installed. Open it from your home screen."); });
function updateInstallUI(){
  const b = $("#installBtn"); if (b) b.hidden = !PWA.prompt || PWA.standalone;
  const row = $("#installRow"); if (row) row.innerHTML = installRowHtml();
  const ib = $("#installRowBtn"); if (ib) ib.onclick = installApp;
}
async function installApp(){
  if (!PWA.prompt){ toast(PWA.standalone ? "You're already using the installed app." : "Open this site in Chrome on Android, then use “Install app” or the browser menu → Add to Home screen.", !PWA.standalone); return; }
  PWA.prompt.prompt();
  const choice = await PWA.prompt.userChoice.catch(() => null);
  if (choice && choice.outcome === "accepted") toast("Installing GDSR…");
  PWA.prompt = null; updateInstallUI();
}
function installRowHtml(){
  if (PWA.standalone) return `<div class="lbl"><b>Install app</b><span>You're using the installed app.</span></div><div class="ctl"><span class="badge approved">Installed</span></div>`;
  return `<div class="lbl"><b>Install app</b><span>${PWA.prompt ? "Add GDSR to your home screen. It opens full-screen like a normal app." : "On Android, open this site in Chrome and choose Install app (or menu → Add to Home screen)."}</span></div><div class="ctl"><button class="btn ${PWA.prompt ? "primary" : ""}" id="installRowBtn" type="button" ${PWA.prompt ? "" : "disabled"}>Install</button></div>`;
}

/* =====================================================================
   BOOT
   ===================================================================== */
(async function boot(){
  applyPrefs();
  $("#installBtn").addEventListener("click", installApp);
  if (PWA.standalone) document.body.classList.add("standalone");
  $("#acctBtn").addEventListener("click", e => { e.stopPropagation(); toggleMenu(); });
  document.addEventListener("click", e => { if (!e.target.closest(".menu-wrap")) toggleMenu(false); if (!e.target.closest("#speedPop,#plSpd")) toggleSpeed(false); });
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
