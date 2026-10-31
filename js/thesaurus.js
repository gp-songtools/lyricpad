// Thesaurus tab: synonyms for a word, grouped by meaning (WordNet) plus a wider pool of
// related words (Moby Thesaurus), optionally limited to words that rhyme with another word.
// Data: data/thesaurus.txt, built by tools/build_thesaurus.py, loaded the first time the tab opens.

const POS_LABEL = { n: "noun", v: "verb", adj: "adjective", adv: "adverb" };
const PAGE = 60;

class Thesaurus {
  constructor(text) {
    const lines = text.split("\n");
    let section = null;
    this.words = [];
    this.senses = [];
    this.wordnet = new Map();
    this.moby = new Map();
    this.index = new Map();
    const refs = (s) => s.split(",").map((x) => parseInt(x, 36));
    for (const line of lines) {
      if (!line) continue;
      if (line[0] === "#") { section = line; continue; }
      if (section === "#WORDS") {
        this.index.set(line, this.words.length);
        this.words.push(line);
      } else if (section === "#SENSES") {
        const [pos, gloss, ws] = line.split("|");
        this.senses.push({ pos, gloss, words: ws });
      } else {
        const colon = line.indexOf(":");
        const key = parseInt(line.slice(0, colon), 36);
        (section === "#WORDNET" ? this.wordnet : this.moby).set(key, line.slice(colon + 1));
      }
    }
    this.refs = refs;
  }

  // Base forms to try for an inflected word: "running" -> "run", "cried" -> "cry", "hearts" -> "heart".
  #candidates(word) {
    const w = word.toLowerCase().replace(/[‘’]/g, "'").replace(/^[^a-z]+|[^a-z]+$/g, "");
    const out = [w];
    const add = (x) => { if (x && x.length > 1 && !out.includes(x)) out.push(x); };
    if (w.endsWith("in'")) add(w.slice(0, -1) + "g");
    if (w.endsWith("'s")) add(w.slice(0, -2));
    for (const [suf, reps] of [
      ["ies", ["y"]], ["ied", ["y"]], ["ier", ["y"]], ["iest", ["y"]], ["ily", ["y"]],
      ["ing", ["", "e"]], ["ed", ["", "e"]], ["es", ["", "e"]], ["s", [""]], ["er", ["", "e"]], ["est", ["", "e"]], ["ly", [""]],
    ]) {
      if (!w.endsWith(suf) || w.length < suf.length + 2) continue;
      const stem = w.slice(0, -suf.length);
      for (const r of reps) add(stem + r);
      if (/(.)\1$/.test(stem)) add(stem.slice(0, -1)); // running -> run
    }
    return out;
  }

  lookup(word) {
    for (const base of this.#candidates(word)) {
      const i = this.index.get(base);
      if (i === undefined || (!this.wordnet.has(i) && !this.moby.has(i))) continue;
      const senses = (this.wordnet.get(i) ? this.refs(this.wordnet.get(i)) : []).map((s) => {
        const sense = this.senses[s];
        // Meanings are shared between words, so drop the looked-up word itself here.
        return { pos: sense.pos, gloss: sense.gloss, words: this.refs(sense.words).map((k) => this.words[k]).filter((w) => w !== base) };
      }).filter((s) => s.words.length);
      const inSenses = new Set(senses.flatMap((s) => s.words));
      const related = (this.moby.get(i) ? this.refs(this.moby.get(i)) : [])
        .map((k) => this.words[k]).filter((w) => !inSenses.has(w));
      return { base, senses, related };
    }
    return null;
  }

  // Synonyms of the closest synonyms: a wider (looser) pool, used when hunting for a rhyme.
  wider(res, firstN = 25, secondN = 40) {
    const direct = new Set([res.base, ...res.senses.flatMap((s) => s.words), ...res.related]);
    const out = new Set();
    for (const w of [...res.senses.flatMap((s) => s.words), ...res.related.slice(0, firstN)]) {
      const r = this.lookup(w);
      if (!r || r.base !== w) continue;
      for (const x of [...r.senses.flatMap((s) => s.words), ...r.related.slice(0, secondN)]) {
        if (!direct.has(x)) out.add(x);
      }
    }
    return [...out];
  }
}

