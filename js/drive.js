// Save and open songs on the user's Google Drive, in each song's own folder:
// GP Song Tools / <song title> / lyrics / <title>.txt (shared with the other GP Song Tools; see songdrive.js).
// Songs saved by older versions sit in a flat "Lyricpad" folder; they can be moved over (moveOld).
//
// Uses Google Identity Services for sign-in and the Drive API with the drive.file scope,
// which only gives access to files this app created - never the rest of the user's Drive.
// The access token (Google gives one hour) is kept in localStorage, so reopening the page
// within the hour doesn't need another sign-in; nothing is sent anywhere except Google.

import { GOOGLE_CLIENT_ID } from "./config.js?v=b62c520e";
import {
  fileName, titleFrom, isTxt, folderNameFor, moveTargets, freeFileName, batches,
  lyricsFoldersQuery, songFilesQuery, sameTitle, FOLDER_MIME, UNTITLED,
} from "./drivehelpers.js?v=b62c520e"; // also loads songdrive.js (global SongDrive)

const SD = globalThis.SongDrive;

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const OLD_FOLDER_NAME = "Lyricpad"; // where versions before 2026-11-24 saved songs
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
  if (/^sign out/i.test(el.textContent.trim())) return; // the Song spec panel's "Sign out of Drive"
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

// Hand Lyricpad's own sign-in to the shared Drive library (songdrive.js), so the Song spec panel's
// Save to Drive / Open from Drive… use this token and never open a second sign-in.
// Signing out from either place (the Songs window or the panel) lands here and signs out of both.
let onSignedOut = () => {};
SD.configure({
  auth: {
    token: () => (tokenValid() ? getToken().value : null),
    signIn: () => signIn(), // called synchronously from the click, so the popup still opens
    signOut: () => { signOut(); onSignedOut(); },
  },
});

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

async function listAll(query, fields) {
  const out = [];
  let pageToken = "";
  do {
    const url = `${API}/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(`nextPageToken,files(${fields})`)}&pageSize=1000&spaces=drive` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const r = await (await api(url)).json();
    out.push(...(r.files || []));
    pageToken = r.nextPageToken || "";
  } while (pageToken);
  return out;
}

const folderInfo = async (id) => (await api(`${API}/files/${id}?fields=id,name,trashed,mimeType,parents`)).json();
const isAuthError = (err) => err instanceof NeedsSignIn || err?.code === "auth";

// The old flat "Lyricpad" folder (cached id, else a folder of that name in My Drive). Never created any more.
async function findOldFolder() {
  const cached = store.get("folder");
  if (cached) {
    try {
      const f = await folderInfo(cached);
      if (!f.trashed) return cached;
    } catch (err) {
      if (isAuthError(err)) throw err;
    }
  }
  const query = `name = '${q(OLD_FOLDER_NAME)}' and mimeType = '${FOLDER_MIME}' and 'root' in parents and trashed = false`;
  const id = (await listAll(query, "id"))[0]?.id || null;
  store.set("folder", id);
  return id;
}

// { id, files }: the .txt songs still in the old folder, newest first.
async function listOldSongs() {
  const id = await findOldFolder();
  if (!id) return { id: null, files: [] };
  const files = (await listAll(`'${q(id)}' in parents and trashed = false and mimeType != '${FOLDER_MIME}'`, FILE_FIELDS)).filter((f) => isTxt(f.name));
  files.sort((a, b) => String(b.modifiedTime).localeCompare(String(a.modifiedTime)));
  return { id, files };
}

// Every Lyricpad song in GP Song Tools / * / lyrics /, newest first.
async function listSongs() {
  const root = await SD.rootFolder({ create: false });
  if (!root) return [];
  const songFolders = await SD.children(root.id, { foldersOnly: true });
  const folderById = new Map(songFolders.map((f) => [f.id, f]));
  const lyrics = [];
  for (const group of batches([...folderById.keys()])) lyrics.push(...await listAll(lyricsFoldersQuery(group), "id,name,parents"));
  const lyricsById = new Map(lyrics.map((l) => [l.id, l]));
  const files = [];
  for (const group of batches([...lyricsById.keys()])) files.push(...await listAll(songFilesQuery(group), FILE_FIELDS + ",parents"));
  return files.filter((f) => isTxt(f.name)).map((f) => {
    const ly = lyricsById.get(f.parents?.[0]);
    const folder = folderById.get(ly?.parents?.[0]);
    return { ...f, lyricsId: ly?.id, folderId: folder?.id, folderName: folder?.name || "" };
  }).sort((a, b) => String(b.modifiedTime).localeCompare(String(a.modifiedTime)));
}

