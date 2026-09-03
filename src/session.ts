/**
 * Saving and reopening a session.
 *
 * The thing that makes a mix worth making. Without this, every fader move is
 * discarded on close and the only record of a mix is whatever was bounced —
 * which makes a bounce a one-way door, because "nudge the vocal up 1dB" means
 * starting the mix again from stems.
 *
 * There is no settings format to design. Volume, pan, mute, solo, effects,
 * track order and region positions are all boxes in openDAW's graph, so
 * `Project.toArrayBuffer()` captures them by construction. Anything openDAW
 * can represent gets saved; anything it can't wasn't ours to lose.
 *
 * Sessions live in their own storage bucket path, keyed by track, not in Idea
 * Drop. Idea Drop is for audio a musician chose to keep — putting an opaque
 * binary in the same list would make it look like a broken file.
 */
import { supabase } from "./supabase";
import { LoadError, type Song } from "./runsheet";

const BUCKET = "idea-drop";

/**
 * One session per song, overwritten in place.
 *
 * Not versioned, deliberately: version history is a real feature with real UI
 * (which one is current? how do you compare them? when are old ones deleted?)
 * and shipping half of it — a folder quietly filling with timestamped blobs
 * nobody can open — is worse than not having it.
 */
function sessionPath(song: Song): string {
  return `${song.sceneId}/${song.id}/session.odproject`;
}

export interface SavedSession {
  savedAt: Date;
  bytes: number;
}

export async function saveSession(song: Song, data: ArrayBufferLike): Promise<SavedSession> {
  const blob = new Blob([data as ArrayBuffer], { type: "application/octet-stream" });
  const path = sessionPath(song);

  /*
   * Insert, then replace — never upsert.
   *
   * The bucket's policy grants INSERT and DELETE but not UPDATE, and `upsert:
   * true` is an UPDATE the moment the file already exists. That's why the first
   * save worked and the second failed with "new row violates row-level security
   * policy": the second save was an overwrite. So the first attempt is a plain
   * insert; only when the object is already there (a re-save) do we delete it and
   * insert fresh — DELETE + INSERT, both of which the policy allows. The delete
   * happens only after we know we're replacing, so a save is never thrown away
   * before its replacement is written.
   */
  const first = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { upsert: false, contentType: "application/octet-stream" });
  if (!first.error) return { savedAt: new Date(), bytes: blob.size };

  // Anything other than "it already exists" is a real failure — report it as-is.
  const exists = /exist|dupli|409/i.test(first.error.message);
  if (!exists) {
    throw new LoadError(
      `The session didn't save: ${first.error.message}`,
      "Your take is still in Idea Drop if you saved it. The mix isn't stored yet — try again.",
    );
  }

  const removed = await supabase.storage.from(BUCKET).remove([path]);
  if (removed.error) {
    throw new LoadError(
      `The session didn't save: ${removed.error.message}`,
      "The previous save is still in place; this change to it wasn't stored. Try again.",
    );
  }
  const second = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { upsert: false, contentType: "application/octet-stream" });
  if (second.error) {
    throw new LoadError(
      `The session didn't save: ${second.error.message}`,
      "The old save was cleared but the new one didn't land — try again.",
    );
  }
  return { savedAt: new Date(), bytes: blob.size };
}

/**
 * Reads a saved session back, or null when there isn't one.
 *
 * Null rather than throwing: opening a song for the first time is the normal
 * case, not an error, and every song was opened for the first time once.
 */
export async function loadSession(song: Song): Promise<ArrayBuffer | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(sessionPath(song));
  if (error || !data) return null;
  return await data.arrayBuffer();
}

/**
 * Whether a session exists, without downloading it.
 *
 * Used on the start screen so it can offer "Continue where you left off"
 * rather than silently choosing for the musician.
 */
export async function sessionExists(song: Song): Promise<boolean> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(`${song.sceneId}/${song.id}`, { search: "session.odproject" });
  if (error || !data) return false;
  return data.some((f) => f.name === "session.odproject");
}
