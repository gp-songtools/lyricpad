// "Suggest lines" panel: asks Claude or Gemini for line ideas, using the user's own API key.
// The key is kept in this browser only (localStorage, or sessionStorage if "remember" is off)
// and is sent straight to the provider - never anywhere else.

const CLAUDE_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 — best writing (~2¢ per request)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 — good & cheaper (~1¢)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 — fastest & cheapest (~0.05¢)" },
];
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_DEFAULT = "gemini-3.6-flash";
const SDK_URL = new URL("../vendor/anthropic-sdk-1.3.0.js", import.meta.url).href;

const SYSTEM_PROMPT = `You are a lyric-writing collaborator helping a songwriter. You suggest lines they might use, in the voice, tone and point of view of the song so far.

Write lines that sound sung, not written: concrete images, natural word stress, plain words over fancy ones, no clichés unless twisted. Unless asked to reword a line, each suggestion should be a genuinely different idea, not small rewordings of one line. When asked to reword a line, keep its meaning, imagery and tone and change only the phrasing.

When a syllable count is requested, count carefully and hit it exactly - the songwriter is fitting the line to a melody. When a rhyme is requested, end the line on a word that rhymes (a near rhyme is acceptable if it sings well). When a line must begin or end with given words, use those words exactly as written and count them in the syllable total.

Return only the lines themselves: no numbering, quotes, or commentary.`;

const $ = (id) => document.getElementById(id);

// ---------- settings storage ----------
// Key: localStorage when "remember on this device" is on, sessionStorage (cleared when the tab closes) otherwise.
function readStore(area, k) { try { return window[area].getItem("lyricpad:ai:" + k); } catch { return null; } }
function writeStore(area, k, v) {
  try { v == null ? window[area].removeItem("lyricpad:ai:" + k) : window[area].setItem("lyricpad:ai:" + k, v); } catch { /* ignore */ }
}
const settings = {
  get provider() { return readStore("localStorage", "provider") || "claude"; },
  set provider(v) { writeStore("localStorage", "provider", v); },
  model(p) { return readStore("localStorage", "model:" + p); },
  setModel(p, v) { writeStore("localStorage", "model:" + p, v); },
  get fast() { return readStore("localStorage", "fast") !== "0"; },
  set fast(v) { writeStore("localStorage", "fast", v ? "1" : "0"); },
  get remember() { return readStore("localStorage", "remember") !== "0"; },
  set remember(v) { writeStore("localStorage", "remember", v ? "1" : "0"); },
  key(p) { return readStore("sessionStorage", "key:" + p) || readStore("localStorage", "key:" + p) || ""; },
  setKey(p, v, remember) {
    writeStore("localStorage", "key:" + p, remember && v ? v : null);
    writeStore("sessionStorage", "key:" + p, !remember && v ? v : null);
  },
};

// ---------- providers ----------
let anthropicModule = null;
async function askClaude({ key, model, user, fast }) {
  anthropicModule ||= await import(SDK_URL);
  const Anthropic = anthropicModule.default;
  // The key belongs to the person using this page and goes only to api.anthropic.com.
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  const schema = {
    type: "object",
    properties: { suggestions: { type: "array", items: { type: "string" } } },
    required: ["suggestions"],
    additionalProperties: false,
  };
  const params = {
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: user }],
    // Fast mode: least thinking. (Thinking can't be switched off on these models; effort is the control.)
    output_config: { effort: fast ? "low" : "medium", format: { type: "json_schema", schema } },
  };
  // On a safety decline, let the API retry on its recommended fallback model (not offered for Haiku).
  if (model !== "claude-haiku-5-5") {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  let response;
  try {
    response = await client.beta.messages.create(params);
  } catch (err) {
    throw new Error(claudeErrorMessage(err, anthropicModule));
  }
  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined this request." + (response.stop_details?.explanation ? " " + response.stop_details.explanation : ""));
  }
  if (response.stop_reason === "max_tokens") throw new Error("The response was cut off. Try again.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return parseSuggestions(text);
}