async function fileInfo(id) {
  return (await api(`${API}/files/${id}?fields=${FILE_FIELDS},trashed`)).json();
}

async function readSong(id) {
  const [info, text] = await Promise.all([fileInfo(id), api(`${API}/files/${id}?alt=media`).then((r) => r.text())]);
  return { ...info, text };
}

// New songs (no id) go into `parentId`, the song's lyrics folder; later saves update the file where it is.
async function writeSong({ id, title, text, parentId }) {
  const meta = { name: fileName(title), mimeType: "text/plain" };
  if (!id) meta.parents = [parentId];
  const boundary = "lyricpad" + Math.random().toString(36).slice(2);
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
  const url = id
    ? `${UPLOAD}/files/${id}?uploadType=multipart&fields=${FILE_FIELDS}`
    : `${UPLOAD}/files?uploadType=multipart&fields=${FILE_FIELDS}`;
  return (await api(url, { method: id ? "PATCH" : "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body })).json();
}

// A throwaway song spec carrying only a title, which is all SongDrive.songFolder reads to name the folder.
function titleDoc(title) {
  const Sp = globalThis.SongSpec;
  const doc = Sp.parse(Sp.create());
  Sp.setSetting(doc, "title", title, { by: "lyricpad" });
  return doc;
}

// The song's GP Song Tools folder and its lyrics subfolder: the one the shared song spec points to when it is
// this same song, else the folder named after the title (made when missing; one that already exists is just used).
async function resolveFolders(title) {
  const Sp = globalThis.SongSpec;
  let specMatches = false, specFolder = "";
  try {
    const doc = Sp.parse(Sp.store.load() || Sp.create());
    specMatches = sameTitle(Sp.setting(doc, "title"), title);
    specFolder = Sp.setting(doc, "drive_folder") || "";
  } catch { /* no usable song spec: go by the title */ }
  let song = null;
  if (specMatches && specFolder) {
    try {
      const f = await folderInfo(specFolder);
      if (!f.trashed && f.mimeType === FOLDER_MIME) song = { id: f.id, name: f.name };
    } catch (err) {
      if (isAuthError(err)) throw err;
    }
  }
  song ||= await SD.songFolder(titleDoc(folderNameFor(title) || UNTITLED));
  const lyrics = await SD.subfolder(song.id, "lyrics");
  if (specMatches && !specFolder) {
    try { Sp.store.update((d) => Sp.setSetting(d, "drive_folder", song.id, { by: "lyricpad" })); } catch { /* the spec just doesn't get the link */ }
  }
  return { folderId: song.id, lyricsId: lyrics.id };
}

// Rename the song's folder to match a changed title. Returns { folderId, lyricsId, note } (note = a message for the person).
async function renameSongFolder(link, title) {
  let { folderId, lyricsId } = link;
  if (!folderId) {
    // A link from before folders were stored: only a file sitting in a "lyrics" folder has a song folder to rename.
    const parentId = (await api(`${API}/files/${link.id}?fields=parents`).then((r) => r.json())).parents?.[0];
    const ly = parentId && await folderInfo(parentId);
    if (!ly || ly.name !== "lyrics" || !ly.parents?.[0]) return {};
    lyricsId = ly.id;
    folderId = ly.parents[0];
  }
  const name = folderNameFor(title);
  if (!name) return { folderId, lyricsId };
  const current = await folderInfo(folderId);
  if (current.trashed || current.name === name) return { folderId, lyricsId };
  const root = await SD.rootFolder({ create: false });
  const clash = root && await SD.findFolder(root.id, name);
  if (clash && clash.id !== folderId) {
    return { folderId, lyricsId, note: `A folder named “${name}” already exists in GP Song Tools, so this song's folder keeps the name “${current.name}”. The song's file was renamed.` };
  }
  await SD.rename(folderId, name);
  return { folderId, lyricsId };
}

// ---------- UI ----------
export function initDrive(editor) {
  const $ = (id) => document.getElementById(id);
  const els = {
    open: $("songsBtn"), save: $("saveBtn"), dialog: $("songsDialog"), close: $("songsClose"),
    account: $("driveAccount"), setup: $("driveSetup"), clientInput: $("driveClientId"), clientSave: $("driveClientSave"),
    list: $("songList"), filter: $("songFilter"), newSong: $("newSong"), download: $("downloadTxt"), state: $("saveState"),
    moveDialog: $("moveDialog"), moveText: $("moveText"), moveYes: $("moveYes"), moveNo: $("moveNo"),
  };

  // The song in the editor and what's on Drive for it.
  let link = null;
  try { link = JSON.parse(store.get("link")); } catch { link = null; } // { id, version, modifiedTime, saved: {title, text}, folderId?, lyricsId? }
  let saving = null, autosaveTimer = null, conflict = false, songs = [], listRun = 0;
  let oldSongs = { id: null, files: [] }, oldChecked = false, checking = null, moving = null; // the old flat "Lyricpad" folder

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
      if (isAuthError(err)) { setToken(null); throw new Error("Your Google sign-in expired. Press Save again to reconnect."); }
      throw err;
    }
  }

  // Save the editor to Drive. "auto" saves never prompt or open sign-in windows.
  async function save({ auto = false } = {}) {
    if (!clientId()) { if (!auto) openDialog(); return; }
    if (saving) return saving;
    if (auto && (!link || !tokenValid() || conflict || !dirty())) return;
    let snapshot = current();
    saving = (async () => {
      refreshState();
      const run = async () => {
        let folders = null;
        if (link) {
          // Someone (another device) may have changed the file since we last saved or opened it.
          let info;
          try { info = await fileInfo(link.id); } catch (err) {
            if (err.status === 404) { setLink(null); return run(); }
            throw err;
          }
          if (info.trashed) { setLink(null); return run(); } // gone: save it again, in the song's folder
          if (String(info.version) !== String(link.version) && !conflict) {
            conflict = true;
            if (auto) return null;
          }
          if (conflict) {
            if (!confirm(`“${titleFrom(info.name)}” was changed somewhere else (maybe on another device) since you opened it here.\n\nReplace it with what's in the editor now?`)) return null;
          }
        } else {
          if (auto) return null;
          if (!snapshot.title.trim()) {
            const asked = (window.prompt("Song title", "") || "").trim();
            if (!asked) return null; // cancelled: nothing is saved
            editor.setTitle(asked);
            snapshot = current();
          }
          folders = await resolveFolders(snapshot.title);
        }
        const file = await writeSong({ id: link?.id, ...snapshot, parentId: folders?.lyricsId });
        return { file, folders };
      };
      const done = auto ? await run() : await withSignIn(run);
      if (done) {
        const { file, folders } = done;
        const before = link;
        conflict = false;
        setLink({ id: file.id, version: file.version, modifiedTime: file.modifiedTime, saved: snapshot, folderId: folders?.folderId ?? before?.folderId, lyricsId: folders?.lyricsId ?? before?.lyricsId });
        if (!auto) editor.toast(`Saved “${titleFrom(file.name)}” to Google Drive`);
        // The title changed on a song already on Drive: the song's folder follows it.
        if (before && before.saved.title !== snapshot.title && snapshot.title.trim()) {
          try {
            const r = await renameSongFolder(link, snapshot.title);
            if (r.folderId && link?.id === file.id) setLink({ ...link, folderId: r.folderId, lyricsId: r.lyricsId });
            if (r.note) editor.toast(r.note);
          } catch (err) {
            if (!isAuthError(err)) editor.toast(`Saved, but the song's folder couldn't be renamed: ${err.message}`);
          }
        }
      }
    })();
    try { await saving; } catch (err) {
      if (!auto) editor.toast(err.message);
      else if (!isAuthError(err)) console.error(err);
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

  async function openSong(entry) {
    if (!confirmDiscard("Open another song")) return;
    try {
      const song = await withSignIn(() => readSong(entry.id));
      const title = titleFrom(song.name);
      const text = song.text.replace(/\r\n/g, "\n");
      editor.load({ title, text });
      conflict = false;
      setLink({ id: song.id, version: song.version, modifiedTime: song.modifiedTime, saved: { title, text }, folderId: entry.folderId, lyricsId: entry.lyricsId });
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

  // ---------- old songs: the flat "Lyricpad" folder ----------
  // Asks once (the dialog in index.html); resolves true for Move, false for Not now.
  function askMove(n) {
    els.moveText.textContent = `Move your ${n} Lyricpad song${n === 1 ? "" : "s"} into GP Song Tools folders? Each song gets its own folder: GP Song Tools / <title> / lyrics.`;
    return new Promise((resolve) => {
      const finish = (yes) => { els.moveDialog.close(); resolve(yes); };
      els.moveYes.onclick = () => finish(true);
      els.moveNo.onclick = () => finish(false);
      els.moveDialog.oncancel = () => resolve(false); // Esc
      if (els.moveDialog.showModal) els.moveDialog.showModal(); else els.moveDialog.setAttribute("open", "");
    });
  }

  // Look for old songs (and, with offer, ask once whether to move them). Quiet when signed out.
  function checkOld({ offer = false } = {}) {
    if (!tokenValid() || moving) return Promise.resolve();
    checking ||= (async () => {
      try {
        oldSongs = await listOldSongs();
        oldChecked = true;
      } catch (err) {
        if (!isAuthError(err)) console.error(err);
        return;
      } finally { checking = null; }
      renderList();
      if (offer && oldSongs.files.length && !store.get("moveOffered")) {
        store.set("moveOffered", "1");
        if (await askMove(oldSongs.files.length)) await moveOld();
      }
    })();
    return checking;
  }

  // Move every old song into GP Song Tools / <title> / lyrics. Files keep their Drive ids.
  function moveOld() {
    if (moving) return moving;
    if (!tokenValid() || !oldSongs.files.length) return Promise.resolve();
    moving = (async () => {
      const files = oldSongs.files, oldId = oldSongs.id;
      let moved = 0;
      const errors = [];
      const progress = (i) => { const b = els.list.querySelector(".move-old"); if (b) { b.disabled = true; b.textContent = `Moving ${i} of ${files.length}…`; } };
      try {
        progress(0);
        const root = await SD.rootFolder();
        const existing = (await SD.children(root.id, { foldersOnly: true })).map((f) => f.name);
        const cache = new Map(); // lower-case folder name -> { folderId, lyricsId, names }
        let i = 0;
        for (const t of moveTargets(files, existing)) {
          progress(++i);
          try {
            const key = t.folder.toLowerCase();
            let c = cache.get(key);
            if (!c) {
              const song = await SD.songFolder(titleDoc(t.folder));
              const lyrics = await SD.subfolder(song.id, "lyrics");
              const names = (await SD.children(lyrics.id, { filesOnly: true })).map((f) => f.name);
              c = { folderId: song.id, lyricsId: lyrics.id, names: new Set(names) };
              cache.set(key, c);
            }
            let name = t.file.name;
            if ([...c.names].some((n) => n.toLowerCase() === name.toLowerCase())) name = freeFileName(t.title, c.names);
            if (name !== t.file.name) await SD.rename(t.file.id, name);
            await SD.move(t.file.id, c.lyricsId, { fromFolderId: oldId });
            c.names.add(name);
            moved++;
            if (link?.id === t.file.id) { // same file, same id: keep the link, with its new place and version
              const info = await fileInfo(t.file.id);
              setLink({ ...link, version: info.version, modifiedTime: info.modifiedTime, folderId: c.folderId, lyricsId: c.lyricsId });
            }
          } catch (err) {
            if (isAuthError(err)) throw err;
            errors.push(`“${t.title}” (${err.message})`);
          }
        }
        // Done with the old folder once nothing is left in it.
        if (!(await SD.children(oldId)).length) {
          await SD.trash(oldId);
          store.set("folder", null);
        }
      } catch (err) {
        errors.push(isAuthError(err) ? "Your Google sign-in expired. Press Move old songs again to reconnect." : err.message);
      }
      moving = null;
      await checkOld();
      if (els.dialog.open && tokenValid()) await loadList();
      refreshState();
      const left = oldSongs.files.length;
      editor.toast(
        `Moved ${moved} song${moved === 1 ? "" : "s"} into GP Song Tools folders.` +
        (errors.length ? ` Couldn't move ${errors.length}: ${errors.join("; ")}.` : "") +
        (left ? ` ${left} still in the old Lyricpad folder.` : ""),
      );
    })();
    renderList();
    return moving;
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
      span.textContent = "Connected to Google Drive — songs are in GP Song Tools / <song title> / lyrics.";
      btn.textContent = "Disconnect";
      btn.className = "ghost";
      btn.dataset.noRenew = "";
      btn.onclick = () => { SD.signOut(); }; // clears the shared notes, then signs out here too (onSignedOut)
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

  function songButton(s, { old = false } = {}) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    const isNow = link?.id === s.id;
    b.className = "song" + (isNow ? " current" : "");
    const name = document.createElement("span");
    name.className = "name";
    const title = titleFrom(s.name);
    name.textContent = title;
    if (!old && s.folderName && s.folderName !== folderNameFor(title)) {
      const f = document.createElement("span");
      f.className = "folder";
      f.textContent = `Folder: ${s.folderName}`;
      name.append(f);
    }
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = (isNow ? "Open now · " : "") + new Date(s.modifiedTime).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    b.append(name, when);
    b.onclick = () => openSong(s);
    li.appendChild(b);
    return li;
  }

  function renderList() {
    if (!clientId() || !tokenValid()) { els.list.replaceChildren(); return; }
    const f = els.filter.value.trim().toLowerCase();
    const match = (s) => !f || s.name.toLowerCase().includes(f);
    const parts = [];
    const shown = songs.filter(match);
    if (!shown.length) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = songs.length ? "No songs match." : "No songs saved yet. Press Save to put this one on your Drive.";
      parts.push(p);
    } else {
      const ul = document.createElement("ul");
      for (const s of shown) ul.appendChild(songButton(s));
      parts.push(ul);
    }
    const n = oldSongs.files.length;
    if (n) {
      const sec = document.createElement("div");
      sec.className = "old-songs";
      const mv = document.createElement("button");
      mv.type = "button";
      mv.className = "move-old primary";
      mv.textContent = moving ? "Moving…" : `Move old songs (${n})`;
      mv.disabled = !!moving;
      mv.onclick = () => moveOld();
      const head = document.createElement("p");
      head.className = "hint old-head";
      head.textContent = "In the old Lyricpad folder";
      const note = document.createElement("p");
      note.className = "hint small";
      note.textContent = "These songs are still in the old flat folder. Move them into GP Song Tools / <title> / lyrics, or open one from here.";
      sec.append(mv, head, note);
      const old = oldSongs.files.filter(match);
      if (old.length) {
        const ul = document.createElement("ul");
        for (const s of old) ul.appendChild(songButton(s, { old: true }));
        sec.appendChild(ul);
      }
      parts.push(sec);
    }
    els.list.replaceChildren(...parts);
  }

  async function loadList() {
    const mine = ++listRun; // only the newest request may fill the list (a slower, older one is dropped)
    els.list.innerHTML = `<p class="hint">Loading your songs…</p>`;
    try {
      const [found] = await Promise.all([listSongs(), checking || checkOld()]);
      if (mine === listRun) songs = found;
    } catch (err) {
      if (mine !== listRun) return;
      songs = [];
      if (isAuthError(err)) renderAccount();
      else editor.toast(err.message);
    }
    if (mine === listRun) renderList();
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
  onToken = () => {
    renderAccount(); refreshState(); editor.authChanged?.();
    if (dirty()) scheduleAutosave();
    if (!oldChecked) checkOld({ offer: true }); // first sign-in in this page: look for old songs
  };
  // Signed out here or from the Song spec panel (songdrive's signOut ends in signOut() above).
  onSignedOut = () => {
    songs = []; oldSongs = { id: null, files: [] }; oldChecked = false;
    renderAccount(); renderList(); refreshState(); editor.authChanged?.();
  };
  // Another tab signed in, renewed or disconnected.
  window.addEventListener("storage", (e) => { if (e.key === "lyricpad:drive:token") { refreshState(); editor.authChanged?.(); } });

  prepareSignIn().catch((err) => console.error(err));
  return {
    // Called by the editor on every change.
    edited() { refreshState(); scheduleAutosave(); },
    // Called once the editor has restored the last song.
    ready() { refreshState(); if (tokenValid()) checkOld({ offer: true }); },
  };
}
