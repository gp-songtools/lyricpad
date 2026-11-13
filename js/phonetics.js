// Pronunciation data, syllable counting and rhyme search.
// Data comes from the CMU Pronouncing Dictionary (data/dict.txt, built by
// tools/build_dict.py), ordered by how common each word is.

const VOWELS = new Set(["AA","AE","AH","AO","AW","AY","EH","ER","EY","IH","IY","OW","OY","UH","UW"]);

// Consonant features for scoring near rhymes: [manner, place, voiced]
const CONS = {
  P:["stop","lab",0], B:["stop","lab",1], T:["stop","alv",0], D:["stop","alv",1],
  K:["stop","vel",0], G:["stop","vel",1],
  CH:["affr","pal",0], JH:["affr","pal",1],
  F:["fric","lab",0], V:["fric","lab",1], TH:["fric","den",0], DH:["fric","den",1],
  S:["fric","alv",0], Z:["fric","alv",1], SH:["fric","pal",0], ZH:["fric","pal",1], HH:["fric","glot",0],
  M:["nasal","lab",1], N:["nasal","alv",1], NG:["nasal","vel",1],
  L:["liquid","alv",1], R:["liquid","alv",1], W:["glide","lab",1], Y:["glide","pal",1],
};
// Vowels that sound close enough to pass in a slant rhyme.
const VOWEL_GROUPS = [
  ["IY","IH"], ["EH","AE","EY"], ["AH","UH","ER"], ["AA","AO","AH"], ["UW","UH"],
  ["OW","AO","UW"], ["AY","AA"], ["AW","AA"], ["OY","AO"],
];

const LIGHT_WORDS = new Set("me you him her it them us up in on out a the to of and so too now down".split(" "));

// How far apart two rhyme tails may be (weighted sound distance) and still count as a near rhyme.
const NEAR_LIMIT = 1.05;

const strip = (p) => p.replace(/\d/g, "");
const isVowel = (p) => VOWELS.has(strip(p));

function vowelCost(a, b) {
  if (a === b) return 0;
  return VOWEL_GROUPS.some((g) => g.includes(a) && g.includes(b)) ? 0.5 : 1;
}
function consCost(a, b) {
  if (a === b) return 0;
  const x = CONS[a], y = CONS[b];
  if (!x || !y) return 1;
  if (x[0] === y[0]) return x[1] === y[1] || x[2] === y[2] ? 0.35 : 0.55;
  if ((x[0] === "stop" && y[0] === "affr") || (x[0] === "affr" && y[0] === "stop") ||
      (x[0] === "fric" && y[0] === "affr") || (x[0] === "affr" && y[0] === "fric")) return 0.6;
  return 1;
}
function subCost(a, b) {
  const va = VOWELS.has(a), vb = VOWELS.has(b);
  if (va !== vb) return 9;
  return va ? vowelCost(a, b) : consCost(a, b);
}
const indelCost = (p) => (VOWELS.has(p) ? 1.2 : ["T","D","S","Z","N"].includes(p) ? 0.45 : 0.6);

// Weighted edit distance between two rhyme tails (arrays of stress-less phones).
// The first phone of each tail is the stressed vowel; a mismatch there counts extra.
function tailDistance(a, b, limit) {
  const n = a.length, m = b.length;
  let prev = new Array(m + 1), cur = new Array(m + 1);
  prev[0] = 0;
  for (let j = 1; j <= m; j++) prev[j] = prev[j - 1] + indelCost(b[j - 1]);
  for (let i = 1; i <= n; i++) {
    cur[0] = prev[0] + indelCost(a[i - 1]);
    let rowMin = cur[0];
    for (let j = 1; j <= m; j++) {
      let s = subCost(a[i - 1], b[j - 1]);
      if (i === 1 && j === 1) s *= 1.6;
      cur[j] = Math.min(prev[j - 1] + s, prev[j] + indelCost(a[i - 1]), cur[j - 1] + indelCost(b[j - 1]));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > limit) return Infinity;
    [prev, cur] = [cur, prev];
  }
  return prev[m];
}

// Index of the vowel a rhyme starts on: last primary stress, else last secondary, else last vowel.
function rhymeStart(phones) {
  for (const mark of ["1", "2", ""]) {
    for (let i = phones.length - 1; i >= 0; i--) {
      if (isVowel(phones[i]) && (mark === "" || phones[i].endsWith(mark))) return i;
    }
  }
  return -1;
}

