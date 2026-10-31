# Lyricpad

A small, fast lyric-writing app that runs entirely in the browser.

- **Live syllable counts** — every line of your lyrics shows its syllable count in the left gutter, updating as you type. Words with more than one common pronunciation show a range (`fire` → 1–2, so a line might read `8–9`). Words the dictionary doesn't know are estimated and marked with `?`. Hover a count to see the per-word breakdown. Anything in square brackets, like `[Chorus]` or `[Verse 2 – softer]`, is a meta tag and isn't counted, wherever it appears in the line.
- **Rhyme finder** — search a word or a short phrase (“phone me”) and pick what you want:
  - **Perfect** rhymes — identical sound from the stressed vowel on (*heart / start*)
  - **Near** rhymes — slant rhymes that are close but not exact (*heart / hard*, *time / mine*)
  - **Vowel match** — assonance: same vowel sounds, any consonants (*love / jump*)
  - filter by syllable count, and optionally include rare words
- Double-click any word in your lyrics (or press **Alt+R** / “Rhyme this word”) to look up its rhymes. On a blank line, it uses the last word of the line above.
- Click a result to copy it.
- Your draft is saved automatically in your browser; “Save .txt” downloads it.

No server, no API keys, works offline once loaded.

## Running it locally

It's a static site — any web server works:

```bash
python3 -m http.server 8000
```

then open http://localhost:8000. (Opening `index.html` straight from disk won't work: browsers block loading the dictionary file from `file://`.)

## Publishing on GitHub Pages

1. Push this repository to GitHub.
2. In the repo, go to **Settings → Pages**, set **Source** to “Deploy from a branch”, branch `main`, folder `/ (root)`.
3. After a minute the app is live at `https://<your-username>.github.io/<repo-name>/`.

## How it works

`data/dict.txt` is built from the [CMU Pronouncing Dictionary](https://github.com/cmusphinx/cmudict) (~126k words with phonetic spellings), ordered by how common each word is in film/TV subtitles ([FrequencyWords](https://github.com/hermitdave/FrequencyWords)). Entries missing from the [SCOWL](http://wordlist.aspell.net/) English word list (mostly names) are flagged so they still count syllables but never show up as rhymes. `tools/build_dict.py` rebuilds it.

- Syllables = number of vowel sounds in the word's pronunciation.
- A word's *rhyme* is its sounds from the last stressed vowel to the end. Perfect rhymes share it exactly.
- Near rhymes are scored by a weighted sound distance: similar vowels (*IH/IY*) and similar consonants (*M/N*, *D/T*) cost less than unrelated ones. The logic lives in `js/phonetics.js`.

## Credits

Pronunciations: CMU Pronouncing Dictionary (BSD-style license). Word frequencies: hermitdave/FrequencyWords (CC BY-SA 4.0). Word list: SCOWL (permissive license).
