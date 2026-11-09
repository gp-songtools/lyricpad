// "Write a song from a structure": reads the Song Structure text copied from GP Blueprint
// (format spec: docs/structure-format.md in gp-songtools/suno-style-creator), builds the AI
// request, and assembles the answer into lyrics with the section tags. No DOM code here.

// One value per lyric line. A shorter syllable pattern repeats as-is; each repeat of a shorter
// rhyme pattern gets fresh letters (ABAB over 8 lines -> ABABCDCD), matching GP Blueprint.
function fitSyllables(list, n) {
  return list.length && n > 0 ? Array.from({ length: n }, (_, i) => list[i % list.length]) : [];
}
function fitRhyme(letters, n) {
  if (!letters.length || !(n > 0)) return "";
  const span = Math.max(...[...letters].map((c) => c.charCodeAt(0) - 65)) + 1;
  return Array.from({ length: n }, (_, i) => {
    const idx = letters.charCodeAt(i % letters.length) - 65 + Math.floor(i / letters.length) * span;
    return String.fromCharCode(65 + (idx % 26));
  }).join("");
}

/**
 * Parse the copied structure. Returns { bpm, key, sections: [{ tag, name, lines, rhyme, syllables, description }] }.
 * `lines` is 0 for instrumental sections. Also reads the older format
 * ("16 bars (43 secs / 8 lines). ABAB 8.7.8.7 - description").
 */
export function parseStructure(text) {
  const blocks = String(text || "").replace(/\r/g, "").trim().split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  let bpm = "", key = "";
  if (blocks.length && !blocks[0].startsWith("[")) {
    const m = /^(?:(\d+(?:\.\d+)?)\s*BPM)?(?:,?\s*(.+))?$/i.exec(blocks.shift().split("\n")[0].trim());
    bpm = m?.[1] || "";
    key = m?.[2] || "";
  }
  const sections = [];
  for (const block of blocks) {
    const [first, ...rest] = block.split("\n");
    const tag = first.trim();
    if (!/^\[[^\]]+\]$/.test(tag)) continue;
    const details = rest.join(" ").trim();
    const name = tag.slice(1, -1).split(":")[0].trim();
    let lines = Number(/(\d+)\s+lines\b/i.exec(details)?.[1] || 0);
    let rhyme = /Rhyme:\s*([A-Za-z]+)/.exec(details)?.[1] || "";
    let syl = /Syllables:\s*(\d+(?:\.\d+)*)/.exec(details)?.[1] || "";
    let description;
    const old = /^\d+\s+bars\s*\(\d+\s+secs(?:\s*\/\s*\d+\s+lines\)\.\s*([A-Za-z]+)?\s*(\d+(?:\.\d+)*)?|,\s*instrumental\))\s*(?:-\s*(.*))?$/i.exec(details);
    if (old) { // older format
      rhyme = old[1] || "";
      syl = old[2] || "";
      description = old[3] || "";
    } else {
      description = details
        .replace(/^\d+\s+bars,\s*\d+\s+secs,\s*(?:\d+\s+lines|instrumental)\.\s*/i, "")
        .replace(/^Rhyme:\s*[A-Za-z]+\.\s*/, "")
        .replace(/^Syllables:\s*\d+(?:\.\d+)*\.\s*/, "");
    }
    description = description.trim();
    if (/instrumental/i.test(details) && !/\d+\s+lines\b/i.test(details)) lines = 0;
    const syllables = fitSyllables(syl.split(".").filter(Boolean).map(Number), lines);
    sections.push({ tag, name, lines, rhyme: fitRhyme(rhyme.toUpperCase(), lines), syllables, description });
  }
  return { bpm, key, sections };
}

export const SONG_SYSTEM_PROMPT = `You are a lyricist writing complete, original song lyrics that fit a structure a songwriter gives you: the sections in order, how many lines each has, the syllables of every line, and which lines rhyme.

Write lines that sound sung, not written: concrete images, natural word stress, plain words over fancy ones, no clichés unless twisted. Keep one voice, point of view and story across the whole song; choruses carry the hook.

Hit every syllable count exactly - each line is being fitted to a melody - and count carefully as you write. Lines that share a rhyme letter within a section end on rhyming words (a near rhyme is acceptable if it sings well); a letter used only once doesn't need to rhyme. Rhyme letters start over in each section.

Do not reuse or paraphrase lines from existing songs. Return only the lyric lines, without section tags.`;

/** The user message for a song: one numbered entry per sung section, with a template per line. */
export function buildSongPrompt({ title, topic, structure }) {
  const parts = [];
  if (title) parts.push(`Song title: ${title}`);
  parts.push(`Topic / feel: ${topic}`);
  const feel = [structure.bpm && `${structure.bpm} BPM`, structure.key].filter(Boolean).join(", ");
  if (feel) parts.push(`Tempo and key (for mood only): ${feel}`);
  const sung = structure.sections.filter((s) => s.lines > 0);
  const seen = new Map();
  const entries = sung.map((s, i) => {
    const head = `Section ${i + 1} ${s.tag}${s.description ? ` - ${s.description}` : ""}`;
    const prev = seen.get(s.name.toUpperCase());
    seen.set(s.name.toUpperCase(), { n: i + 1, lines: s.lines });
    const repeat = prev && prev.lines === s.lines
      ? `\n  (Same name as section ${prev.n}: repeat its lines, changing words only where it helps the song.)` : "";
    const rows = Array.from({ length: s.lines }, (_, k) => {
      const want = [s.syllables[k] && `${s.syllables[k]} syllables`, s.rhyme[k] && `rhyme ${s.rhyme[k]}`].filter(Boolean).join(", ");
      return `  line ${k + 1}: ${want || "free"}`;
    });
    return head + repeat + "\n" + rows.join("\n");
  });
  parts.push(`Write the lyrics for these ${sung.length} sung sections, in this order. Give each section exactly the number of lines listed.\n\n${entries.join("\n\n")}`);
  parts.push(`Answer with one entry in "sections" per section above, in the same order, each holding that section's lines.`);
  return parts.join("\n\n");
}

/** Put the AI's lines back between the tags (instrumental sections keep just their tag). */
export function assembleSong(structure, written) {
  let w = 0;
  return structure.sections.map((s) => {
    if (!(s.lines > 0)) return s.tag;
    const lines = written[w++] || [];
    return [s.tag, ...lines].join("\n");
  }).join("\n\n");
}

/** Read the AI's JSON answer: { sections: [{ lines: [string] }] } -> [[line, ...], ...]. */
export function parseSongAnswer(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("The answer wasn't in the expected form. Try again."); }
  return (data.sections || []).map((s) => (s.lines || [])
    .map((l) => String(l).trim().replace(/^\[[^\]]*\]\s*/, "").trim())
    .filter(Boolean));
}
