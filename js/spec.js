// Lyricpad's side of the GP Song Tools song spec (format: gp-songtools/toolsmenu songspec/SPEC.md).
// Lyricpad owns Lyrics (with [section] tags, ready for Suno) and the title. It only reads the
// structures (GP Blueprint's Structure, Idea Wizard's Idea structure) and Idea Wizard's Idea, and
// works the same without them. No DOM code here.
import "./songspec.js?v=10e96921"; // copy of gp-songtools/toolsmenu songspec/songspec.js; sets globalThis.SongSpec

export const SongSpec = globalThis.SongSpec;
export const TOOL = "lyricpad";
const S = SongSpec;

const field = (body, label) => (new RegExp(`^${label}:[ \\t]*(.+)$`, "mi").exec(body)?.[1] || "").trim();
const clip = (t) => t.replace(/[.\s]+$/, "");

/** Idea Wizard's idea as one Topic / feel line: "Title: topic. Angle: … Hook: … Theme: …". */
export function ideaTopic(body) {
  const title = field(body, "Title"), topic = field(body, "Topic");
  const bits = [
    topic ? clip(title ? `${title}: ${topic}` : topic) : "",
    field(body, "Angle") && `Angle: ${clip(field(body, "Angle"))}`,
    field(body, "Hook") && `Hook: ${clip(field(body, "Hook"))}`,
    field(body, "Theme") && `Theme: ${clip(field(body, "Theme"))}`,
  ].filter(Boolean);
  return bits.length ? bits.join(". ") + "." : "";
}

/**
 * What the song spec offers, all optional:
 * structure = SongSpec.pickStructure (id of the default, every option, a note on which is newer/out of date),
 * topic and title from Idea Wizard's Idea. Each is null/empty when missing.
 */
export function specInputs(doc) {
  const idea = S.section(doc, "idea");
  const topic = idea ? ideaTopic(idea.body) : "";
  const title = idea ? field(idea.body, "Title") : "";
  return {
    structure: S.pickStructure(doc),
    topic: topic ? { text: topic, by: idea.by } : null,
    title: title ? { text: title, by: idea.by } : null,
  };
}

const same = (a, b) => !!S.normalize(a) && S.normalize(a) === S.normalize(b);

/** The spec sections the boxes currently hold: a structure whose text is in the structure box, the Idea's topic. */
export function usedSections(inputs, { structureText = "", topicText = "" }) {
  const used = inputs.structure.options.filter((o) => same(structureText, o.body)).map((o) => o.id);
  if (inputs.topic && same(topicText, inputs.topic.text)) used.push("idea");
  return used;
}

/** Problems worth a warning before the lyrics go to the song spec (and from there to Suno). */
export function lyricsProblems(lyrics) {
  const text = S.normalize(lyrics);
  const out = [];
  if (!/^\s*\[[^\]]+\]/m.test(text)) out.push("notags");
  if ([...text].length > 5000) out.push("toolong");
  return out;
}

/** Write the lyrics (exactly as written, tags kept) and the title. `used` = spec sections they came from. */
export function specWriteLyrics(doc, { title = "", lyrics, used = [], at } = {}) {
  S.setSection(doc, "lyrics", lyrics, { by: TOOL, from: used, at });
  S.setSetting(doc, "title", title.trim(), { by: TOOL });
  return doc;
}

/** Why to ask before replacing the Lyrics already in the spec ('' = just write). */
export const overwriteReason = (doc) => S.confirmReason(doc, "lyrics", TOOL);