export class Lexicon {
  constructor(text) {
    this.map = new Map(); // word -> entry
    this.entries = [];
    const lines = text.split("\n");
    const common = parseInt(lines[0].split(" ")[1], 10);
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const sp = line.indexOf(" ");
      let word = line.slice(0, sp);
      const hidden = word[0] === "!"; // names, abbreviations: syllables only, never offered as rhymes
      if (hidden) word = word.slice(1);
      const phones = line.slice(sp + 1).split(" ");
      const paren = word.indexOf("(");
      if (paren > 0) word = word.slice(0, paren);
      let e = this.map.get(word);
      if (!e) {
        const rank = this.entries.length;
        e = { word, rank, common: rank < common, prons: [] };
        // Only plain words (letters + apostrophes) are offered as rhyme results.
        e.listable = !hidden;
        this.map.set(word, e);
        this.entries.push(e);
      }
      e.prons.push(this.#analyse(phones));
    }
    this.byKey = new Map();
    for (const e of this.entries) {
      if (!e.listable) continue;
      for (const p of e.prons) {
        if (!p.tail.length) continue;
        let list = this.byKey.get(p.key);
        if (!list) this.byKey.set(p.key, (list = []));
        if (list[list.length - 1] !== e) list.push(e);
      }
    }
  }

