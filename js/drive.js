// Save and open songs in a "Lyricpad" folder on the user's Google Drive.
//
// Uses Google Identity Services for sign-in and the Drive API with the drive.file scope,
// which only gives access to files this app created - never the rest of the user's Drive.
// The access token (Google gives one hour) is kept in localStorage, so reopening the page
// within the hour doesn't need another sign-in; nothing is sent anywhere except Google.

import { GOOGLE_CLIENT_ID } from "./config.js?v=fd9c06b2";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "Lyricpad";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const GIS_URL = "https://accounts.google.com/gsi/client";
const FILE_FIELDS = "id,name,version,modifiedTime";
const AUTOSAVE_MS = 4000;

class NeedsSignIn extends Error {}

const store = {
  get(k) { try { return localStorage.getItem("lyricpad:drive:" + k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem("lyricpad:drive:" + k) : localStorage.setItem("lyricpad:drive:" + k, v); } catch { /* ignore */ } },
};

const clientId = () => GOOGLE_CLIENT_ID || store.get("clientId") || "";

// ---------- sign-in ----------
let gisReady = null;
function loadGis() {
  gisReady ||= new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement("script");
    s.src = GIS_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisReady = null; reject(new Error("Couldn't load Google sign-in. Check your connection.")); };
    document.head.appendChild(s);
  });
  return gisReady;
}

// { value, expires }. Read from localStorage each time, so tabs share a renewed token.
// (Older versions kept it in sessionStorage; that copy is moved over.)
try {
  const old = sessionStorage.getItem("lyricpad:drive:token");
  if (old) { if (!store.get("token")) store.set("token", old); sessionStorage.removeItem("lyricpad:drive:token"); }
} catch { /* ignore */ }
function getToken() {
  try { return JSON.parse(store.get("token")); } catch { return null; }
}
function setToken(t) { store.set("token", t ? JSON.stringify(t) : null); }
const tokenValid = () => { const t = getToken(); return !!t && t.expires > Date.now() + 60_000; };
// Renew this long before the hour is up (or any time after it has run out).
const RENEW_BEFORE_MS = 10 * 60_000;
const needsRenewal = () => { const t = getToken(); return !t || t.expires < Date.now() + RENEW_BEFORE_MS; };
let onToken = () => {}; // set by the UI: a new token arrived

// Browsers only allow a sign-in popup that opens directly from a click, with nothing
// awaited in between. So Google's script is loaded and the token client set up ahead of
// time (prepareSignIn, at page load), and signIn() opens the popup synchronously.
let tokenClient = null, pending = null, gisFailed = false;
let inflight = null, inflightAt = 0; // the token request in progress, so one click never opens two popups

function prepareSignIn() {
  if (!clientId()) return Promise.resolve();
  return loadGis().then(() => {
    gisFailed = false;
    if (tokenClient) return;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: SCOPE,
      callback: (resp) => {
        const p = pending;
        pending = null;
        if (resp.error) return p?.reject(new Error(resp.error_description || resp.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
          return p?.reject(new Error("Lyricpad needs permission to save files to your Drive. Please allow it when Google asks."));
        }
        setToken({ value: resp.access_token, expires: Date.now() + (Number(resp.expires_in) || 3600) * 1000 });
        store.set("connected", "1");
        rememberAccount();
        p?.resolve();
        onToken();
      },
      error_callback: (err) => {
        const p = pending;
        pending = null;
        p?.reject(new Error(err?.type === "popup_closed"
          ? "The Google sign-in window was closed."
          : err?.type === "popup_failed_to_open"
            ? "Your browser blocked the Google sign-in window. Allow pop-ups for this site, then press Save again."
            : "Google sign-in failed."));
      },
    });
  }).catch((err) => { gisFailed = true; throw err; });
}

// Opens Google's sign-in popup. Call it straight from a click handler, before any await.
function signIn() {
  if (!clientId()) return Promise.reject(new Error("Google Drive isn't set up yet."));
  if (!tokenClient) {
    prepareSignIn().catch(() => {});
    return Promise.reject(new Error(gisFailed
      ? "Couldn't load Google sign-in. If you use an ad or tracker blocker, allow accounts.google.com for this site, then try again."
      : "Google sign-in is still loading — try again in a moment."));
  }
  // The same click may already have started a quiet renewal (below): share its popup.
  if (inflight && Date.now() - inflightAt < 2000) return inflight;
  pending?.reject(new Error("Sign-in was restarted."));
  inflightAt = Date.now();
  const req = inflight = new Promise((resolve, reject) => {
    pending = { resolve, reject };
    const connected = !!store.get("connected");
    const opts = { prompt: connected ? "" : "consent" };
    // Naming the account skips Google's account chooser when several accounts are signed in.
    if (connected && store.get("email")) opts.login_hint = store.get("email");
    tokenClient.requestAccessToken(opts);
  });
  req.catch(() => {}).finally(() => { if (inflight === req) inflight = null; });
  return req;
}

