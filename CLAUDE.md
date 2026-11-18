# Lyricpad

## Directory map
- `index.html`, `help.html`, `privacy.html`, `terms.html`, `css/style.css` — pages and styles
- `CHANGELOG.md` — user-facing changes by date, newest first (Added / Changed / Fixed); `changelog.html` renders it in the browser; edit only the `.md`
- `js/` — ES modules: `app.js` (editor, syllables, rhymes, theme, tabs, version check), `phonetics.js`, `thesaurus.js`, `suggest.js` (AI), `structure.js` (song-from-structure parser + prompt), `rhymemap.js` (rhyme colours in the editor), `drive.js` (Google Drive), `config.js` (OAuth client ID, not secret), `spec.js` (song spec: inputs and writing Lyrics/title, no DOM) + `specui.js` (its panel, "From the song spec" box, Copy › Add to song spec), `songspec.js` (copy of gp-songtools/toolsmenu `songspec/songspec.js`; never edit here)
- `data/` — `dict.txt` (CMU pronunciations), `thesaurus.txt` (WordNet + Moby); generated, don't hand-edit
- `tools/` — `stamp-version.sh`, `build_dict.py`, `build_thesaurus.py`
- `vendor/anthropic-sdk-1.3.0.js` — bundled Anthropic SDK; don't edit

## Commands
- No build step, no package.json, no npm.
- Serve: `python3 -m http.server 8000 -b 127.0.0.1 >/dev/null 2>&1 &`
- Check served: `curl -sf -o /dev/null http://127.0.0.1:8000/ && echo up`
- Syntax check: `for f in js/*.js; do node --check "$f" || echo "FAIL $f"; done`
- Song spec tests: `node --test tests/*.test.mjs` (no dependencies)
- Stamp version: `tools/stamp-version.sh` (prints only `version <hash> (<date>)`)
- Rebuild dict: `python3 tools/build_dict.py cmudict.dict en_50k.txt words.txt > data/dict.txt` (sources downloaded separately; see script header)
- Rebuild thesaurus: `python3 tools/build_thesaurus.py data/dict.txt wordnet_dict/ moby.txt > data/thesaurus.txt`
- Push: `git push -q -u origin main`

## Testing
- Repo tests: `tests/*.test.mjs` (song spec, Node's built-in runner). Write throwaway Playwright scripts in the scratchpad, not the repo.
- Playwright + Chromium are preinstalled: `require('playwright')`, `chromium.launch()`; never `playwright install`.
- Sandbox can't reach the live site, Google, or CDNs: mock with `page.route`.
- Mock `https://accounts.google.com/**` with a fake `window.google.accounts.oauth2` (`initTokenClient`, `hasGrantedAllScopes`, `revoke`); an empty stub causes `google is not defined`.
- Mock `*.googleapis.com` (Drive + Gemini) and `api.anthropic.com`; assert exact request bodies.
- Fail the test on any `pageerror` or console error.
- Run: `node <scratchpad>/test.js`

## Workflow rules
- Commit straight to `main`; no PRs unless asked; ask first for big or risky changes.
- Commit as `Claude <noreply@anthropic.com>` (`git config user.name Claude; git config user.email noreply@anthropic.com`); stop hook rejects other authors.
- Run `tools/stamp-version.sh` before every commit touching `index.html`, `js/`, `css/`, `data/` or any `.html` page.
- After pushing, report the new version hash (matches the page footer).
- Add a `CHANGELOG.md` entry in the same commit as every user-facing change: today's date heading (reuse it if it's already at the top), items under Added / Changed / Fixed, plain user wording.
- Update `help.html` and `README.md` when behavior changes; `privacy.html` (and its "Last updated" date) when stored/sent data changes.
- Verify in a real browser before claiming a fix.
- Keep replies plain and short (owner often reads on a phone).
- Every `.html` page ends with the Cloudflare Web Analytics snippet (same token on all GP Song Tools); add it to any new page. Credits live on the suite page `gp-songtools.github.io/toolsmenu/privacy.html#credits` (repo `gp-songtools/toolsmenu`); update it and `README.md` Credits when adding a data source or library.

## Gotchas
- Song spec (format: gp-songtools/toolsmenu `songspec/SPEC.md`): Lyricpad owns only Lyrics (saved exactly as written, [tags] kept) and `title`; it only reads Structure, Idea structure and Idea, and must work unchanged without them. Drive saves stay lyrics-only `.txt`. Update `songspec.js` only by copying it from toolsmenu (`node toolsmenu/songspec/check-copies.js`).
- Imports carry `?v=<hash>`; never hand-edit stamps, rerun the script.
- Google sign-in popup must open synchronously from a click: nothing awaited before `requestAccessToken`.
- Google script is preloaded at page load (`prepareSignIn`) for that reason.
- Drive token: localStorage `lyricpad:drive:token`, 1-hour life; renewed on the next button click when <10 min left (`renewOnClick` in `drive.js`).
- Each panel starts inside `safeInit` in `app.js`; one panel's crash must not break the editor.
- Text inputs must inherit theme color (`color: inherit`), or dark mode shows black-on-dark text.
- Theme default is Light; `help.html` reads `lyricpad:theme` from localStorage itself.
- AI keys live only in the user's browser (`lyricpad:ai:key:*`); never commit keys.
- `[bracketed]` text is a section tag: never counted as syllables or used as a rhyme word.
- `structure.js` parses Song Structure text copied from GP Blueprint (repo `gp-songtools/gp-blueprint`) (spec: its `docs/structure-format.md`); keep both in step; still reads the older `ABAB 8.7.8.7` format.
- UI: explicit captions over hidden defaults; owner dislikes ambiguity.
- Suggest-lines rhyme defaults to the selected line's last word; "Override the selected rhyme with" replaces it (blank = no rhyme).

## Open items
- Google Cloud: remove old authorized origin `https://pcarenza.github.io`.
- Optional: Search Console verification file for `gp-songtools.github.io`.
- Idea: save songs as Google Docs instead of `.txt`.

# Multi-Agent Delegation Rules
When acting as the primary session (Opus), operate as a **Tech Lead and Architect**. Conserve primary context and rate limits by delegating execution work to specialized subagents whenever possible.
## Available Subagents
1. **`haiku-helper` (Fast Scout & Clerk)**
- **When to delegate:** File discovery, searching across the codebase (`Grep`/`Glob`), checking git status or commit logs, reading configuration files, and summarizing documentation.
- **Constraint:** Read-only tasks. Do not ask `haiku-helper` to write or edit code.
2. **`sonnet-worker` (Builder & Tester)**
- **When to delegate:** Implementing features from a finalized specification, writing unit or integration tests, refactoring isolated modules, fixing localized bugs, and running test/build suites.
- **Constraint:** Always provide clear requirements, target file paths, and expected behavior when invoking `sonnet-worker`.
## Orchestration Workflow
1. **Explore First:** Before planning changes, dispatch `haiku-helper` to locate relevant files and summarize existing patterns.
2. **Design & Plan:** Synthesize the findings in the main session and outline the architectural plan or edge cases.
3. **Delegate Implementation:** Hand off well-scoped coding, refactoring, and test-writing tasks to `sonnet-worker`. You may launch multiple `sonnet-worker` instances in parallel for independent modules.
4. **Review & Verify:** Inspect the changes made by `sonnet-worker` (or have `haiku-helper` summarize `git diff`) to ensure architectural alignment before concluding the task.