function claudeErrorMessage(err, mod) {
  const A = mod?.default;
  if (A && err instanceof A.AuthenticationError) return "Claude rejected the API key. Check it in AI settings.";
  if (A && err instanceof A.PermissionDeniedError) return "This API key isn't allowed to use that model.";
  if (A && err instanceof A.RateLimitError) return "Rate limit reached — wait a moment and try again.";
  if (A && err instanceof A.BadRequestError) {
    const msg = err.error?.error?.message || err.message;
    if (/credit balance/i.test(msg)) return "Your Anthropic account is out of credit. Add some at console.anthropic.com.";
    return "Claude couldn't process the request: " + msg;
  }
  if (A && err instanceof A.InternalServerError) return "Claude is having trouble right now. Try again shortly.";
  if (A && err instanceof A.APIConnectionError) return "Couldn't reach Claude. Check your connection.";
  if (A && err instanceof A.APIError) return "Claude error: " + err.message;
  return err.message || String(err);
}

async function listGeminiModels(key) {
  const res = await fetch(`${GEMINI_API}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(geminiError(res.status, data));
  return (data.models || [])
    .filter((m) => /^models\/gemini/.test(m.name) && (m.supportedGenerationMethods || []).includes("generateContent"))
    .filter((m) => !/(embedding|tts|image|audio|live|vision|robotics|computer)/i.test(m.name))
    .map((m) => ({ id: m.name.replace(/^models\//, ""), label: m.displayName || m.name }));
}

// Fast mode asks for the least thinking. Not every Gemini model accepts every level,
// so if one is rejected, retry with the next.
async function askGemini({ key, model, user, fast }) {
  const levels = fast ? ["minimal", "low", null] : [null];
  for (let i = 0; i < levels.length; i++) {
    try {
      return await askGeminiOnce({ key, model, user, thinkingLevel: levels[i] });
    } catch (err) {
      const last = i === levels.length - 1;
      if (last || !(err.status === 400 && /thinking/i.test(err.message))) throw err;
    }
  }
}

async function askGeminiOnce({ key, model, user, thinkingLevel }) {
  const generationConfig = {
    responseMimeType: "application/json",
    responseSchema: { type: "OBJECT", properties: { suggestions: { type: "ARRAY", items: { type: "STRING" } } }, required: ["suggestions"] },
  };
  if (thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel };
  const res = await fetch(`${GEMINI_API}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(geminiError(res.status, data)), { status: res.status });
  const cand = data.candidates?.[0];
  if (!cand) throw new Error("Gemini returned no answer" + (data.promptFeedback?.blockReason ? ` (blocked: ${data.promptFeedback.blockReason})` : "."));
  if (cand.finishReason && !["STOP", "MAX_TOKENS"].includes(cand.finishReason)) {
    throw new Error(`Gemini stopped early (${cand.finishReason}).`);
  }
  return parseSuggestions((cand.content?.parts || []).map((p) => p.text || "").join(""));
}

function geminiError(status, data) {
  const msg = data?.error?.message || `HTTP ${status}`;
  if (status === 400 && /api key/i.test(msg)) return "Gemini rejected the API key. Check it in AI settings.";
  if (status === 403) return "Gemini refused the request: " + msg;
  if (status === 429) return "Gemini rate limit reached (the free tier allows a limited number of requests per minute/day). Wait and try again.";
  return "Gemini error: " + msg;
}

