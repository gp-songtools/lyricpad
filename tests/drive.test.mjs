// Lyricpad's Drive naming and query helpers. Run: node --test tests/ (no dependencies, no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fileName, titleFrom, isUntitled, uniqueName, freeFileName, moveTargets, batches, parentsQuery,
  lyricsFoldersQuery, songFilesQuery, sameTitle, folderNameFor,
} from "../js/drivehelpers.js";

test("file and title names", () => {
  assert.equal(fileName("Neon: Rain/Dance"), "Neon Rain Dance.txt");
  assert.equal(fileName("  "), "Untitled song.txt");
  assert.equal(titleFrom("My Song.txt"), "My Song");
  assert.equal(titleFrom("My Song.TXT"), "My Song");
});

test("title to folder name uses the shared rule", () => {
  assert.equal(folderNameFor('Who? "Me": a/b'), "Who Me ab");
  assert.equal(folderNameFor("  Two   words "), "Two words");
  assert.equal(folderNameFor("x".repeat(150)).length, 100);
});

test("untitled detection", () => {
  assert.ok(isUntitled(""));
  assert.ok(isUntitled("Untitled song"));
  assert.ok(isUntitled("???"));
  assert.ok(!isUntitled("Untitled song 2"));
});

test("uniqueName adds (2), (3)", () => {
  assert.equal(uniqueName("A", new Set()), "A");
  assert.equal(uniqueName("A", new Set(["a"])), "A (2)");
  assert.equal(uniqueName("A", new Set(["a", "a (2)"])), "A (3)");
});

test("freeFileName avoids a duplicate in the lyrics folder", () => {
  assert.equal(freeFileName("Song", ["Other.txt"]), "Song.txt");
  assert.equal(freeFileName("Song", ["song.txt"]), "Song (2).txt");
  assert.equal(freeFileName("Song", ["Song.txt", "Song (2).txt"]), "Song (3).txt");
});

test("moveTargets: untitled songs each get a folder, same titles share one", () => {
  const files = [
    { id: "1", name: "Untitled song.txt" },
    { id: "2", name: "Night Drive.txt" },
    { id: "3", name: "Untitled song.txt" },
    { id: "4", name: "Night Drive.txt" },
  ];
  const t = moveTargets(files, []);
  assert.deepEqual(t.map((x) => x.folder), ["Untitled song", "Night Drive", "Untitled song (2)", "Night Drive"]);
  const t2 = moveTargets(files.slice(0, 1), ["untitled song"]);
  assert.equal(t2[0].folder, "Untitled song (2)");
  assert.ok(t2[0].untitled);
});

test("batches and queries", () => {
  const ids = Array.from({ length: 45 }, (_, i) => "id" + i);
  assert.deepEqual(batches(ids, 20).map((b) => b.length), [20, 20, 5]);
  assert.equal(parentsQuery(["a", "b'c"]), "('a' in parents or 'b\\'c' in parents)");
  assert.match(lyricsFoldersQuery(["a"]), /^\('a' in parents\) and name = 'lyrics' and mimeType = 'application\/vnd.google-apps.folder' and trashed = false$/);
  assert.match(songFilesQuery(["a", "b"]), /^\('a' in parents or 'b' in parents\) and mimeType != /);
});

test("sameTitle", () => {
  assert.ok(sameTitle("Night  Drive", "night drive"));
  assert.ok(!sameTitle("", ""));
  assert.ok(!sameTitle("A", "B"));
});
