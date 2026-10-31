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

- **Suggest lines** (optional, uses AI with your own API key) — pick a line in the editor, give a topic or feel, and ask for alternatives to that line or options for the next one. You can require a matching syllable count and a rhyme. Each suggestion shows its syllable count (checked locally); “Replace line” / “Insert below” drop it into the song, and Ctrl/Cmd+Z undoes.

Everything except line suggestions runs offline in the browser, with no server and no API keys.

## Line suggestions: providers and keys

Open the **Suggest lines** tab → **AI settings**, choose a provider, and paste a key:

| Provider | Get a key | Cost |
|---|---|---|
| Claude (Anthropic) | [console.anthropic.com](https://console.anthropic.com/settings/keys) | Pay per use from prepaid credit. Roughly 2¢ per request on Opus 5.5, 1¢ on Sonnet 5.5, 0.05¢ on Haiku 5.5. Set a monthly spend limit in the Console. |
| Gemini (Google) | [aistudio.google.com](https://aistudio.google.com/apikey) | Free tier available (rate-limited; Google may use free-tier prompts to improve its products). |

The key is stored only in your browser (localStorage, or sessionStorage if you untick “Remember key on this device”) and is sent only to the provider you chose. It is never part of this repository or the published site. Anyone with access to your browser profile could read it, so use “Forget key” on shared computers.

Claude requests go through the official Anthropic TypeScript SDK, bundled at `vendor/anthropic-sdk-1.3.0.js` (MIT license) so the site doesn't depend on a CDN. Gemini requests use Google's REST API directly; the model list is fetched from your account so new Gemini models show up automatically.

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

Pronunciations: CMU Pronouncing Dictionary (BSD-style license). Word frequencies: hermitdave/FrequencyWords (CC BY-SA 4.0). Word list: SCOWL (permissive license). Anthropic TypeScript SDK (MIT).
