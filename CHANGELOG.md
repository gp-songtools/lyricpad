# Changelog

All notable changes to Lyricpad, newest first. Lyricpad has no version numbers, so entries are grouped by date. The version shown in the page footer is a content hash, not a release number.

## 2026-11-14 — New GP Blueprint section tags

### Fixed

- **Song from structure** now reads GP Blueprint's new section tags, like `[CHORUS|euphoric|soaring vocals]`. Before, a repeated chorus with different style hints was not always recognised as a repeat. Older copies like `[CHORUS: soaring vocals]` still work.

## 2026-11-13 — Rhyme colours

### Added

- **Rhyme colours**: as you type, rhyming words in the editor are highlighted, one colour per rhyme sound. Pick **Line endings** (the default), **All words** (to see internal rhymes too) or **Off** in the bar under the editor.

## 2026-11-09 — Visit statistics and credits

### Added

- **Credits** link in the footer, listing the dictionaries, word lists and libraries Lyricpad uses.

### Changed

- The browser tab now shows Lyricpad's own icon, ✍️, the same one as on the GP Song Tools menu, on every page.
- Suno Style Creator is now called **GP Blueprint**. Links, the Write a whole song help and its messages use the new name; copying a Song Structure from it works as before.
- Lyricpad now counts visits with Cloudflare Web Analytics: anonymous totals only, with no cookies. It never sees your lyrics, songs or keys. The **Privacy** page explains what it reports.

## 2026-11-08 — Copy menu

### Added

- **Copy ▾** button beside Export .txt with two choices: **Copy lyrics** (exactly as written) and **Copy without [tags]** (bracketed text removed, tag-only lines dropped, extra spaces and blank lines tidied). An **Include the song title at the top** checkbox is remembered per browser. The editor text is never changed.
- A **Changelog page** (`changelog.html`) that shows this changelog in a readable layout, with the newest changes first.

### Changed

- On phones, the song title gets its own row with the buttons below it, and the Copy menu stays on screen.

## 2026-11-06 — Write a whole song from a structure; Drive stays connected

### Added

- **Write a whole song from a structure** in the Suggest lines tab. Paste a Song Structure copied from Suno Style Creator, and the AI writes lyrics about the Topic / feel that fit each section's line count, per-line syllables and rhyme scheme. Section tags are kept, repeated sections such as a second chorus reuse the earlier lines, and each line's syllables are checked. The result can replace the song (undoable), go at the end, or be copied.

### Changed

- **Google Drive stays connected** when you close and reopen the tab, or open a second tab.
- When the one-hour Drive sign-in is nearly up, the next button click renews it quietly. Typing never triggers it, and auto-save resumes after renewal.

## 2026-11-02 — Line-start and line-end words, rewording, version check

### Added

- **Line starts with** and **Line ends with** options in Suggest lines, each with a checkbox. Suggestions that don't actually start or end with the requested words are flagged.
- **Try to reword this line to fit the rhyme** in "Rewrite this line" mode: keeps the line's meaning and changes only its wording so it ends on the rhyme.
- The footer shows the site **version and date**. Click it to check whether a newer version has been published.

### Changed

- Suggest lines now rhymes with the **selected line's last word by default** in both modes, and a caption names the word in use. "Override the selected rhyme with" lets you type your own word, or leave it blank for no rhyme.

### Fixed

- The reword option's suggested rhyme word now follows the selected line instead of sticking to the first line you picked.

## 2026-11-01 — Theme, Help, Privacy and Terms

### Added

- **Theme** button in the header: Light / Dark / Auto (follow the device), remembered per device. Light is the default on every device.
- **Help** page covering every feature, keyboard shortcuts and a short FAQ, linked from the header and footer.
- **Privacy Policy** and **Terms** pages, linked from the footer.

### Fixed

- Lyrics text was black on the dark background in dark mode.

## 2026-10-31 — First release

### Added

- Lyric editor with **live syllable counts** per line. Words with more than one pronunciation show a range, and unknown words are estimated and marked `?`. `[Bracketed]` tags are never counted, wherever they appear in a line.
- **Rhyme finder**: perfect, near and vowel-match rhymes, filtered by syllable count. Double-click a word or press Alt+R to look it up.
- **Thesaurus** tab: synonyms grouped by meaning plus related words, with an optional **Must rhyme with** filter. Double-click a word or press Alt+T; click a synonym to swap it in.
- **Suggest lines** tab: Claude or Gemini (your own key) suggests a rewrite of the selected line or the next line, guided by a topic, a syllable count (number stepper) and a rhyme. Fast mode is on by default.
- **Save songs to Google Drive** as `Title.txt` in a Lyricpad folder, with auto-save after the first save and a warning before overwriting changes made on another device. **Songs** lists saved songs; **Export .txt** downloads the song.

### Fixed

- After an update, a browser could mix new and old cached files, which broke syllable counts and some buttons. Every file now carries a version stamp so an update always loads a matching set.
- The Google sign-in popup was silently blocked on Safari and iOS. It now opens directly from the click.