export function initThesaurus(editor) {
  const $ = (id) => document.getElementById(id);
  const els = {
    form: $("thesForm"), query: $("thesQuery"), rhyme: $("thesRhyme"), perfect: $("thesPerfect"),
    near: $("thesNear"), out: $("thesOut"), useSel: $("thesUseSelection"),
  };
  let data = null, loading = null;
  let source = null; // where the looked-up word sits in the lyrics, so a click can swap it

  function load() {
    loading ||= fetch(new URL("../data/thesaurus.txt", import.meta.url))
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then((t) => (data = new Thesaurus(t)))
      .catch((err) => { loading = null; throw err; });
    return loading;
  }

  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem("lyricpad:thes:" + k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("lyricpad:thes:" + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };
  els.perfect.checked = store.get("perfect", true);
  els.near.checked = store.get("near", true);

  async function search() {
    const q = els.query.value.trim();
    if (!q) return;
    if (!data) {
      els.out.innerHTML = `<p class="hint">Loading thesaurus…</p>`;
      try { await load(); } catch {
        els.out.innerHTML = `<p class="error">Couldn’t load the thesaurus. Check your connection and try again.</p>`;
        return;
      }
    }
    const lex = editor.lexicon();
    const res = data.lookup(q);
    if (!res) {
      els.out.innerHTML = "";
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = `No synonyms found for “${q}”.`;
      els.out.appendChild(p);
      return;
    }
    // Optional rhyme filter
    const rhymeWith = els.rhyme.value.trim();
    let kind = () => "any";
    let target = null;
    if (rhymeWith) {
      if (!lex) { els.out.innerHTML = `<p class="hint">Loading dictionary…</p>`; return; }
      target = lex.target(rhymeWith);
      if (!target) {
        els.out.innerHTML = "";
        const p = document.createElement("p");
        p.className = "error";
        p.textContent = `Couldn’t work out how “${rhymeWith}” sounds.`;
        els.out.appendChild(p);
        return;
      }
      if (!els.perfect.checked && !els.near.checked) {
        els.out.innerHTML = `<p class="hint">Tick Perfect or Near to filter by rhyme.</p>`;
        return;
      }
      const cache = new Map();
      kind = (w) => {
        if (!cache.has(w)) {
          const k = lex.rhymeKind(target, w);
          cache.set(w, (k === "perfect" && els.perfect.checked) || (k === "near" && els.near.checked) ? k : null);
        }
        return cache.get(w);
      };
    }
    render(q, res, kind, rhymeWith);
  }

  function render(q, res, kind, rhymeWith) {
    const frag = document.createDocumentFragment();
    const note = document.createElement("p");
    note.className = "hint small";
    const bits = [];
    if (res.base !== q.toLowerCase()) bits.push(`Showing synonyms for “${res.base}”.`);
    if (rhymeWith) bits.push(`Only words that rhyme with “${rhymeWith}”${els.near.checked && els.perfect.checked ? " (near rhymes in italics)" : ""}.`);
    bits.push(source ? "Click a word to swap it into your lyrics." : "Click a word to copy it.");
    note.textContent = bits.join(" ");
    frag.appendChild(note);

    let total = 0;
    const filter = (list) => {
      const kept = list.map((w) => ({ w, k: kind(w) })).filter((x) => x.k);
      if (rhymeWith) kept.sort((a, b) => (a.k === "perfect" ? 0 : 1) - (b.k === "perfect" ? 0 : 1));
      return kept;
    };

    // Meanings in WordNet's order (most common sense first); empty ones are skipped.
    for (const sense of res.senses) {
      const kept = filter(sense.words);
      if (!kept.length) continue;
      total += kept.length;
      const g = document.createElement("section");
      g.className = "sense";
      const h = document.createElement("h3");
      h.innerHTML = `<span class="pos"></span> <span class="gloss"></span>`;
      h.querySelector(".pos").textContent = POS_LABEL[sense.pos] || sense.pos;
      h.querySelector(".gloss").textContent = sense.gloss;
      g.append(h, wordList(kept, Infinity));
      frag.appendChild(g);
    }
    const related = filter(res.related);
    if (related.length) {
      total += related.length;
      const g = document.createElement("section");
      g.className = "sense";
      const h = document.createElement("h3");
      h.innerHTML = `<span class="pos">related</span> <span class="gloss">more words with a similar meaning</span>`;
      g.append(h, wordList(related, PAGE));
      frag.appendChild(g);
    }
    // Hunting for a rhyme: also look one step further out, shown separately because the meaning drifts.
    if (rhymeWith) {
      const further = filter(data.wider(res));
      if (further.length) {
        total += further.length;
        const g = document.createElement("section");
        g.className = "sense";
        const h = document.createElement("h3");
        h.innerHTML = `<span class="pos">further afield</span> <span class="gloss">synonyms of synonyms — check the meaning fits</span>`;
        g.append(h, wordList(further, PAGE));
        frag.appendChild(g);
      }
    }
    if (!total) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = rhymeWith
        ? `None of the synonyms for “${res.base}” rhyme with “${rhymeWith}”.` + (els.near.checked ? "" : " Try ticking Near.")
        : `No synonyms found for “${res.base}”.`;
      frag.appendChild(p);
    }
    els.out.replaceChildren(frag);
    els.out.scrollTop = 0;
  }

  function wordList(items, limit) {
    const wrap = document.createElement("div");
    const box = document.createElement("div");
    box.className = "words";
    wrap.appendChild(box);
    let shown = 0;
    const draw = () => {
      const next = Math.min(items.length, shown === 0 ? limit : Infinity);
      for (const { w, k } of items.slice(shown, next)) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "word" + (k === "near" ? " near" : "");
        b.dataset.word = w;
        b.textContent = w;
        const s = editor.lineSyllables(w);
        if (s) {
          const sup = document.createElement("sup");
          sup.textContent = s.min === s.max ? s.min : `${s.min}–${s.max}`;
          b.appendChild(sup);
        }
        box.appendChild(b);
      }
      shown = next;
      wrap.querySelector(".more")?.remove();
      if (shown < items.length) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "more";
        more.textContent = `Show all ${items.length}`;
        more.onclick = draw;
        wrap.appendChild(more);
      }
    };
    draw();
    return wrap;
  }

  els.out.addEventListener("click", (e) => {
    const b = e.target.closest(".word");
    if (!b) return;
    const w = b.dataset.word;
    const replacement = source ? matchCase(source.word, w) : w;
    if (source && editor.swapWord(source, replacement)) {
      // Keep tracking the swapped-in word so another click can swap again.
      source = { start: source.start, end: source.start + replacement.length, word: replacement };
    } else {
      source = null;
      editor.copy(w);
    }
  });

  function matchCase(original, w) {
    if (original === original.toUpperCase() && original.length > 1) return w.toUpperCase();
    if (original[0] === original[0].toUpperCase()) return w[0].toUpperCase() + w.slice(1);
    return w;
  }

  els.form.addEventListener("submit", (e) => { e.preventDefault(); source = null; search(); });
  els.rhyme.addEventListener("change", search);
  for (const el of [els.perfect, els.near]) {
    el.addEventListener("change", () => { store.set("perfect", els.perfect.checked); store.set("near", els.near.checked); search(); });
  }

  // Look up a word that's in the lyrics (from a double-click or the "selected word" button).
  function lookupFromEditor() {
    const sel = editor.wordAtCursor();
    if (!sel) return editor.toast("Put the cursor on a word first");
    source = sel;
    els.query.value = sel.word;
    search();
  }
  els.useSel.addEventListener("click", lookupFromEditor);

  return { lookupFromEditor, preload: () => load().catch(() => {}) };
}
