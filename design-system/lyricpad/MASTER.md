# Lyricpad Design System (Master)

> Generated with the ui-ux-pro-max skill (`search.py "songwriting lyrics editor writing tool" --design-system`,
> category **Notes & Writing App**, style **Minimalism & Swiss Style**, dials variance 4 · motion 2 · density 6),
> then checked and adapted for this product. Where this file differs from the raw output, the reason is noted.
> Page-specific rules live in `pages/<page>.md` and override this file. The implementation is `css/style.css`
> (app) and `css/pages.css` (help, changelog, privacy, terms); tokens are defined once per file at `:root`.

## Product
- **What:** a browser lyric editor and songwriting assistant: live syllable counts, rhyme colours, rhyme finder,
  thesaurus, AI line suggestions, write a song from a structure, Google Drive saving.
- **Who:** songwriters drafting at a desk or on a phone, often mid-idea. Many read on phones.
- **Primary job:** write lines and see their meter and rhymes at a glance. Everything else is a helper.

## Concept: pen and highlighter
A songwriter's notepad: blue-black pen ink on a white sheet, an amber highlighter for what matters
(the current line, selected options, the main action), and coloured highlighter marks for rhymes.
Stone neutrals for everything around the page. The bold element is the editor itself (syllable gutter +
rhyme highlights); all chrome stays quiet.

## Colour tokens
All text pairs verified at WCAG AA or better (ratios measured against `--paper` unless stated).

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#ECEAE6` | `#141312` | Page background behind panels (stone, not cream) |
| `--paper` | `#FFFFFF` | `#1F1D1B` | Panels, the writing sheet, dialogs |
| `--sunk` | `#F6F5F3` | `#191816` | Gutter, inputs, quiet wells |
| `--ink` | `#1B1E2B` (16.6:1) | `#F2F0EC` (14.8:1) | Body text, pen ink |
| `--muted` | `#57534E` (7.6:1) | `#ABA59D` (6.9:1) | Secondary text, captions, counts |
| `--line` | `#D6D3D1` | `#3A3632` | Dividers only (decorative) |
| `--edge` | `#8C8680` (3.6:1) | `#7A746E` (3.6:1) | Borders of inputs/buttons (non-text 3:1) |
| `--accent` | `#D97706` | `#F59E0B` | Highlighter fill: primary button, current-line band edge |
| `--on-accent` | `#111111` (5.9:1) | `#111111` (8.8:1) | Text on accent fill |
| `--accent-ink` | `#92400E` (7.1:1) | `#FBBF24` (10.1:1) | Accent as text: active tab, selected chip, links |
| `--accent-soft` | `#FEF3C7` | `#3A2C12` | Selected backgrounds, current line, tips |
| `--ring` | `#B45309` (5.0:1) | `#FBBF24` | Focus ring (2px, offset 2px) |
| `--warn` | `#8A5A00` (5.9:1) | `#E8B04A` (8.6:1) | Estimates, near misses |
| `--danger` | `#B42318` (6.6:1) | `#F4877A` (6.9:1) | Errors, over-count, unsaved warnings |
| `--ok` | `#166534` (7.1:1) | `#6FCF8E` (8.8:1) | "Fits" syllable counts, saved |

Changed from the raw output: background `#FFFBEB` cream → stone `#ECEAE6` with white paper (cream + clay
is a stock look and the old Lyricpad already used it); slate foreground kept as blue-black "ink";
accent `#D97706` kept as a **fill only** — as text it fails contrast, so `--accent-ink` is used for text;
"on accent" stays near-black as the generator specified (white on `#D97706` is only 3.2:1).

**Rhyme highlights** (8 groups, text over them ≥ 6.3:1):
light `#FDE68A #BAE6FD #BBF7D0 #FBCFE8 #DDD6FE #FED7AA #99F6E4 #E5E7A0`;
dark `#6B5410 #164A6B #2A5A22 #6B2438 #45307A #6E3E14 #165A50 #55551A`.
Colour is never the only signal: matching words are also listed in rhyme results and help text.

## Typography
System fonts only (no web-font requests: the app works offline, and a font CDN would need a privacy-page change).
Changed from the raw output (Poppins + Open Sans from Google Fonts) for that reason.

