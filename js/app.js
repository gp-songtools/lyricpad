// The "?v=" stamps make browsers fetch matching copies of every file after an update
// (tools/stamp-version.sh sets them). Data files get the same stamp via VERSION.
import { Lexicon, guessSyllables } from "./phonetics.js?v=795918ce";
import { initSuggest } from "./suggest.js?v=795918ce";
import { initThesaurus } from "./thesaurus.js?v=795918ce";
import { initDrive } from "./drive.js?v=795918ce";

const VERSION = new URL(import.meta.url).search;

// A problem in one side panel must never stop the editor or the dictionary from working.
function safeInit(name, init) {
  try { return init(); } catch (err) { console.error(`${name} panel failed to start:`, err); return null; }
}

const $ = (id) => document.getElementById(id);
const els = {
  status: $("status"), title: $("title"), lyrics: $("lyrics"), mirror: $("mirror"), gutter: $("gutter"),
  scroll: $("editorScroll"), lineInfo: $("lineInfo"), form: $("searchForm"), query: $("query"),
  results: $("results"), toast: $("toast"), rhymeHere: $("rhymeHere"),
  perfect: $("optPerfect"), near: $("optNear"), assonance: $("optAssonance"), rare: $("optRare"), syl: $("optSyl"),
};

let lexicon = null;
let pendingQuery = null;

// ---------- storage (best effort) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem("lyricpad:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("lyricpad:" + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

// ---------- syllables ----------
const sylCache = new Map();
function wordSyllables(w) {
  const key = w.toLowerCase();
  let r = sylCache.get(key);
  if (!r) {
    r = lexicon ? lexicon.syllables(key) : { min: guessSyllables(key), max: guessSyllables(key), guessed: true };
    if (lexicon) sylCache.set(key, r);
  }
  return r;
}

// Meta tags like [Chorus] or [Verse 2 - softer] aren't sung: drop them wherever they appear.
const stripTags = (line) => line.replace(/\[[^\]]*\]?/g, " ");
function lineSyllables(line) {
  line = stripTags(line);
  if (!line.trim()) return null;
  const words = line.split(/[\s\-–—/]+/).filter((w) => /[a-z]/i.test(w));
  let min = 0, max = 0, guessed = false;
  const parts = [];
  for (const w of words) {
    const s = wordSyllables(w);
    min += s.min; max += s.max; guessed ||= s.guessed;
    const clean = w.replace(/^[^a-z']+|[^a-z']+$/gi, "");
    parts.push(`${clean} ${s.min === s.max ? s.min : s.min + "–" + s.max}${s.guessed ? "?" : ""}`);
  }
  return words.length ? { min, max, guessed, parts } : null;
}

// ---------- editor ----------
function currentLineIndex() {
  const t = els.lyrics;
  return t.value.slice(0, t.selectionStart).split("\n").length - 1;
}

let lineData = [];
function renderEditor() {
  const text = els.lyrics.value;
  const lines = text.split("\n");
  lineData = lines.map(lineSyllables);

  // Mirror each line so wrapped lines get a gutter cell of the right height.
  const mf = document.createDocumentFragment();
  for (const l of lines) {
    const d = document.createElement("div");
    d.textContent = l || "​";
    mf.appendChild(d);
  }
  els.mirror.replaceChildren(mf);

  const gf = document.createDocumentFragment();
  const rows = els.mirror.children;
  lines.forEach((_, i) => {
    const d = document.createElement("div");
    d.style.height = rows[i].getBoundingClientRect().height + "px";
    const s = lineData[i];
    if (s) {
      d.textContent = s.min === s.max ? s.min : `${s.min}–${s.max}`;
      if (s.guessed) d.classList.add("guess");
      d.title = s.parts.join(" · ") + (s.guessed ? "\n? = estimated (word not in dictionary)" : "");
    }
    gf.appendChild(d);
  });
  els.gutter.replaceChildren(gf);

  els.lyrics.style.height = "0px";
  els.lyrics.style.height = Math.max(els.mirror.scrollHeight, els.scroll.clientHeight) + "px";
  markCurrent();
}

