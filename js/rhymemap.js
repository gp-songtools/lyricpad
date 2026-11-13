// Finds rhyming words in the lyrics so the editor can colour them.
// Words that rhyme (perfect or near) within a few lines of each other share a colour group.

// Little words that would light up everywhere in "All words" mode. They still count at a line's end.
const SKIP = new Set(("a an the and or but if of to in on at by for from with as is am are was were be been " +
  "i i'm i'd i'll i've it it's its this that my your our their his her he she we they them us you me " +
  "do does did not no so oh ooh yeah uh").split(" "));

const WINDOW = { ends: 4, all: 2 }; // how many lyric lines apart two words may be and still rhyme
const WORD = /[a-z]+(?:['’][a-z]+)*['’]?/gi;
export const RHYME_COLOURS = 8;

// lines: array of strings. Returns one array per line of {start, end, group} (group = colour index).
export function findRhymes(lexicon, lines, mode) {
  const out = lines.map(() => []);
  if (!lexicon || (mode !== "ends" && mode !== "all")) return out;

  // Collect candidate words with their lyric-line number (tag-only and blank lines don't count).
  const words = [];
  let lyricLine = -1;
  lines.forEach((line, i) => {
    const clean = line.replace(/\[[^\]]*\]?/g, (m) => " ".repeat(m.length));
    const found = [...clean.matchAll(WORD)];
    if (!found.length) return;
    lyricLine++;
    found.forEach((m, k) => {
      const last = k === found.length - 1;
      if (mode === "ends" && !last) return;
      const lower = m[0].toLowerCase().replace(/’/g, "'");
      if (mode === "all" && !last && (SKIP.has(lower) || lower.length < 2)) return;
      const entry = lexicon.lookup(m[0]);
      if (!entry) return;
      words.push({ line: i, lyricLine, start: m.index, end: m.index + m[0].length, entry });
    });
  });

  // Union words that rhyme within the window.
  const parent = words.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const cache = new Map();
  const rhymes = (a, b) => {
    const k = a.word < b.word ? a.word + "|" + b.word : b.word + "|" + a.word;
    if (!cache.has(k)) cache.set(k, !!lexicon.rhymeBetween(a, b));
    return cache.get(k);
  };
  const win = WINDOW[mode];
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length && words[j].lyricLine - words[i].lyricLine <= win; j++) {
      const a = words[i].entry, b = words[j].entry;
      // The same word again joins its group, but doesn't make a rhyme on its own.
      if (a.word === b.word || rhymes(a, b)) {
        const x = find(i), y = find(j);
        if (x !== y) parent[y] = x;
      }
    }
  }

  // A group needs at least two different words. Colours go in order of first appearance.
  const members = new Map();
  words.forEach((w, i) => {
    const r = find(i);
    if (!members.has(r)) members.set(r, []);
    members.get(r).push(w);
  });
  let next = 0;
  for (const list of members.values()) {
    if (new Set(list.map((w) => w.entry.word)).size < 2) continue;
    const group = next++ % RHYME_COLOURS;
    for (const w of list) out[w.line].push({ start: w.start, end: w.end, group });
  }
  for (const l of out) l.sort((a, b) => a.start - b.start);
  return out;
}
