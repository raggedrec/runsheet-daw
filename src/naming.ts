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

/**
 * A musical key, written the way musicians write it.
 *
 * Case carries meaning here in a way it does not in ordinary text: "C" is C
 * major and "Cm" is C minor; "Bb" is B flat and "BB" is nothing at all. So a
 * key must never be run through textTransform: uppercase — which is exactly
 * what was turning Cm into CM on the start screen.
 *
 * Run Sheet's key field is free text, so this also tidies what people type:
 * lower-case note letters get capitalised, a flat is a lower-case b whatever
 * was typed, and the several ways of writing minor collapse to one.
 */
export function formatKey(raw: string | null): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (text.length === 0) return null;

  // Letter, optional accidental, then whatever quality was written.
  // 'B' is allowed as an accidental so "BB" reads as B flat — people type it.
  const match = /^([A-Ga-g])\s*([#♯bB♭]?)\s*(.*)$/.exec(text);
  if (match === null) return text; // Not a key we recognise; show it as typed.

  const [, letter, accidental, rest] = match;
  const note = letter.toUpperCase();
  const sign = accidental === "#" || accidental === "♯" ? "#" : accidental ? "b" : "";

  const quality = rest.toLowerCase().trim();
  if (quality === "" || quality === "major" || quality === "maj") return `${note}${sign}`;
  if (quality === "m" || quality === "min" || quality === "minor") return `${note}${sign}m`;

  /*
   * Only reformat what actually looks like a chord quality.
   *
   * Every letter A–G also starts ordinary words, so without this "dunno"
   * parses as D + "unno" and comes back "Dunno" — the function confidently
   * rewriting text it had no business touching. Anything unrecognised is
   * returned exactly as typed.
   */
  if (/^(m|min|maj)?(6|7|9|11|13)?(sus[24]?|dim|aug|add\d+|\+|°)?\d*$/.test(quality)) {
    return `${note}${sign}${quality}`;
  }
  return text;
}
