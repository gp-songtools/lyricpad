// Song spec UI: the shared panel under the editor, the "From the song spec" box above Topic / feel,
// and "Add to song spec" in the Copy menu. Everything read from the spec is optional: with no spec,
// or empty sections, Lyricpad works exactly as before.
import { SongSpec as S, specInputs, usedSections, lyricsProblems, specWriteLyrics, overwriteReason } from "./spec.js?v=5e0421cd";

const $ = (id) => document.getElementById(id);
const USED_KEY = "lyricpad:spec:used"; // what the last "Write lyrics" took from the spec
const NAMES = { structure: "GP Blueprint's structure", "idea-structure": "Idea Wizard's structure" };

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function readUsed() { try { return JSON.parse(localStorage.getItem(USED_KEY)) || []; } catch { return []; } }
function writeUsed(v) { try { localStorage.setItem(USED_KEY, JSON.stringify(v)); } catch { /* ignore */ } }

// Put text into one of the page's boxes the way typing would, so its own listeners save and refresh.
function fill(input, text) {
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function initSpec({ toast }) {
  const box = $("specIn"), titleEl = $("title"), lyricsEl = $("lyrics"), topicEl = $("topic"), structEl = $("structIn");
  let doc = S.parse(S.store.load() || S.create());
  let inputs = specInputs(doc);
  let choice = null; // structure the person picked in the select; null = the default (pickStructure)

  const panel = S.mountPanel($("specPanel"), { onChange: (d) => { doc = d; inputs = specInputs(d); render(); } });

  function boxes() { return { structureText: structEl.value, topicText: topicEl.value }; }

  function render() {
    const { structure, topic, title } = inputs;
    box.hidden = !structure.options.length && !topic && !title;
    if (box.hidden) return;
    const rows = [el("p", "spec-in-head", "From the song spec"), el("p", "hint small", "Optional: use any of these, or ignore them and type your own.")];
    const used = usedSections(inputs, boxes());

    if (structure.options.length) {
      const pick = structure.options.some((o) => o.id === choice) ? choice : structure.id;
      const row = el("div", "spec-in-row");
      const sel = el("select");
      sel.setAttribute("aria-label", "Structure to use");
      for (const o of structure.options) {
        const opt = el("option", null, `${NAMES[o.id]}${o.id === structure.id ? " (newest)" : ""}${o.stale.length ? " (out of date)" : ""}`);
        opt.value = o.id;
        opt.selected = o.id === pick;
        sel.append(opt);
      }
      sel.addEventListener("change", () => { choice = sel.value; render(); });
      const chosen = structure.options.find((o) => o.id === pick);
      row.append(el("span", null, "Structure:"), sel, useButton(used.includes(pick), "Use structure", () => {
        $("structBox").open = true;
        fill(structEl, chosen.body);
        toast(`Using ${NAMES[pick]} from the song spec`);
      }));
      rows.push(row);
      const notes = [pick === structure.id ? structure.note : `You chose ${NAMES[pick]}; the default is ${NAMES[structure.id]}, the newest one that isn't out of date.`,
        ...S.staleNotes(doc, pick)].filter(Boolean);
      if (notes.length) rows.push(el("p", `hint small${chosen.stale.length ? " spec-warn" : ""}`, notes.join(" ")));
    }
    if (topic) {
      const row = el("div", "spec-in-row");
      row.append(el("span", "spec-in-text", `Topic from ${S.toolName(topic.by)}: ${topic.text}`),
        useButton(used.includes("idea"), "Use as topic", () => fill(topicEl, topic.text)));
      rows.push(row);
    }
    if (title && titleEl.value.trim() !== title.text) {
      const row = el("div", "spec-in-row");
      row.append(el("span", "spec-in-text", `Title from ${S.toolName(title.by)}: ${title.text}`),
        useButton(false, "Use as title", () => { fill(titleEl, title.text); render(); }));
      rows.push(row);
    }
    if (used.length) {
      const names = used.map((id) => (id === "idea" ? `Topic (${S.toolName(inputs.topic.by)})` : NAMES[id]));
      rows.push(el("p", "hint small spec-ok", `Write lyrics will use from the song spec: ${names.join(", ")}.`));
    }
    box.replaceChildren(...rows);
  }

  function useButton(inUse, label, onClick) {
    if (inUse) return el("span", "spec-ok", "In use");
    const b = el("button", null, label);
    b.type = "button";
    b.addEventListener("click", () => { onClick(); render(); });
    return b;
  }

  // Note what a "Write lyrics" run takes from the spec (capture phase: before the writer reads the boxes).
  $("structBtn").addEventListener("click", () => {
    const used = usedSections(inputs, boxes());
    writeUsed(used);
    if (used.length) toast(`Writing from the song spec: ${used.map((id) => (id === "idea" ? "Topic" : NAMES[id])).join(", ")}`);
  }, true);
  for (const input of [structEl, topicEl, titleEl]) input.addEventListener("input", () => render());

  // "Add to song spec": the lyrics exactly as written, [tags] included, plus the title.
  function addLyrics() {
    const lyrics = lyricsEl.value.replace(/\s+$/, "");
    if (!lyrics.trim()) return toast("Nothing to add yet: the song is empty");
    const problems = lyricsProblems(lyrics);
    if (problems.includes("notags") && !confirm("These lyrics have no section tags like [Verse] or [Chorus]. Suno reads the song's structure from them.\n\nAdd them to the song spec anyway?")) return;
    const fresh = S.parse(S.store.load() || S.create());
    const reason = overwriteReason(fresh);
    if (reason && !confirm(`${reason}\n\nReplace it with the lyrics in the editor?`)) return;
    // Only count sections the last "Write lyrics" used that are still what the boxes hold.
    const now = usedSections(specInputs(fresh), boxes());
    const used = readUsed().filter((id) => now.includes(id));
    const saved = S.store.update((d) => specWriteLyrics(d, { title: titleEl.value, lyrics, used }));
    if (S.store.load() !== S.serialize(saved)) return toast("This browser blocked saving the song spec (private mode or storage full)");
    toast(problems.includes("toolong")
      ? "Added to the song spec, but the lyrics are over Suno's 5,000-character limit"
      : `Added the lyrics${titleEl.value.trim() ? " and title" : ""} to the song spec`);
  }

  render();
  return { addLyrics, panel };
}
