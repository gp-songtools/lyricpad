// Pure helpers for Lyricpad's Google Drive saving (no DOM, no network): naming and query building.
// The folder layout is GP Song Tools / <title> / lyrics / <title>.txt (format: toolsmenu songspec/SPEC.md, section 8).
import "./songdrive.js?v=b62c520e"; // copy of gp-songtools/toolsmenu songspec/songdrive.js; sets globalThis.SongDrive

export const UNTITLED = "Untitled song";

/** The song's file name on Drive: "<title>.txt", with characters Drive and file systems dislike turned into spaces. */
export function fileName(title) {
  const clean = (title || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  return (clean || UNTITLED) + ".txt";
}
export const titleFrom = (name) => String(name).replace(/\.txt$/i, "");
export const isTxt = (name) => /\.txt$/i.test(String(name));

/** The Drive folder name for a title (the shared library's rule: no / \ : * ? " < > |, 100 characters at most). */
export const folderNameFor = (title) => globalThis.SongDrive.folderName(title);

/** True for songs with no real title: an empty title or the placeholder "Untitled song". */
export const isUntitled = (title) => {
  const n = folderNameFor(title);
  return !n || n.toLowerCase() === UNTITLED.toLowerCase();
};

const key = (s) => String(s).trim().toLowerCase();

/** `base`, else "base (2)", "base (3)"… the first one not in `taken` (a Set of lower-case names; the result is not added). */
export function uniqueName(base, taken) {
  if (!taken.has(key(base))) return base;
  for (let n = 2; ; n++) {
    const c = `${base} (${n})`;
    if (!taken.has(key(c))) return c;
  }
}

/**
 * A file name for `title` that isn't among `names` (the names already in the lyrics folder):
 * "Song.txt", else "Song (2).txt", "Song (3).txt"…
 */
export function freeFileName(title, names) {
  const taken = new Set([...names].map((n) => key(titleFrom(n))));
  const base = titleFrom(fileName(title));
  return uniqueName(base, taken) + ".txt";
}

/**
 * Where each old song goes. `files` = [{id, name}], `existingFolders` = names already under GP Song Tools.
 * Songs with the same real title share one folder (an existing one is reused); songs with no title each get their own:
 * "Untitled song", "Untitled song (2)"… never one that exists already. Returns [{file, title, folder, untitled}].
 */
export function moveTargets(files, existingFolders = []) {
  const taken = new Set([...existingFolders].map(key));
  return files.map((file) => {
    const title = titleFrom(file.name);
    if (isUntitled(title)) {
      const folder = uniqueName(UNTITLED, taken);
      taken.add(key(folder));
      return { file, title, folder, untitled: true };
    }
    return { file, title, folder: folderNameFor(title), untitled: false };
  });
}

/** Groups of at most `size` ids, for Drive queries with many "in parents" terms. */
export function batches(ids, size = 20) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** "'a' in parents or 'b' in parents", wrapped in brackets. */
export const parentsQuery = (ids) => "(" + ids.map((id) => `'${esc(id)}' in parents`).join(" or ") + ")";

export const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Query: the lyrics subfolders of these song folders. */
export const lyricsFoldersQuery = (songFolderIds) =>
  `${parentsQuery(songFolderIds)} and name = 'lyrics' and mimeType = '${FOLDER_MIME}' and trashed = false`;

/** Query: the files (not folders) in these lyrics folders. */
export const songFilesQuery = (lyricsFolderIds) =>
  `${parentsQuery(lyricsFolderIds)} and mimeType != '${FOLDER_MIME}' and trashed = false`;

/** Do two titles name the same song (ignoring case and extra spaces)? Empty never matches. */
export const sameTitle = (a, b) => !!key(a || "") && key(a).replace(/\s+/g, " ") === key(b || "").replace(/\s+/g, " ");
