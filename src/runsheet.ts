/**
 * Reading a song out of Run Sheet, and putting audio back.
 *
 * Everything here goes through the anon key, so row level security decides
 * what's visible. An artist who isn't a member of the project gets an empty
 * result rather than an error — which is the correct behaviour and also means
 * the UUIDs in the URL are useless to anyone who shouldn't have them.
 *
 * Column names were read from the live schema, not assumed.
 */
import { supabase } from "./supabase";

export interface SongFile {
  id: string;
  name: string;
  storagePath: string;
  /** "mix" | "stem" | "midi" | "other" — Run Sheet's own classification. */
  role: string;
  kind: string;
  addedAt: number;
}

export interface Song {
  id: string;
  sceneId: string;
  name: string;
  sceneName: string;
  /** Free text in Run Sheet, so it may be absent or nonsense. */
  bpm: string | null;
  key: string | null;
  /**
   * The song's lyrics and chords, as written in Run Sheet's `lyrics_chords`
   * field — one free-text block, chords and words together the way a musician
   * lays them out. Empty string when nothing has been written. Shown read-only:
   * Run Sheet owns this text, and two apps editing one field would fight.
   */
  lyricsChords: string;
  files: SongFile[];
}

export class LoadError extends Error {
  constructor(message: string, readonly remedy: string) {
    super(message);
    this.name = "LoadError";
  }
}

/** The song named in the URL, with its Idea Drop contents. */
export async function loadSong(sceneId: string, trackId: string): Promise<Song> {
  const { data: track, error: trackErr } = await supabase
    .from("tracks")
    .select("id, scene_id, name, bpm, key, lyrics_chords, scenes(name)")
    .eq("id", trackId)
    .eq("scene_id", sceneId)
    .maybeSingle();

  if (trackErr) throw new LoadError(trackErr.message, "Check the browser console for details.");
  if (!track) {
    /*
     * Empty rather than an error is what RLS returns for a song you can't see,
     * so "not found" and "not yours" are the same result here. Saying both is
     * more honest than picking one.
     */
    throw new LoadError(
      "That song isn't available.",
      "It may have been deleted, or you may not be a member of that project. " +
        "Open it in Run Sheet first.",
    );
  }

  const { data: files, error: filesErr } = await supabase
    .from("idea_drop_files")
    .select("id, name, storage_path, role, kind, added_at")
    .eq("track_id", trackId)
    .order("added_at", { ascending: true });

  if (filesErr) throw new LoadError(filesErr.message, "Check the browser console for details.");

  const scene = track.scenes as unknown as { name: string } | null;

  return {
    id: track.id,
    sceneId: track.scene_id,
    name: track.name,
    sceneName: scene?.name ?? "",
    bpm: track.bpm,
    key: track.key,
    lyricsChords: (track.lyrics_chords as string | null) ?? "",
    files: (files ?? [])
      // External links have no storage path and can't be decoded.
      .filter((f) => Boolean(f.storage_path))
      .map((f) => ({
        id: f.id,
        name: f.name,
        storagePath: f.storage_path as string,
        role: f.role ?? "other",
        kind: f.kind ?? "",
        addedAt: new Date(f.added_at).getTime(),
      })),
  };
}

/**
 * What to load into the DAW for a song.
 *
 * Stems win when there are any — they're the reason to open a multitrack view,
 * and loading the mix alongside them would double every part. With no stems,
 * the newest mix is worth having: one lane to play along to.
 *
 * This rule was learned the hard way in the previous attempt: a song with
 * stems AND a mix played everything twice, which sounds like a phasing problem
 * rather than a bug, so it gets blamed on the audio.
 */
export function playableFiles(song: Song): SongFile[] {
  const stems = song.files.filter((f) => f.role === "stem");
  if (stems.length > 0) return stems;
  const mixes = song.files.filter((f) => f.role === "mix");
  if (mixes.length === 0) return [];
  return [[...mixes].sort((a, b) => b.addedAt - a.addedAt)[0]];
}

/** A one-hour URL for a stored file. */
export async function signedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("idea-drop")
    .createSignedUrl(storagePath, 3600);
  if (error) throw new LoadError(error.message, "The file may have been moved or deleted.");
  return data.signedUrl;
}

/**
 * A one-hour URL that downloads rather than opens.
 *
 * The `download` option makes the response carry Content-Disposition:
 * attachment, so following the link saves the file instead of navigating the
 * tab to it — which matters because the DAW would be gone if the tab navigated.
 * The filename is passed so the saved file keeps its real name, not the storage
 * path's uuid prefix.
 */
export async function downloadUrl(storagePath: string, filename: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("idea-drop")
    .createSignedUrl(storagePath, 3600, { download: filename });
  if (error) throw new LoadError(error.message, "The file may have been moved or deleted.");
  return data.signedUrl;
}

/**
 * Permanently removes a file from Idea Drop — storage object AND the Run Sheet
 * row that references it.
 *
 * Irreversible: there is no trash. The caller confirms with the user first. The
 * storage object goes before the row, so a failure can't leave Run Sheet
 * pointing at bytes that are gone; if the row delete fails, the object is
 * already removed and the row will 404 on next load, which is the lesser mess.
 */
export async function deleteIdeaDropFile(file: SongFile): Promise<void> {
  const { error: rmErr } = await supabase.storage.from("idea-drop").remove([file.storagePath]);
  if (rmErr) throw new LoadError(rmErr.message, "The file wasn't deleted. Try again.");

  const { error } = await supabase.from("idea_drop_files").delete().eq("id", file.id);
  if (error) {
    throw new LoadError(
      `The file was removed from storage but Run Sheet kept its row: ${error.message}`,
      "Tell Shayne — the row needs clearing by hand.",
    );
  }
}

/**
 * Puts a file into the song's Idea Drop, where Run Sheet will show it.
 *
 * The storage path mirrors what Run Sheet builds — scene, then track, then a
 * unique prefix — so both apps agree on where a song's files live. The `role`
 * is passed explicitly rather than guessed from the filename, because the
 * caller knows whether it made a take or a mix.
 */
export async function uploadToIdeaDrop(
  song: Song,
  file: File,
  role: "stem" | "mix",
): Promise<SongFile> {
  const id = crypto.randomUUID();
  const storagePath = `${song.sceneId}/${song.id}/${id}-${file.name}`;
  const kind = file.name.split(".").pop()?.toLowerCase() ?? "mp3";

  const { error: upErr } = await supabase.storage.from("idea-drop").upload(storagePath, file);
  if (upErr) throw new LoadError(upErr.message, "The upload didn't complete. Try again.");

  const { error } = await supabase.from("idea_drop_files").insert({
    id,
    scene_id: song.sceneId,
    track_id: song.id,
    name: file.name,
    storage_path: storagePath,
    kind,
    role,
  });

  if (error) {
    /*
     * The object is uploaded but unreferenced at this point. Left deliberately
     * rather than deleted: a failed insert is usually a permissions problem,
     * and deleting the audio someone just recorded to tidy up a database row
     * is the wrong trade.
     */
    throw new LoadError(
      `Uploaded, but Run Sheet didn't record it: ${error.message}`,
      "The audio is safe in storage. Tell Shayne — it needs linking by hand.",
    );
  }

  // The row as it now exists, so the caller can show it in Idea Drop without a
  // re-fetch — and download or delete it like any other file.
  return { id, name: file.name, storagePath, role, kind, addedAt: Date.now() };
}
