// Lyricpad and the song spec: works with and without other tools' sections, and a save never
// changes anything Lyricpad doesn't own. Run: node --test tests/ (no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SongSpec as S, specInputs, usedSections, lyricsProblems, specWriteLyrics, overwriteReason, ideaTopic } from "../js/spec.js";

const LYRICS = "[VERSE 1|wistful]\nYour name still glows across my screen\nA message never sent\n\n[CHORUS]\nSo I light one for you";

const UPSTREAM = `---
schema_version: 1
# my own comment
model: v6
bpm: 89
key: Ab minor
bpm_key_by: gp-blueprint
x_custom: keep me
---

# Song spec

## Idea
<!-- song-spec: by=ideawizard at=2026-11-17T14:02Z hash=00000000 -->
Title: Paper Lanterns
Topic: Letting go of a friendship
Angle: One lantern per unsaid thing.
Hook: I let the light go up

## Idea structure
<!-- song-spec: by=ideawizard at=2026-11-17T14:05Z hash=00000000 -->
[VERSE 1]
16 bars, 43 secs, 2 lines. Rhyme: AB. Story: the last message.

## Style
<!-- song-spec: by=gp-blueprint at=2026-11-17T13:55Z hash=00000000 -->
Indie folk, 89 BPM, Ab minor.

## Structure
<!-- song-spec: by=gp-blueprint at=2026-11-17T13:55Z hash=00000000 -->
89 BPM, Ab minor

[VERSE 1|wistful]
16 bars, 43 secs, 2 lines. Rhyme: AB. Syllables: 8.6.

## My extra section
Hand-written, unknown to every tool.
`;

// Everything Lyricpad doesn't own, read from the document in memory (a re-read would give the new
// section's leading blank line to the section above it, though no byte of that section changed).
function notOwned(doc) {
  return {
    sections: doc.sections.filter((s) => s.id !== "lyrics").map((s) => s.head + s.lines.join("")),
    settings: (doc.fm?.items || []).filter((x) => !["title", "schema_version"].includes(x.key)).map((x) => x.line),
    pre: doc.pre.join(""),
  };
}

test("no song spec: nothing offered, and Add to song spec creates a valid spec", () => {
  const doc = S.parse("");
  const inp = specInputs(doc);
  assert.equal(inp.structure.id, null);
  assert.deepEqual(inp.structure.options, []);
  assert.equal(inp.topic, null);
  assert.equal(inp.title, null);
  assert.deepEqual(usedSections(inp, { structureText: "[VERSE]\n8 bars, 20 secs, 4 lines.", topicText: "my topic" }), []);
  specWriteLyrics(doc, { title: "My Song", lyrics: LYRICS });
  const back = S.parse(S.serialize(doc));
  assert.equal(S.section(back, "lyrics").body, LYRICS, "lyrics are saved exactly, tags included");
  assert.equal(S.setting(back, "title"), "My Song");
  assert.equal(S.validate(back).filter((i) => i.level === "error").length, 0);
  assert.deepEqual(Object.keys(S.section(back, "lyrics").marker.from), []);
});

test("with upstream sections: offers both structures, the topic and title, and records what was used", () => {
  const doc = S.parse(UPSTREAM);
  const inp = specInputs(doc);
  assert.equal(inp.structure.id, "idea-structure", "newest structure is the default");
  assert.deepEqual(inp.structure.options.map((o) => o.id).sort(), ["idea-structure", "structure"]);
  assert.equal(inp.topic.text, "Paper Lanterns: Letting go of a friendship. Angle: One lantern per unsaid thing. Hook: I let the light go up.");
  assert.equal(inp.title.text, "Paper Lanterns");

  const st = inp.structure.options.find((o) => o.id === "structure").body;
  const used = usedSections(inp, { structureText: st + "\n\n", topicText: inp.topic.text });
  assert.deepEqual(used, ["structure", "idea"]);
  assert.deepEqual(usedSections(inp, { structureText: st + "\nchanged", topicText: "mine" }), []);

  const before = notOwned(S.parse(UPSTREAM));
  specWriteLyrics(doc, { title: "Paper Lanterns", lyrics: LYRICS, used });
  const after = S.serialize(doc);
  assert.deepEqual(notOwned(doc), before, "Add to song spec changed something Lyricpad doesn't own");
  assert.ok(after.replace("title: Paper Lanterns\n", "").startsWith(UPSTREAM.slice(0, UPSTREAM.indexOf("## My extra section"))));
  const lyr = S.section(S.parse(after), "lyrics");
  assert.deepEqual(Object.keys(lyr.marker.from), ["structure", "idea"]);
  assert.equal(lyr.stale.length, 0);
});

