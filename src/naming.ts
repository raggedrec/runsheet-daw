/**
 * Names and tempos, with no dependencies.
 *
 * Separate from loadSong so it can be tested in Node — loadSong imports
 * openDAW, which reaches for browser globals the moment it is loaded.
 */

/** A tempo openDAW can use, or null. Run Sheet's bpm is free text. */
export function tempoOf(bpm: string | null): number | null {
  if (!bpm) return null;
  const n = Number.parseFloat(bpm);
  if (!Number.isFinite(n) || n < 20 || n > 400) return null;
  return n;
}

/**
 * A readable lane name from an uploaded filename.
 *
 * Files are named things like "Touching Hands 112 DRUMS.mp3". The song name is
 * already at the top of the screen, so the useful part is the last word.
 */
export function laneName(fileName: string): string {
  const stem = fileName.replace(/\.[a-z0-9]+$/i, "").trim();
  const words = stem.split(/[\s_-]+/).filter(Boolean);
  const last = words[words.length - 1] ?? stem;
  // A trailing number is a version or a tempo, not a part name.
  // titleCase here too — without it this one branch returned "ACO" while
  // every other shape returned "Aco". Caught by a test, not by eye.
  if (/^\d+$/.test(last) && words.length > 1) return titleCase(words[words.length - 2]);
  return last.length <= 12 ? titleCase(last) : titleCase(stem);
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
