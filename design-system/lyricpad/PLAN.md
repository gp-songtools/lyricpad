# Lyricpad redesign plan

Written with the frontend-design skill, inside `MASTER.md`. This is the "what we'll build" note; MASTER is the rulebook.

## Brief, restated
Lyricpad is a lyric editor and songwriting assistant (rhymes, synonyms, AI lines and whole songs). Refine the
design of every page; keep numbers and small text highly readable; fully responsive; populated screens.

## Subject, audience, job
- Subject: the songwriter's notepad: a sheet of lines, pen ink, a highlighter, counts in the margin.
- Audience: songwriters, often on a phone, often mid-thought.
- Primary job: write a line and instantly see its syllables and what it rhymes with.

## Plan v1 (first pass)
- Colour: cream `#FFFBEB` page, stone primary, amber accent (straight from the generator).
- Type: a classic serif for headings and lyrics, system sans for UI.
- Layout: keep today's two panels; restyle the controls.
- Principles: calm, warm, writerly.

## Review against the brief (what changed and why)
1. **Cream + serif headings + warm accent** is the stock "writerly" look, and it is what Lyricpad already
   looked like (cream `#F6F4EF`, Palatino headings, clay `#B4532A`). A refinement that keeps it changes nothing
   a user would notice. → Background becomes **stone** with a **white sheet**; ink becomes **blue-black**,
   like a pen; amber is used the way a highlighter is used: as a fill behind things, never as thin text.
2. **Serif headings** read as editorial template. → Serif is reserved for **the user's words** (lyrics, titles,
   word results, AI lines). Every heading and control is sans. The split itself tells you what's yours and
   what's the tool.
3. **"Calm, warm, writerly"** could describe any notes app. → Principle becomes **"meter and rhyme at a
   glance"**: the gutter numbers and rhyme highlights are the loudest things on screen, so they get the
   boldest treatment (semibold tabular counts on a tinted margin, the current line as a highlighter band
   running from margin to text), and chrome steps back.
4. **Small text**: the old UI went down to 10–12px (gutter `.78rem`, superscripts `.62rem`, chips `.82rem`,
   `.7rem` part-of-speech labels in caps). → 13px floor, 14px for captions and counts; caps labels removed.
5. **Pages**: help/privacy/terms/changelog each had their own colours, and privacy/terms ignored dark mode.
   → One shared `css/pages.css`, same top bar and footer as the app, theme followed everywhere.

## Final tokens (see MASTER for values and contrast)
- Colour: stone `--bg`, white `--paper`, blue-black `--ink`, stone `--muted`, amber `--accent` (fill) /
  `--accent-ink` (text), amber-soft `--accent-soft`, plus `--warn` `--danger` `--ok`.
- Type: lyrics serif (Charter stack) / UI sans (system-ui); 13/14/15/16/18 scale; tabular figures.
- Layout: left-aligned everything (it's a writing tool, not a poster); centre alignment only for the empty
  state of lists.

## Wireframes

Desktop ≥ 900px
```
┌ Lyricpad   126,052 words ready                         Help  Theme: Light ┐
├───────────────────────────────────────────┬──────────────────────────────┤
│ Gravel Road Goodbye        [Rhyme] [Songs] │ Rhymes  Thesaurus  Suggest   │
│                    [Save] [Export] [Copy▾] │ ───────                      │
├────┬──────────────────────────────────────┤ [ night            ][Search] │
│  8 │ [Verse 1]                            │ (✓Perfect)(✓Near)(Vowel)...  │
│  8 │ Dust on the dash and the radio low   │ PERFECT ── 1 syllable        │
│▐ 9 │▐The porch light's on but I've got to go│ bite  bright  fight  flight… │
│  8 │ ...                                  │                              │
├────┴──────────────────────────────────────┤                              │
│ Line 3 · 9 syllables    Rhyme colours [▾]  Saved│                         │
└───────────────────────────────────────────┴──────────────────────────────┘
  Help   Privacy   Terms   Changelog   Credits   Version 1a2b3c4d (2026-11-20)
```

Phone 390px: top bar (brand, Help, Theme) → editor panel (title row, tool buttons wrap, ~62vh) →
tools panel (tabs scroll horizontally if needed) → footer.

Pages: top bar (Lyricpad ← home, Help · Changelog · Privacy · Terms) → 68ch column → shared footer.

## The one bold thing
The editor margin: a tinted gutter with large tabular syllable counts, and the current line drawn as an amber
highlighter band across gutter and text. Rhyme highlights reuse the same highlighter idea. Nothing else gets
colour except the primary button in each area.

## Restraint list (removed accessories)
- No caps eyebrow labels in results (group headings become sentence-case sans with a count).
- No pill outline on Help; it's a plain link button like Theme.
- No shadows on panels.

## Sample data
Screens are reviewed with a realistic original song ("Gravel Road Goodbye"), a real topic paragraph,
mocked rhyme/thesaurus lookups from the real dictionary, mocked AI answers and a mocked Drive song list
(see the screenshot harness). The shipped app keeps an empty editor for new users; its empty states explain
what to do next.