let lastCurrent = -1;
function markCurrent() {
  const i = currentLineIndex();
  const rows = els.gutter.children;
  if (rows[lastCurrent]) rows[lastCurrent].classList.remove("current");
  if (rows[i]) rows[i].classList.add("current");
  lastCurrent = i;
  try { suggest?.refreshTarget(); } catch (err) { console.error(err); }

  const s = lineData[i];
  const nonEmpty = lineData.filter(Boolean).length;
  const syl = s ? (s.min === s.max ? s.min : `${s.min}–${s.max}`) : 0;
  els.lineInfo.textContent =
    `Line ${i + 1} · ${syl} syllable${syl === 1 ? "" : "s"}` +
    (s?.guessed ? " (some estimated)" : "") + ` · ${nonEmpty} lyric line${nonEmpty === 1 ? "" : "s"}`;
}

let saveTimer;
els.lyrics.addEventListener("input", () => {
  renderEditor();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set("text", els.lyrics.value), 300);
  drive?.edited();
});
els.title.addEventListener("input", () => { store.set("title", els.title.value); drive?.edited(); });
document.addEventListener("selectionchange", () => { if (document.activeElement === els.lyrics) markCurrent(); });
new ResizeObserver(() => renderEditor()).observe(els.scroll);

// Word under the cursor, or the last word of the nearest line above if the cursor is on a blank line.
function wordForRhyme() {
  const t = els.lyrics, v = t.value;
  const sel = v.slice(t.selectionStart, t.selectionEnd).trim();
  if (sel) return sel.split(/\s+/).slice(-3).join(" ");
  const pos = t.selectionStart;
  const before = v.slice(0, pos).match(/[\w'’]+$/)?.[0] || "";
  const after = v.slice(pos).match(/^[\w'’]+/)?.[0] || "";
  if (before + after) return before + after;
  const lines = v.slice(0, pos).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = stripTags(lines[i]).match(/([a-z'’]+)[^a-z]*$/i);
    if (m) return m[1];
  }
  return "";
}

function rhymeFromEditor() {
  const w = wordForRhyme();
  if (!w) return toast("Put the cursor on a word first");
  els.query.value = w.replace(/^[^a-z']+|[^a-z']+$/gi, "");
  search();
}
// Double-click a word: thesaurus lookup when that tab is open, otherwise rhymes.
els.lyrics.addEventListener("dblclick", () => setTimeout(() => {
  if (!$("paneThes").hidden) thesaurus?.lookupFromEditor();
  else rhymeFromEditor();
}, 0));
els.rhymeHere.addEventListener("click", () => { rhymeFromEditor(); els.lyrics.focus(); });
document.addEventListener("keydown", (e) => {
  if (e.altKey && e.code === "KeyR") { e.preventDefault(); rhymeFromEditor(); }
  if (e.altKey && e.code === "KeyT") { e.preventDefault(); showTab($("tabThes")); thesaurus?.lookupFromEditor(); }
});

// The single word that is selected or under the cursor, with its position: {word, start, end}.
function wordAtCursor() {
  const t = els.lyrics, v = t.value;
  let start = t.selectionStart, end = t.selectionEnd;
  if (start === end) {
    start -= v.slice(0, start).match(/[a-z'’]*$/i)[0].length;
    end += v.slice(end).match(/^[a-z'’]*/i)[0].length;
  } else {
    // Trim the selection to the first word in it.
    const sel = v.slice(start, end);
    const m = sel.match(/[a-z'’]+/i);
    if (!m) return null;
    start += m.index;
    end = start + m[0].length;
  }
  // Leading/trailing apostrophes are usually quotes, not part of the word.
  while (start < end && /['’]/.test(v[start])) start++;
  while (end > start && /['’]/.test(v[end - 1]) && !/in['’]$/i.test(v.slice(start, end))) end--;
  const word = v.slice(start, end);
  return /[a-z]/i.test(word) ? { word, start, end } : null;
}

function songText() {
  return (els.title.value.trim() ? els.title.value.trim() + "\n\n" : "") + els.lyrics.value;
}

function downloadTxt() {
  const name = (els.title.value.trim() || "lyrics").replace(/[^\w\- ]+/g, "").trim() || "lyrics";
  const body = songText();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
  a.download = name + ".txt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- rhymes ----------
const LABELS = { perfect: "Perfect rhymes", near: "Near rhymes", assonance: "Vowel matches" };
const PAGE = 80;

function options() {
  return { perfect: els.perfect.checked, near: els.near.checked, assonance: els.assonance.checked, rare: els.rare.checked };
}

let search = function () {
  const q = els.query.value.trim();
  if (!q) return;
  if (!lexicon) { pendingQuery = q; els.results.innerHTML = `<p class="hint">Loading dictionary…</p>`; return; }
  const opts = options();
  store.set("opts", { ...opts, syl: els.syl.value });
  const target = lexicon.target(q);
  if (!target) {
    els.results.innerHTML = `<p class="hint">Couldn’t work out how “${escapeHtml(q)}” sounds. Try another spelling.</p>`;
    return;
  }
  if (!opts.perfect && !opts.near && !opts.assonance) {
    els.results.innerHTML = `<p class="hint">Pick at least one of Perfect, Near or Vowel match.</p>`;
    return;
  }
  const res = lexicon.rhymes(target, opts);
  const sylFilter = els.syl.value ? +els.syl.value : 0;
  const keep = (r) => !sylFilter || (sylFilter === 4 ? r.syllables >= 4 : r.syllables === sylFilter);

  const frag = document.createDocumentFragment();
  if (target.guessedFrom) {
    const n = document.createElement("p");
    n.className = "notice";
    n.textContent = `“${q}” isn’t in the dictionary — guessing it sounds like “${target.guessedFrom}”.`;
    frag.appendChild(n);
  }
  let total = 0;
  for (const kind of ["perfect", "near", "assonance"]) {
    if (!opts[kind]) continue;
    const list = res[kind].filter(keep);
    total += list.length;
    frag.appendChild(renderGroup(kind, list));
  }
  if (!total) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = opts.rare ? "No matches. Try turning on more rhyme types." : "No matches. Try turning on “Rare words” or more rhyme types.";
    frag.appendChild(p);
  }
  els.results.replaceChildren(frag);
  els.results.scrollTop = 0;
}

function renderGroup(kind, list) {
  const g = document.createElement("section");
  g.className = "group";
  g.innerHTML = `<h2>${LABELS[kind]} <span class="count">${list.length}</span></h2>`;
  if (!list.length) {
    g.insertAdjacentHTML("beforeend", `<p class="hint">None found.</p>`);
    return g;
  }
  const body = document.createElement("div");
  g.appendChild(body);
  let shown = 0;
  const draw = () => {
    shown = Math.min(list.length, shown + (shown ? Infinity : PAGE));
    body.replaceChildren(renderBySyllables(list.slice(0, shown)));
    if (shown < list.length) {
      const more = document.createElement("button");
      more.className = "more";
      more.textContent = `Show all ${list.length}`;
      more.onclick = draw;
      body.appendChild(more);
    }
  };
  draw();
  return g;
}

function renderBySyllables(list) {
  const bySyl = new Map();
  for (const r of list) {
    const k = Math.min(r.syllables, 5);
    if (!bySyl.has(k)) bySyl.set(k, []);
    bySyl.get(k).push(r);
  }
  const frag = document.createDocumentFragment();
  for (const k of [...bySyl.keys()].sort((a, b) => a - b)) {
    const h = document.createElement("h3");
    h.textContent = k === 5 ? "5+ syllables" : `${k} syllable${k === 1 ? "" : "s"}`;
    const words = document.createElement("div");
    words.className = "words";
    for (const r of bySyl.get(k)) {
      const b = document.createElement("button");
      b.className = "word" + (r.entry.common ? "" : " rare");
      b.textContent = r.entry.word;
      b.type = "button";
      words.appendChild(b);
    }
    frag.append(h, words);
  }
  return frag;
}

els.results.addEventListener("click", (e) => {
  const b = e.target.closest(".word");
  if (b) copy(b.textContent);
});

async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = document.createElement("textarea");
    t.value = text; document.body.appendChild(t); t.select();
    try { document.execCommand("copy"); } catch { /* ignore */ }
    t.remove();
  }
  toast(`Copied “${text}”`);
}

let toastTimer;
function toast(msg) {
  // An open dialog sits above the page, so show the message inside it.
  const host = document.querySelector("dialog[open]") || document.body;
  if (els.toast.parentElement !== host) host.appendChild(els.toast);
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), Math.max(1400, msg.length * 60));
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

els.form.addEventListener("submit", (e) => { e.preventDefault(); search(); });
for (const el of [els.perfect, els.near, els.assonance, els.rare, els.syl]) {
  el.addEventListener("change", () => { if (els.query.value.trim()) search(); else store.set("opts", { ...options(), syl: els.syl.value }); });
}

// ---------- tabs ----------
const tabs = [[$("tabRhymes"), $("paneRhymes")], [$("tabThes"), $("paneThes")], [$("tabSuggest"), $("paneSuggest")]];
function showTab(btn) {
  for (const [b, pane] of tabs) {
    b.setAttribute("aria-selected", String(b === btn));
    pane.hidden = b !== btn;
  }
  store.set("tab", btn.id);
  if (btn.id === "tabSuggest") suggest?.refreshTarget();
  if (btn.id === "tabThes") thesaurus?.preload();
}
for (const [b] of tabs) b.addEventListener("click", () => {
  showTab(b);
  // Opening the thesaurus with a word selected in the lyrics looks that word up.
  if (b.id === "tabThes" && els.lyrics.selectionEnd > els.lyrics.selectionStart) thesaurus?.lookupFromEditor();
});
// Looking up rhymes always brings the Rhymes tab forward.
const _search = search;
search = function () { if ($("paneRhymes").hidden) showTab($("tabRhymes")); _search(); };

// ---------- line suggestions ----------
// Replace a range of the textarea in a way that keeps the browser's undo history where possible.
function replaceRange(start, end, text) {
  const t = els.lyrics;
  t.focus();
  t.setSelectionRange(start, end);
  if (!document.execCommand("insertText", false, text)) t.setRangeText(text, start, end, "end");
  els.lyrics.dispatchEvent(new Event("input"));
}
function lineBounds(index) {
  const lines = els.lyrics.value.split("\n");
  let start = 0;
  for (let i = 0; i < index; i++) start += lines[i].length + 1;
  return { start, end: start + (lines[index] ?? "").length };
}
const suggest = safeInit("Suggest lines", () => initSuggest({
  context: () => ({ title: els.title.value.trim(), lines: els.lyrics.value.split("\n") }),
  currentLine: currentLineIndex,
  lineSyllables,
  replaceLine(index, text) {
    const { start, end } = lineBounds(index);
    replaceRange(start, end, text);
    toast(`Replaced line ${index + 1}`);
  },
  insertAfter(index, text) {
    const { end } = lineBounds(index);
    replaceRange(end, end, "\n" + text);
    toast(`Added line ${index + 2}`);
  },
  copy,
  toast,
}));
const thesaurus = safeInit("Thesaurus", () => initThesaurus({
  lexicon: () => lexicon,
  lineSyllables,
  wordAtCursor,
  swapWord({ start, end, word }, replacement) {
    if (els.lyrics.value.slice(start, end) !== word) return false; // the lyrics changed since the lookup
    replaceRange(start, end, replacement);
    toast(`Swapped in “${replacement}”`);
    return true;
  },
  copy,
  toast,
}));
const drive = safeInit("Google Drive", () => initDrive({
  title: () => els.title.value,
  text: () => els.lyrics.value,
  // Replace the whole song (opening one from Drive, or starting a new one).
  load({ title, text }) {
    clearTimeout(saveTimer);
    els.title.value = title;
    els.lyrics.value = text;
    store.set("title", title);
    store.set("text", text);
    els.lyrics.setSelectionRange(0, 0);
    els.scroll.scrollTop = 0;
    renderEditor();
  },
  focus: () => els.lyrics.focus(),
  download: downloadTxt,
  toast,
}));
{
  const saved = store.get("tab", "tabRhymes");
  showTab($(saved) || $("tabRhymes"));
}

// ---------- start ----------
(function restore() {
  els.title.value = store.get("title", "");
  els.lyrics.value = store.get("text", "");
  const o = store.get("opts", null);
  if (o) {
    els.perfect.checked = !!o.perfect; els.near.checked = !!o.near;
    els.assonance.checked = !!o.assonance; els.rare.checked = !!o.rare; els.syl.value = o.syl || "";
  }
  renderEditor();
})();
drive?.ready();

fetch("data/dict.txt" + VERSION)
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); })
  .then((text) => {
    lexicon = new Lexicon(text);
    sylCache.clear();
    els.status.textContent = `${lexicon.entries.length.toLocaleString()} words loaded`;
    renderEditor();
    if (pendingQuery) search();
  })
  .catch((err) => {
    els.status.textContent = "Couldn’t load the dictionary — syllable counts are estimates.";
    console.error(err);
  });