- **Lyrics serif** (the song itself: editor, song titles, rhyme/synonym words, suggestion text):
  `Charter, "Bitstream Charter", "Iowan Old Style", "Sitka Text", Cambria, Georgia, serif`.
- **UI sans** (everything else, all page headings): `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
- Serif is for content the user writes; sans is for the tool. Headings are sans, semibold, slightly tight.
- **Numbers:** `font-variant-numeric: tabular-nums` everywhere a count appears; syllable counts semibold.

| Token | Size | Use |
|---|---|---|
| `--fs-xs` | 0.8125rem (13px) | **Floor.** Superscript syllable counts, meta. Nothing smaller anywhere. |
| `--fs-sm` | 0.875rem (14px) | Captions, hints, footers, gutter counts, chips |
| `--fs-md` | 0.9375rem (15px) | Buttons, form labels, tabs |
| `--fs-base` | 1rem (16px) | Inputs (prevents iOS zoom), body text on pages |
| `--fs-lyric` | 1.125rem (18px) | Editor and lyric text |
| `--fs-h3`/`h2`/`h1` | 1.0625 / 1.375 / 2rem | Page headings |

Line heights: lyrics 1.75rem fixed grid (gutter aligns to it); pages body 1.6; UI 1.4.
Measure: help/policy pages max 68ch.

## Spacing, radius, elevation
- Spacing 4/8 scale: `--s1 4px · --s2 8px · --s3 12px · --s4 16px · --s5 24px · --s6 32px · --s7 48px`.
- Radius by hierarchy: panels/dialogs `12px`, controls `8px`, chips/pills `999px`, highlights `3px`.
- Elevation: panels are flat with a 1px `--line` border. Only floating layers (menus, dialog, toast)
  get a shadow: `0 12px 32px rgba(20,18,16,.18)`. No shadows on cards, no gradients.

## Components
- **Primary button** (one per area: Search, Suggest lines, Write lyrics): `--accent` fill, `--on-accent` text, 600.
- **Secondary button:** `--paper` fill, 1px `--edge` border, `--ink` text; hover: `--sunk` fill.
- **Quiet/ghost button:** no border until hover; for in-list actions.
- **Inputs:** `--sunk` fill, 1px `--edge`, 8px radius, 16px text, min-height 40px (44px on coarse pointers).
- **Chips (toggles):** pill, `--edge` border; checked = `--accent-soft` fill + `--accent-ink` text + 2px inset accent edge (shape change, not colour alone: a check mark shows).
- **Tabs:** text tabs with a 3px `--accent` underline for the selected one; `--accent-ink` text.
- **Focus:** `outline: 2px solid var(--ring); outline-offset: 2px` on every interactive element (`:focus-visible`).
- **Targets:** ≥ 32px tall on fine pointers, ≥ 44px on coarse pointers; ≥ 8px between targets.

## Motion
Motion dial 2/10: state changes only (150 ms ease-out for colour/border; menus and toast 160 ms fade + 4px
rise). No scroll reveals (the generator's GSAP snippet is not used: no library, no landing page).
`prefers-reduced-motion: reduce` removes all transitions.

## Layout
- App: top bar, then a two-column workspace (editor ~60%, tools ~40%) at ≥ 900px; stacked below,
  editor first. Breakpoints: 560 / 900 / 1200 px. No horizontal scroll at 320px.
- Pages (help, changelog, privacy, terms): the same top bar with a "Lyricpad" home link and page links,
  a single readable column, the same footer.

## Anti-patterns (do not use)
- Emoji or glyphs as UI icons (the tab icon is the suite's shared mark, left as is).
- Text under 13px; muted text below 4.5:1; colour as the only signal.
- All-caps tracked labels, middle-dot meta strings, arrows appended to link text.
- Shadows/gradients on resting panels; one radius for everything.
- Layout-shifting hover effects.

## Pre-delivery checklist
- [ ] Every text pair ≥ 4.5:1 in light and dark; control borders ≥ 3:1
- [ ] Nothing below 13px; all counts tabular
- [ ] Visible focus ring on every control; keyboard order matches visual order
- [ ] 390px and 1440px screenshots of every page and app state: no overflow, nothing clipped
- [ ] Reduced motion respected; theme follows the app's setting on every page