  #analyse(phones) {
    const syllables = phones.filter(isVowel).length;
    const start = rhymeStart(phones);
    const tail = start < 0 ? [] : phones.slice(start).map(strip);
    return {
      phones, syllables, tail,
      key: tail.join(" "),
      vowels: tail.filter((p) => VOWELS.has(p)).join(" "),
      full: phones.map(strip).join(" "),
    };
  }

  // Find a dictionary entry, forgiving common lyric spellings (lovin', 'cause, goin).
  lookup(raw) {
    let w = raw.toLowerCase().replace(/[‘’ʼ`]/g, "'").replace(/^[^a-z']+|[^a-z']+$/g, "");
    if (!w) return null;
    const bare = w.replace(/^'+|'+$/g, "");
    const tries = [w, bare];
    // "lovin'" -> "loving"; bare "lovin" too, unless it's a common word in its own right
    if (/in'$/.test(w)) tries.unshift(bare + "g");
    else if (/..in$/.test(w)) {
      const asIs = this.map.get(w), ing = this.map.get(w + "g");
      if (ing && (!asIs || ing.rank * 5 < asIs.rank)) tries.unshift(w + "g");
    }
    if (/s'$/.test(w)) tries.push(bare);
    if (/'s$/.test(bare)) tries.push(bare.slice(0, -2));
    for (const t of tries) {
      const e = this.map.get(t);
      if (e) {
        // "'s" stripped: add one syllable only after sibilants (e.g. "rose's").
        if (t !== bare && /'s$/.test(bare) && t === bare.slice(0, -2)) {
          const extra = /(s|z|x|ch|sh|ge|ce)$/.test(t) ? 1 : 0;
          return { ...e, prons: e.prons.map((p) => ({ ...p, syllables: p.syllables + extra })) };
        }
        return e;
      }
    }
    return null;
  }

  // Syllable count for one word: {min, max, guessed}
  syllables(word) {
    const e = this.lookup(word);
    if (e) {
      const counts = e.prons.map((p) => p.syllables);
      return { min: Math.min(...counts), max: Math.max(...counts), guessed: false };
    }
    const g = guessSyllables(word);
    return { min: g, max: g, guessed: true };
  }

  // Build the rhyme target for a word or short phrase.
  target(query) {
    const words = query.toLowerCase().split(/[\s\-—–/]+/).filter((w) => /[a-z]/.test(w));
    if (!words.length) return null;
    const phones = [];
    let guessedFrom = null;
    for (let i = 0; i < words.length; i++) {
      let e = this.lookup(words[i]);
      if (!e && i === words.length - 1) {
        e = this.#guessBySpelling(words[i]);
        if (e) guessedFrom = e.word;
      }
      if (!e) {
        if (i === words.length - 1) return null;
        continue;
      }
      phones.push(...e.prons[0].phones);
    }
    const last = this.lookup(words[words.length - 1]);
    const prons = [this.#analyse(phones)];
    // "phone me", "hold you": an unstressed little word at the end doesn't move the rhyme.
    if (words.length > 1 && last && last.prons[0].syllables === 1 && LIGHT_WORDS.has(words[words.length - 1])) {
      const lastLen = last.prons[0].phones.length;
      const head = phones.slice(0, phones.length - lastLen);
      const start = rhymeStart(head);
      if (start >= 0) {
        const tail = phones.slice(start).map(strip);
        prons[0] = { ...prons[0], tail, key: tail.join(" "), vowels: tail.filter((x) => VOWELS.has(x)).join(" ") };
      }
    }
    // For a single word, try every pronunciation (e.g. "read", "live").
    if (words.length === 1 && last) prons.splice(0, 1, ...last.prons);
    return { words, prons, guessedFrom, self: words.length === 1 ? words[0] : null };
  }

  #guessBySpelling(word) {
    const w = word.replace(/[^a-z]/g, "");
    for (let len = Math.min(w.length - 1, 6); len >= 2; len--) {
      const suffix = w.slice(-len);
      for (const e of this.entries) {
        if (!e.common) break;
        if (e.word.length > len && e.word.endsWith(suffix)) return e;
      }
    }
    return null;
  }

  // How a word or phrase rhymes with a target: "perfect", "near" or null.
  // Phrases rhyme on their last word.
  rhymeKind(target, term) {
    const last = term.trim().split(/[\s-]+/).pop();
    const e = this.lookup(last);
    if (!e) return null;
    if (e.word === target.self) return null;
    const keys = new Set(target.prons.map((p) => p.key).filter(Boolean));
    if (e.prons.some((p) => keys.has(p.key))) return "perfect";
    for (const p of e.prons) {
      for (const t of target.prons) {
        if (!p.tail.length || !t.tail.length || Math.abs(p.tail.length - t.tail.length) > 2) continue;
        if (tailDistance(t.tail, p.tail, NEAR_LIMIT) <= NEAR_LIMIT) return "near";
      }
    }
    return null;
  }

  // How two dictionary entries rhyme with each other: "perfect", "near" or null.
  rhymeBetween(a, b) {
    if (!a || !b || a.word === b.word) return null;
    for (const p of a.prons) for (const q of b.prons) if (p.tail.length && p.key === q.key) return "perfect";
    for (const p of a.prons) {
      for (const q of b.prons) {
        if (!p.tail.length || !q.tail.length || Math.abs(p.tail.length - q.tail.length) > 2) continue;
        if (tailDistance(p.tail, q.tail, NEAR_LIMIT) <= NEAR_LIMIT) return "near";
      }
    }
    return null;
  }

  // Returns {perfect: [...], near: [...], assonance: [...]}, each item {entry, syllables, score}
  rhymes(target, { perfect = true, near = true, assonance = false, rare = false } = {}) {
    const out = { perfect: [], near: [], assonance: [] };
    const seen = new Set();
    const fulls = new Set(target.prons.map((p) => p.full));
    const keys = new Set(target.prons.map((p) => p.key).filter(Boolean));
    const ok = (e) => e.listable && (rare || e.common) && e.word !== target.self &&
      !e.prons.some((p) => fulls.has(p.full)) && !seen.has(e);

    for (const key of keys) {
      for (const e of this.byKey.get(key) || []) {
        if (!ok(e)) continue;
        seen.add(e);
        if (perfect) out.perfect.push({ entry: e, syllables: e.prons[0].syllables, score: 0 });
      }
    }
    if (!near && !assonance) return out;

    const tails = target.prons.filter((p) => p.tail.length);
    for (const e of this.entries) {
      if (!ok(e)) continue;
      let best = Infinity, vowelMatch = false;
      for (const p of e.prons) {
        if (!p.tail.length) continue;
        for (const t of tails) {
          if (Math.abs(p.tail.length - t.tail.length) > 2) continue;
          if (near) best = Math.min(best, tailDistance(t.tail, p.tail, NEAR_LIMIT));
          if (p.vowels === t.vowels) vowelMatch = true;
        }
      }
      if (near && best <= NEAR_LIMIT) {
        out.near.push({ entry: e, syllables: e.prons[0].syllables, score: best });
        seen.add(e);
      } else if (assonance && vowelMatch) {
        out.assonance.push({ entry: e, syllables: e.prons[0].syllables, score: 0 });
        seen.add(e);
      }
    }
    out.near.sort((a, b) => a.score - b.score || a.entry.rank - b.entry.rank);
    return out;
  }
}

// Spelling-based estimate for words missing from the dictionary.
export function guessSyllables(raw) {
  let w = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = w.match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}