// Quiet renewal: Google's Drive permission lasts an hour, and a new one can only be asked
// for from a click (browsers block the popup otherwise). So when the hour is nearly up, or has
// run out, the next button click renews it. Having already agreed, the person sees Google's
// window open and close by itself. A failure isn't shown; it's retried a couple of minutes later.
let lastRenewFail = 0;
function renewOnClick(e) {
  if (!tokenClient || inflight || !store.get("connected") || !needsRenewal()) return;
  const el = e.target.closest?.("button, summary, a[href], label");
  if (!el || el.closest("[data-no-renew]")) return; // not typing or placing the cursor; not Disconnect
  if (Date.now() - lastRenewFail < 2 * 60_000) return;
  signIn().catch(() => { lastRenewFail = Date.now(); });
}

// The Google account's address, used only as the login_hint above (kept in this browser).
async function rememberAccount() {
  if (store.get("email")) return;
  try {
    const about = await (await api(`${API}/about?fields=user(emailAddress)`)).json();
    if (about.user?.emailAddress) store.set("email", about.user.emailAddress);
  } catch { /* only a convenience */ }
}

function signOut() {
  const t = getToken();
  if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t.value, () => {});
  setToken(null);
  store.set("connected", null);
  store.set("email", null);
  store.set("folder", null);
}