test("a Blueprint rerun after Idea Wizard makes Blueprint's structure the default", () => {
  const doc = S.parse(UPSTREAM);
  // Idea Wizard built its structure from Blueprint's; then Blueprint runs again.
  S.setSection(doc, "idea-structure", "[VERSE 1]\n16 bars, 43 secs, 2 lines. Rhyme: AB.", { by: "ideawizard", from: ["structure"], at: "2026-11-17T14:05Z" });
  specWriteLyrics(doc, { lyrics: LYRICS, used: ["idea-structure"] });
  S.setSection(doc, "structure", "92 BPM, A minor\n\n[CHORUS]\n8 bars, 20 secs, 4 lines.", { by: "gp-blueprint", at: "2026-11-18T09:00Z" });
  const inp = specInputs(doc);
  assert.equal(inp.structure.id, "structure");
  assert.match(inp.structure.note, /Idea structure \(Idea Wizard\) is based on an older Structure/);
  // The lyrics came from Idea structure, which didn't change, so they aren't flagged themselves.
  assert.deepEqual(S.staleNotes(doc, "lyrics"), []);
  // Lyrics written from Blueprint's old structure are flagged once it changes.
  specWriteLyrics(doc, { lyrics: LYRICS, used: ["structure"] });
  S.setSection(doc, "structure", "92 BPM, A minor\n\n[CHORUS]\n8 bars, 20 secs, 2 lines.", { by: "gp-blueprint", at: "2026-11-18T09:30Z" });
  assert.match(S.staleNotes(doc, "lyrics").join(" "), /Lyrics is based on an older Structure/);
});

test("empty sections count as missing", () => {
  const inp = specInputs(S.parse("---\nschema_version: 1\n---\n\n## Idea\n\n## Structure\n\n## Idea structure\n"));
  assert.equal(inp.structure.id, null);
  assert.equal(inp.topic, null);
});

test("warnings before saving: no [tags], over 5000 characters", () => {
  assert.deepEqual(lyricsProblems(LYRICS), []);
  assert.deepEqual(lyricsProblems("just words\nno tags"), ["notags"]);
  assert.deepEqual(lyricsProblems("[Verse]\n" + "x".repeat(5000)), ["toolong"]);
});

test("asks before replacing lyrics edited by hand, not its own", () => {
  const doc = S.parse(UPSTREAM);
  assert.equal(overwriteReason(doc), "");
  specWriteLyrics(doc, { lyrics: LYRICS });
  assert.equal(overwriteReason(doc), "");
  const edited = S.parse(S.serialize(doc).replace("A message never sent", "A message I never sent"));
  assert.match(overwriteReason(edited), /changed by hand/);
});

test("Lyricpad cannot write sections it doesn't own", () => {
  const doc = S.parse(UPSTREAM);
  assert.throws(() => S.setSection(doc, "structure", "x", { by: "lyricpad" }));
  assert.throws(() => S.setSetting(doc, "bpm", "90", { by: "lyricpad" }));
});

test("ideaTopic copes with partial ideas", () => {
  assert.equal(ideaTopic("Topic: Rain."), "Rain.");
  assert.equal(ideaTopic("Title: Only a title"), "");
  assert.equal(ideaTopic(""), "");
});