function parseSuggestions(text) {
  let list;
  try { list = JSON.parse(text).suggestions; } catch { list = text.split("\n"); }
  return (list || [])
    .map((s) => String(s).trim().replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").replace(/^["“]|["”]$/g, "").trim())
    .filter(Boolean);
}

// ---------- prompt ----------
function buildPrompt({ title, topic, lines, index, mode, syllables, rhymeWith, startsWith, endsWith, reword }) {
  const marked = lines.map((l, i) => (i === index ? `${l}    <<< SELECTED LINE` : l)).join("\n");
  const target = lines[index] ?? "";
  const parts = [];
  if (title) parts.push(`Song title: ${title}`);
  if (topic) parts.push(`Topic / feel: ${topic}`);
  parts.push(`Lyrics so far (text in [brackets] marks song sections and isn't sung):\n<lyrics>\n${marked || "(empty)"}\n</lyrics>`);
  // "Reword to fit the rhyme": keep the line's meaning, change only the wording so it ends on the rhyme.
  const rewording = mode === "rewrite" && reword && rhymeWith && target.trim();
  if (rewording) {
    parts.push(`Suggest 6 ways to reword the selected line: "${target}". Keep its meaning, imagery and tone as close to the original as you can and add no new ideas, but change the wording so the line ends on a word that rhymes with "${rhymeWith}".`);
  } else if (mode === "rewrite") {
    parts.push(target.trim()
      ? `Suggest 6 alternative versions of the selected line: "${target}". Keep its role in the song but try different images and wording.`
      : "The selected line is empty. Suggest 6 lines that could go there, fitting the lines around it.");
  } else {
    parts.push(`Suggest 6 options for the line that comes right after the selected line${target.trim() ? ` ("${target}")` : ""}, continuing the song naturally.`);
  }
  if (startsWith) parts.push(`Each line must begin with the words "${startsWith}", exactly as written, and then carry on from there.`);
  if (endsWith) parts.push(`Each line must end with the words "${endsWith}", exactly as written, with the rest of the line leading into them.`);
  if (syllables) parts.push(`Each line must have exactly ${syllables} syllables.`);
  if (rhymeWith && !rewording) parts.push(`Each line must end on a word that rhymes with "${rhymeWith}".`);
  return parts.join("\n\n");
}

// ---------- start / end words ----------
const cleanAffix = (v) => v.replace(/^[\s"“”]+|[\s"“”]+$/g, "").replace(/\s+/g, " ");
const norm = (s) => s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^\p{L}\p{N}'\s]/gu, " ").replace(/\s+/g, " ").trim();
const startsOk = (line, s) => !s || (norm(line) + " ").startsWith(norm(s) + " ");
const endsOk = (line, e) => !e || (" " + norm(line)).endsWith(" " + norm(e));

// ---------- UI ----------
export function initSuggest(editor) {
  const els = {
    settings: $("aiSettings"), provider: $("aiProvider"), key: $("aiKey"), model: $("aiModel"),
    remember: $("aiRemember"), forget: $("aiForget"), keyHelp: $("aiKeyHelp"), summary: $("aiSummary"),
    topic: $("topic"), targetNum: $("targetNum"), targetText: $("targetText"), matchSyl: $("matchSyl"),
    sylCount: $("sylCount"), sylUp: $("sylUp"), sylDown: $("sylDown"), sylReset: $("sylReset"), rhymeWith: $("rhymeWith"), rhymeOn: $("rhymeOn"), rhymeReset: $("rhymeReset"), rewordOn: $("rewordOn"), rewordRow: $("rewordRow"), rewordNote: $("rewordNote"),
    startOn: $("startOn"), startWith: $("startWith"), endOn: $("endOn"), endWith: $("endWith"), endNote: $("endNote"), rhymeRow: $("rhymeRow"), go: $("suggestBtn"), out: $("suggestOut"),
    modeRewrite: $("modeRewrite"), modeNext: $("modeNext"), fast: $("aiFast"),
  };
  // One-time: switch existing Gemini users to the new default model.
  if (readStore("localStorage", "geminiDefault") !== GEMINI_DEFAULT) {
    settings.setModel("gemini", null);
    writeStore("localStorage", "geminiDefault", GEMINI_DEFAULT);
  }
  els.fast.checked = settings.fast;
  els.fast.addEventListener("change", () => { settings.fast = els.fast.checked; });
  let lineIndex = 0;
  let geminiModels = null;

  function renderModels() {
    const p = els.provider.value;
    const saved = settings.model(p);
    let options;
    if (p === "claude") options = CLAUDE_MODELS;
    else if (geminiModels) options = geminiModels;
    else options = [{ id: saved || "", label: settings.key("gemini") ? "Loading models…" : "Enter your key to load models" }];
    els.model.replaceChildren(...options.map((m) => new Option(m.label, m.id)));
    const pick = options.find((m) => m.id === saved) ||
      (p === "gemini" && (options.find((m) => m.id === GEMINI_DEFAULT) ||
        options.find((m) => m.id.startsWith(GEMINI_DEFAULT) && !/lite/i.test(m.id)) ||
        options.find((m) => /flash/i.test(m.id) && !/lite|preview|exp/i.test(m.id)))) || options[0];
    if (pick) els.model.value = pick.id;
  }

  async function loadGeminiModels() {
    const key = settings.key("gemini");
    if (!key) { geminiModels = null; renderModels(); return; }
    try {
      geminiModels = await listGeminiModels(key);
      if (!geminiModels.length) throw new Error("No usable Gemini models found for this key.");
    } catch (err) {
      geminiModels = null;
      showError(err.message);
    }
    renderModels();
    updateSummary();
  }

  function renderKeyHelp() {
    els.keyHelp.innerHTML = els.provider.value === "claude"
      ? `Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>. Paid per use from prepaid credit — set a monthly limit there.`
      : `Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com</a> (sign in with your Google account). The free tier is rate-limited and Google may use free-tier prompts to improve its products.`;
  }

  function updateSummary() {
    const p = els.provider.value;
    const has = !!settings.key(p);
    els.summary.textContent = has
      ? `${p === "claude" ? "Claude" : "Gemini"} · ${els.model.selectedOptions[0]?.textContent.split(" — ")[0] || els.model.value}`
      : "not set up";
    els.forget.disabled = !has;
  }

  function loadProvider() {
    const p = els.provider.value;
    els.key.value = settings.key(p);
    renderKeyHelp();
    renderModels();
    updateSummary();
    if (p === "gemini" && !geminiModels && els.key.value) loadGeminiModels();
  }

  els.provider.value = settings.provider;
  els.remember.checked = settings.remember;
  loadProvider();
  els.settings.open = !settings.key(els.provider.value);

  els.provider.addEventListener("change", () => { settings.provider = els.provider.value; loadProvider(); });
  els.key.addEventListener("change", () => {
    const p = els.provider.value;
    settings.setKey(p, els.key.value.trim(), els.remember.checked);
    if (p === "gemini") { geminiModels = null; loadGeminiModels(); }
    updateSummary();
  });
  els.remember.addEventListener("change", () => {
    settings.remember = els.remember.checked;
    for (const p of ["claude", "gemini"]) settings.setKey(p, settings.key(p), els.remember.checked);
  });
  els.model.addEventListener("change", () => { settings.setModel(els.provider.value, els.model.value); updateSummary(); });
  els.forget.addEventListener("click", () => {
    settings.setKey(els.provider.value, "", false);
    els.key.value = "";
    if (els.provider.value === "gemini") geminiModels = null;
    renderModels();
    updateSummary();
    editor.toast("Key removed from this browser");
  });

  // Topic is remembered per browser.
  els.topic.value = readStore("localStorage", "topic") || "";
  els.topic.addEventListener("input", () => writeStore("localStorage", "topic", els.topic.value));

  function mode() { return els.modeNext.checked ? "next" : "rewrite"; }

  // ---- syllable target ----
  // Starts at the selected line's count and follows it as you type, until you set your own
  // number; picking a different line starts it over from that line.
  let sylLine = -1, sylCustom = false, sylDefault = 8;
  const clampSyl = (n) => Math.min(40, Math.max(1, Math.round(n) || 1));

  function lineDefault(lines, index) {
    // An empty line borrows the count of the nearest lyric line above it.
    for (let i = index; i >= 0; i--) {
      const s = editor.lineSyllables(lines[i] || "");
      if (s) return s.min;
    }
    return 8;
  }
  function updateSyl(lines) {
    sylDefault = lineDefault(lines, lineIndex);
    if (lineIndex !== sylLine) { sylLine = lineIndex; sylCustom = false; }
    if (!sylCustom) els.sylCount.value = sylDefault;
    const differs = sylCustom && +els.sylCount.value !== sylDefault;
    els.sylReset.hidden = !differs;
    els.sylReset.textContent = `reset to ${sylDefault} (${(lines[lineIndex] || "").trim() ? "this line" : "line above"})`;
  }
  function setSyl(n) {
    els.sylCount.value = clampSyl(n);
    sylCustom = true;
    els.matchSyl.checked = true;
    syncSylEnabled();
    updateSyl(editor.context().lines);
  }
  function syncSylEnabled() {
    els.sylCount.disabled = els.sylUp.disabled = els.sylDown.disabled = !els.matchSyl.checked;
    writeStore("localStorage", "matchSyl", els.matchSyl.checked ? "1" : "0");
  }
  els.matchSyl.checked = readStore("localStorage", "matchSyl") !== "0";
  syncSylEnabled();
  els.matchSyl.addEventListener("change", syncSylEnabled);
  els.sylUp.addEventListener("click", () => setSyl(+els.sylCount.value + 1));
  els.sylDown.addEventListener("click", () => setSyl(+els.sylCount.value - 1));
  els.sylCount.addEventListener("input", () => {
    if (els.sylCount.value === "") return; // let people clear the box while typing
    sylCustom = true;
    updateSyl(editor.context().lines);
  });
  els.sylCount.addEventListener("change", () => setSyl(+els.sylCount.value));
  els.sylReset.addEventListener("click", () => { sylCustom = false; updateSyl(editor.context().lines); });

  // ---- rhyme target ----
  // In "Write the next line" mode the rhyme word starts as the last word of the selected line
  // (or of the nearest lyric line above an empty one) and follows it, until you type your own;
  // picking another line or switching modes starts over. The checkbox turns the rhyme on/off.
  let rhymeLine = -1, rhymeMode = null, rhymeCustom = false, rhymeDefault = "";
  const stripTags = (line) => line.replace(/\[[^\]]*\]?/g, " ");

  function lastWord(lines, index) {
    for (let i = index; i >= 0; i--) {
      const m = stripTags(lines[i] || "").match(/([a-z][a-z'\u2019]*)[^a-z]*$/i);
      if (m) return m[1].replace(/(?<!in)['\u2019]+$/i, "");
    }
    return "";
  }
  function updateRhyme(lines) {
    const m = mode();
    rhymeDefault = m === "next" ? lastWord(lines, lineIndex) : "";
    if (m !== rhymeMode) {
      // Entering "next line" turns the rhyme on; leaving it drops the automatic word.
      if (m === "next" && rhymeMode !== null) els.rhymeOn.checked = true;
      if (m === "rewrite" && !rhymeCustom) els.rhymeOn.checked = false;
      rhymeMode = m;
      rhymeLine = lineIndex;
      if (m === "next") rhymeCustom = false;
    } else if (lineIndex !== rhymeLine) {
      rhymeLine = lineIndex;
      if (m === "next") rhymeCustom = false;
    }
    if (!rhymeCustom) els.rhymeWith.value = rhymeDefault;
    els.rhymeWith.disabled = !els.rhymeOn.checked;
    const differs = m === "next" && rhymeCustom && rhymeDefault && els.rhymeWith.value.trim() !== rhymeDefault;
    els.rhymeReset.hidden = !differs;
    els.rhymeReset.textContent = `reset to “${rhymeDefault}”`;
    writeStore("localStorage", "rhymeOn:" + m, els.rhymeOn.checked ? "1" : "0");
  }
  els.rhymeWith.addEventListener("input", () => {
    rhymeCustom = els.rhymeWith.value.trim() !== "";
    if (rhymeCustom) els.rhymeOn.checked = true;
    updateRhyme(editor.context().lines);
  });
  els.rhymeOn.addEventListener("change", () => updateRhyme(editor.context().lines));
  els.rhymeReset.addEventListener("click", () => { rhymeCustom = false; updateRhyme(editor.context().lines); });
  for (const r of [els.modeNext, els.modeRewrite]) r.addEventListener("change", () => updateRhyme(editor.context().lines));
  // Start in whichever on/off state was last used for the starting mode.
  els.rhymeOn.checked = readStore("localStorage", "rhymeOn:" + mode()) === "1" || (mode() === "next" && readStore("localStorage", "rhymeOn:next") === null);

  // ---- start / end words ----
  // Optional: the line must begin and/or end with the words typed. Typing ticks the box.
  // A fixed ending makes "Should rhyme with" pointless, so the rhyme is skipped while it's on.
  const startValue = () => (els.startOn.checked ? cleanAffix(els.startWith.value) : "");
  const endValue = () => (els.endOn.checked ? cleanAffix(els.endWith.value) : "");
  function updateAffix() {
    const fixedEnd = !!endValue();
    els.endNote.hidden = !fixedEnd;
    els.rhymeRow.classList.toggle("skipped", fixedEnd);
  }
  for (const [on, input] of [[els.startOn, els.startWith], [els.endOn, els.endWith]]) {
    input.addEventListener("input", () => { if (input.value.trim()) on.checked = true; updateAffix(); });
    on.addEventListener("change", () => { updateAffix(); if (on.checked && !input.value.trim()) input.focus(); });
  }
  updateAffix();

  // ---- reword to fit the rhyme ----
  // In "Rewrite this line", this keeps the line's meaning and only changes its wording so it ends
  // on the rhyme word. With a topic there are new ideas to bring in, so a topic switches it off
  // (as do an empty line and a fixed ending, which leave nothing to reword).
  let rewordPref = false;
  function rewordBlocked(lines) {
    if (els.topic.value.trim()) return "Not available while there's a Topic / feel — clear it to use this.";
    if (!(lines[lineIndex] || "").trim()) return "Select a line that has words in it.";
    if (endValue()) return "Not available while “Line ends with” is on.";
    return "";
  }
  function updateReword() {
    const why = rewordBlocked(editor.context().lines);
    els.rewordRow.hidden = mode() !== "rewrite";
    els.rewordOn.disabled = !!why;
    els.rewordOn.checked = rewordPref && !why;
    els.rewordRow.classList.toggle("off", !!why);
    els.rewordNote.textContent = why || "Keeps its meaning and changes the wording so the line ends on the rhyme word.";
  }
  els.rewordOn.addEventListener("change", () => {
    rewordPref = els.rewordOn.checked;
    if (!rewordPref) return;
    els.rhymeOn.checked = true;
    if (!els.rhymeWith.value.trim()) {
      // Suggest the last word of the line above (a couplet); the box stays editable.
      const guess = lastWord(editor.context().lines, lineIndex - 1);
      if (guess) { els.rhymeWith.value = guess; rhymeCustom = true; }
    }
    updateRhyme(editor.context().lines);
    if (!els.rhymeWith.value.trim()) els.rhymeWith.focus();
  });
  els.rhymeOn.addEventListener("change", () => { if (!els.rhymeOn.checked) rewordPref = false; updateReword(); });
  for (const el of [els.modeNext, els.modeRewrite]) el.addEventListener("change", updateReword);
  for (const el of [els.topic, els.endWith]) el.addEventListener("input", updateReword);
  els.endOn.addEventListener("change", updateReword);
  updateReword();

  function refreshTarget() {
    const { lines } = editor.context();
    lineIndex = Math.min(editor.currentLine(), lines.length - 1);
    const text = lines[lineIndex] || "";
    els.targetNum.textContent = `(line ${lineIndex + 1})`;
    els.targetText.textContent = text.trim() ? text : "— empty line —";
    els.targetText.classList.toggle("empty", !text.trim());
    updateSyl(lines);
    updateRhyme(lines);
    updateReword();
  }

  function showError(msg) {
    const p = document.createElement("p");
    p.className = "error";
    p.textContent = msg;
    els.out.replaceChildren(p);
  }

  async function run() {
    const p = els.provider.value;
    const key = settings.key(p);
    if (!key) { els.settings.open = true; els.key.focus(); return showError("Add an API key in AI settings first."); }
    const model = els.model.value;
    if (!model) return showError("Pick a model in AI settings.");
    refreshTarget();
    const { title, lines } = editor.context();
    const syllables = els.matchSyl.checked ? clampSyl(+els.sylCount.value) : null;
    if (syllables) els.sylCount.value = syllables;
    const reword = mode() === "rewrite" && els.rewordOn.checked && !els.rewordOn.disabled;
    const rhymeWord = els.rhymeOn.checked && !endValue() ? els.rhymeWith.value.trim() : "";
    if (reword && !rhymeWord) { els.rhymeWith.focus(); return showError("Type the word to rhyme with first."); }
    const req = {
      title, topic: els.topic.value.trim(), lines, index: lineIndex, mode: mode(),
      syllables, rhymeWith: rhymeWord, reword,
      startsWith: startValue(), endsWith: endValue(),
    };
    const forIndex = lineIndex, forMode = mode();
    els.go.disabled = true;
    els.go.textContent = "Thinking…";
    els.out.innerHTML = `<p class="hint">Asking ${p === "claude" ? "Claude" : "Gemini"}…</p>`;
    try {
      const list = await (p === "claude" ? askClaude : askGemini)({ key, model, user: buildPrompt(req), fast: els.fast.checked });
      if (!list.length) throw new Error("No suggestions came back. Try again.");
      renderSuggestions(list, forIndex, forMode, syllables, { starts: req.startsWith, ends: req.endsWith });
    } catch (err) {
      showError(err.message || String(err));
    } finally {
      els.go.disabled = false;
      els.go.textContent = "Suggest lines";
    }
  }

  function renderSuggestions(list, index, forMode, targetSyl, affix = {}) {
    const ul = document.createElement("ul");
    ul.className = "suggestions";
    let flagged = 0;
    for (const text of list) {
      const li = document.createElement("li");
      const s = editor.lineSyllables(text);
      const count = s ? (s.min === s.max ? `${s.min}` : `${s.min}–${s.max}`) : "0";
      const fits = targetSyl && s && s.min <= targetSyl && targetSyl <= s.max;
      li.innerHTML = `<span class="syl ${fits ? "fits" : ""}" title="syllables">${count}</span><span class="text"></span>
        <span class="acts"><button type="button" data-act="use">${forMode === "rewrite" ? "Replace line" : "Insert below"}</button>
        <button type="button" data-act="copy">Copy</button></span>`;
      li.querySelector(".text").textContent = text;
      // The AI doesn't always keep to the words asked for, so check each line and say so.
      const problems = [];
      if (!startsOk(text, affix.starts)) problems.push(`doesn’t start with “${affix.starts}”`);
      if (!endsOk(text, affix.ends)) problems.push(`doesn’t end with “${affix.ends}”`);
      if (problems.length) {
        flagged++;
        li.classList.add("mismatch");
        const flag = document.createElement("span");
        flag.className = "flag";
        flag.textContent = "⚠ " + problems.join(" and ");
        li.querySelector(".acts").before(flag);
      }
      li.querySelector('[data-act="use"]').onclick = () => {
        if (forMode === "rewrite") editor.replaceLine(index, text);
        else editor.insertAfter(index, text);
        refreshTarget();
      };
      li.querySelector('[data-act="copy"]').onclick = () => editor.copy(text);
      ul.appendChild(li);
    }
    const note = document.createElement("p");
    note.className = "hint small";
    note.textContent = forMode === "rewrite"
      ? `Alternatives for line ${index + 1}.`
      : `Options for the line after line ${index + 1}.`;
    note.textContent += targetSyl
      ? ` Numbers are syllable counts; highlighted ones hit ${targetSyl}.`
      : " Numbers are syllable counts.";
    if (flagged) note.textContent += ` ${flagged} of ${list.length} didn’t keep to the start/end words you asked for and ${flagged === 1 ? "is" : "are"} marked.`;
    els.out.replaceChildren(note, ul);
  }

  els.go.addEventListener("click", run);
  return { refreshTarget };
}