// ---------- Drive API ----------
async function api(url, opts = {}) {
  if (!tokenValid()) throw new NeedsSignIn("Sign in to Google Drive.");
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${getToken().value}` } });
  if (res.status === 401) {
    setToken(null);
    throw new NeedsSignIn("Your Google sign-in expired.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw Object.assign(new Error(res.status === 404 ? "That song is no longer on your Drive." : "Google Drive error: " + msg), { status: res.status });
  }
  return res;
}
const q = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function folderId() {
  const cached = store.get("folder");
  if (cached) {
    try {
      const f = await (await api(`${API}/files/${cached}?fields=id,trashed`)).json();
      if (!f.trashed) return cached;
    } catch (err) {
      if (err instanceof NeedsSignIn) throw err;
    }
  }
  const query = `name='${q(FOLDER_NAME)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const found = await (await api(`${API}/files?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive`)).json();
  let id = found.files?.[0]?.id;
  if (!id) {
    const made = await (await api(`${API}/files?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
    })).json();
    id = made.id;
  }
  store.set("folder", id);
  return id;
}

async function listSongs() {
  const folder = await folderId();
  const query = `'${folder}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`;
  const url = `${API}/files?q=${encodeURIComponent(query)}&fields=files(${FILE_FIELDS})&orderBy=modifiedTime desc&pageSize=500&spaces=drive`;
  return (await (await api(url)).json()).files || [];
}

async function fileInfo(id) {
  return (await api(`${API}/files/${id}?fields=${FILE_FIELDS},trashed`)).json();
}

async function readSong(id) {
  const [info, text] = await Promise.all([fileInfo(id), api(`${API}/files/${id}?alt=media`).then((r) => r.text())]);
  return { ...info, text };
}

async function writeSong({ id, title, text }) {
  const meta = { name: fileName(title), mimeType: "text/plain" };
  if (!id) meta.parents = [await folderId()];
  const boundary = "lyricpad" + Math.random().toString(36).slice(2);
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
  const url = id
    ? `${UPLOAD}/files/${id}?uploadType=multipart&fields=${FILE_FIELDS}`
    : `${UPLOAD}/files?uploadType=multipart&fields=${FILE_FIELDS}`;
  return (await api(url, { method: id ? "PATCH" : "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body })).json();
}

function fileName(title) {
  const clean = (title || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  return (clean || "Untitled song") + ".txt";
}
const titleFrom = (name) => name.replace(/\.txt$/i, "");

// ---------- UI ----------
export function initDrive(editor) {
  const $ = (id) => document.getElementById(id);
  const els = {
    open: $("songsBtn"), save: $("saveBtn"), dialog: $("songsDialog"), close: $("songsClose"),
    account: $("driveAccount"), setup: $("driveSetup"), clientInput: $("driveClientId"), clientSave: $("driveClientSave"),
    list: $("songList"), filter: $("songFilter"), newSong: $("newSong"), download: $("downloadTxt"), state: $("saveState"),
  };

  // The song in the editor and what's on Drive for it.
  let link = null;
  try { link = JSON.parse(store.get("link")); } catch { link = null; } // { id, version, saved: {title, text} }
  let saving = null, autosaveTimer = null, conflict = false, songs = [];

  const current = () => ({ title: editor.title(), text: editor.text() });
  const dirty = () => {
    const c = current();
    return !link || c.title !== link.saved.title || c.text !== link.saved.text;
  };
  const isEmpty = () => !editor.title().trim() && !editor.text().trim();
  function setLink(l) { link = l; store.set("link", l ? JSON.stringify(l) : null); }

  function showState(msg, kind = "") {
    els.state.textContent = msg;
    els.state.className = "save-state " + kind;
  }
  function refreshState() {
    if (!clientId()) return showState("");
    if (saving) return showState("Saving to Drive…");
    if (conflict) return showState("Changed on another device — press Save", "warn");
    if (!link) return showState(isEmpty() ? "" : "Not saved to Drive", "muted");
    if (dirty()) return showState(tokenValid() ? "Unsaved changes" : "Unsaved — press Save to reconnect", tokenValid() ? "muted" : "warn");
    const t = new Date(link.modifiedTime || Date.now());
    showState(`Saved to Drive · ${t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`, "ok");
  }

  // Signs in first if needed. Must be reached from a click with nothing awaited before it.
  async function withSignIn(fn) {
    if (!tokenValid()) await signIn();
    try {
      return await fn();
    } catch (err) {
      // Too late to open a popup here (the click is "used up"), so ask for another click.
      if (err instanceof NeedsSignIn) throw new Error("Your Google sign-in expired. Press Save again to reconnect.");
      throw err;
    }
  }

  // Save the editor to Drive. "auto" saves never prompt or open sign-in windows.
  async function save({ auto = false } = {}) {
    if (!clientId()) { if (!auto) openDialog(); return; }
    if (saving) return saving;
    if (auto && (!link || !tokenValid() || conflict || !dirty())) return;
    const snapshot = current();
    saving = (async () => {
      refreshState();
      const run = async () => {
        if (link) {
          // Someone (another device) may have changed the file since we last saved or opened it.
          let info;
          try { info = await fileInfo(link.id); } catch (err) {
            if (err.status === 404) { setLink(null); return run(); }
            throw err;
          }
          if (info.trashed) { setLink(null); return run(); }
          if (String(info.version) !== String(link.version) && !conflict) {
            conflict = true;
            if (auto) return null;
          }
          if (conflict) {
            if (!confirm(`“${titleFrom(info.name)}” was changed somewhere else (maybe on another device) since you opened it here.\n\nReplace it with what's in the editor now?`)) return null;
          }
        }
        return writeSong({ id: link?.id, ...snapshot });
      };
      const saved = auto ? await run() : await withSignIn(run);
      if (saved) {
        conflict = false;
        setLink({ id: saved.id, version: saved.version, modifiedTime: saved.modifiedTime, saved: snapshot });
        if (!auto) editor.toast(`Saved “${titleFrom(saved.name)}” to Google Drive`);
      }
    })();
    try { await saving; } catch (err) {
      if (!auto) editor.toast(err.message);
      else if (!(err instanceof NeedsSignIn)) console.error(err);
    } finally {
      saving = null;
      refreshState();
      if (dirty()) scheduleAutosave(); // edits made while saving
    }
  }

  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    if (link && clientId()) autosaveTimer = setTimeout(() => save({ auto: true }), AUTOSAVE_MS);
  }

  function confirmDiscard(action) {
    if (isEmpty() || (link && !dirty())) return true;
    const where = link ? "haven't been saved to Drive" : "aren't saved to Drive";
    return confirm(`The song in the editor has changes that ${where}. ${action} anyway?\n\n(Its text is lost unless you save or download it first.)`);
  }

  async function openSong(id) {
    if (!confirmDiscard("Open another song")) return;
    try {
      const song = await withSignIn(() => readSong(id));
      const title = titleFrom(song.name);
      const text = song.text.replace(/\r\n/g, "\n");
      editor.load({ title, text });
      conflict = false;
      setLink({ id: song.id, version: song.version, modifiedTime: song.modifiedTime, saved: { title, text } });
      els.dialog.close();
      editor.toast(`Opened “${title}”`);
    } catch (err) {
      editor.toast(err.message);
    }
    refreshState();
  }

  function newSong() {
    if (!confirmDiscard("Start a new song")) return;
    editor.load({ title: "", text: "" });
    setLink(null);
    conflict = false;
    els.dialog.close();
    refreshState();
    editor.focus();
  }

  // ---------- dialog ----------
  function renderAccount() {
    const configured = !!clientId();
    els.setup.hidden = configured;
    els.account.hidden = !configured;
    els.filter.hidden = !configured || !tokenValid();
    if (!configured) return;
    els.account.replaceChildren();
    const span = document.createElement("span");
    const btn = document.createElement("button");
    btn.type = "button";
    if (tokenValid()) {
      span.textContent = "Connected to Google Drive — songs are in the “Lyricpad” folder.";
      btn.textContent = "Disconnect";
      btn.className = "ghost";
      btn.dataset.noRenew = "";
      btn.onclick = () => { signOut(); songs = []; renderAccount(); renderList(); refreshState(); };
    } else {
      span.textContent = "Connect Google Drive to save songs and open them on any device.";
      btn.textContent = "Connect Google Drive";
      btn.className = "primary";
      btn.onclick = async () => {
        try { await signIn(); await loadList(); } catch (err) { editor.toast(err.message); }
        renderAccount();
        refreshState();
      };
    }
    els.account.append(span, btn);
  }

  function renderList() {
    if (!clientId() || !tokenValid()) { els.list.replaceChildren(); return; }
    const f = els.filter.value.trim().toLowerCase();
    const shown = songs.filter((s) => !f || s.name.toLowerCase().includes(f));
    if (!shown.length) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = songs.length ? "No songs match." : "No songs saved yet. Press Save to put this one on your Drive.";
      els.list.replaceChildren(p);
      return;
    }
    const ul = document.createElement("ul");
    for (const s of shown) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "song" + (link?.id === s.id ? " current" : "");
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = titleFrom(s.name);
      const when = document.createElement("span");
      when.className = "when";
      when.textContent = new Date(s.modifiedTime).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
      b.append(name, when);
      b.onclick = () => openSong(s.id);
      li.appendChild(b);
      ul.appendChild(li);
    }
    els.list.replaceChildren(ul);
  }

  async function loadList() {
    els.list.innerHTML = `<p class="hint">Loading your songs…</p>`;
    try {
      songs = await listSongs();
    } catch (err) {
      songs = [];
      if (err instanceof NeedsSignIn) renderAccount();
      else editor.toast(err.message);
    }
    renderList();
  }

  function openDialog() {
    renderAccount();
    els.list.replaceChildren();
    if (els.dialog.showModal) els.dialog.showModal(); else els.dialog.setAttribute("open", "");
    if (tokenValid()) loadList();
  }

  els.open.addEventListener("click", openDialog);
  els.close.addEventListener("click", () => els.dialog.close());
  els.dialog.addEventListener("click", (e) => { if (e.target === els.dialog) els.dialog.close(); }); // click outside
  els.filter.addEventListener("input", renderList);
  els.newSong.addEventListener("click", newSong);
  els.download.addEventListener("click", () => editor.download());
  els.save.addEventListener("click", () => save());
  els.clientSave.addEventListener("click", () => {
    const v = els.clientInput.value.trim();
    if (!/\.apps\.googleusercontent\.com$/.test(v)) return editor.toast("That doesn't look like a Google OAuth client ID");
    store.set("clientId", v);
    prepareSignIn().catch(() => {});
    renderAccount();
    refreshState();
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (clientId()) save(); else editor.download();
    }
  });

  // Renew the Drive permission on the next button click when it's nearly out (see renewOnClick).
  // Capture phase, so it runs before the button's own handler (Save shares the same popup).
  document.addEventListener("click", renewOnClick, true);
  onToken = () => { renderAccount(); refreshState(); if (dirty()) scheduleAutosave(); };
  // Another tab signed in, renewed or disconnected.
  window.addEventListener("storage", (e) => { if (e.key === "lyricpad:drive:token") refreshState(); });

  prepareSignIn().catch((err) => console.error(err));
  return {
    // Called by the editor on every change.
    edited() { refreshState(); scheduleAutosave(); },
    // Called once the editor has restored the last song.
    ready: refreshState,
  };
}
