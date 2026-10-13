/**
 * Detected chords — the magic wand's output, shared with Run Sheet.
 *
 * This is the SAME jsonb Run Sheet writes to `idea_drop_files.analysis`: a timed
 * chord list, each chord sounding from its `at` until the next one's. The DAW
 * reads it to draw a chord lane and writes it back on an edit, so a rename here
 * shows up in Run Sheet's Detected Chords strip — one column, one source of
 * truth, no sync to keep.
 *
 * The analysis blob carries more than chords (bpm, key, tuning…). The DAW only
 * types what it touches; on write it spreads the original object, so the fields
 * it doesn't know about round-trip untouched rather than being dropped.
 */

export interface DetectedChord {
  /** Seconds from the start of the file. */
  at: number;
  label: string;
  /** 0–1, the detector's margin over the runner-up. */
  confidence: number;
}

/** The cached analysis blob, as Run Sheet shapes it. Loose by design. */
export interface StoredAnalysis {
  chords: DetectedChord[];
  bpm?: number | null;
  key?: unknown;
  tuningCents?: number;
  chordConfidence?: number;
}

/** Pitch class of each note name, sharps and flats alike. */
const NOTE_PC: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6,
  G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

/**
 * Semitone intervals above the root for a chord quality (the suffix after the
 * note name). Block triads and common sevenths/sixths; anything unrecognised
 * falls back to a major triad. Case matters only for maj7 vs m7 — a capital M
 * or "maj" means major, a lowercase m means minor.
 */
function qualityIntervals(qRaw: string): number[] {
  const q = qRaw.replace(/[()\s]/g, "");
  if (/^(m7b5|ø|Ø)/.test(q)) return [0, 3, 6, 10];
  if (/^(dim7|o7|°7)/i.test(q)) return [0, 3, 6, 9];
  if (/^(dim|°)/i.test(q)) return [0, 3, 6];
  if (/^(aug|\+)/i.test(q)) return [0, 4, 8];
  if (/^sus2/i.test(q)) return [0, 2, 7];
  if (/^sus/i.test(q)) return [0, 5, 7];

  // Lowercase m (not "maj") or min or - is minor; capital M is major.
  const minor = /^(m(?!aj)|min|-)/.test(q);
  if (/maj7|ma7|M7|Δ|△/.test(q)) return minor ? [0, 3, 7, 11] : [0, 4, 7, 11];
  if (/7/.test(q)) return minor ? [0, 3, 7, 10] : [0, 4, 7, 10];
  if (/6/.test(q)) return minor ? [0, 3, 7, 9] : [0, 4, 7, 9];
  return minor ? [0, 3, 7] : [0, 4, 7];
}

/**
 * A chord label ("D", "F#m", "Bbmaj7", "D/F#") to MIDI note numbers — block
 * voicing, root position, rooted around C3. A slash bass is ignored (the chord
 * is what a reference pad wants); an unparseable label (e.g. "N.C.") gives no
 * notes. Pure, so it is unit-tested rather than discovered on a deployed synth.
 */
export function chordToMidi(label: string, rootBase = 48): number[] {
  const m = /^([A-Ga-g])([#b]?)(.*)$/.exec(label.trim());
  if (!m) return [];
  const pc = NOTE_PC[m[1].toUpperCase() + (m[2] ?? "")];
  if (pc === undefined) return [];
  return qualityIntervals(m[3].split("/")[0]).map((iv) => rootBase + pc + iv);
}

/**
 * Parse Run Sheet's free-text key (e.g. "Db", "Bbm", "F# minor") into the
 * analyser's key hint. Passing it biases detection toward that key's chords —
 * without it the read drifts, which is most of why an unguided wand disagrees
 * with the written chart. Undefined when the field is empty or unparseable.
 */
export function parseKeyHint(key: string | null | undefined): { tonic: number; minor: boolean } | undefined {
  if (!key) return undefined;
  const m = /^([A-G](?:#|b)?)\s*(m|min|minor)?/i.exec(key.trim());
  if (!m) return undefined;
  const root = m[1][0].toUpperCase() + (m[1][1] ?? "").toLowerCase();
  const tonic = NOTE_PC[root];
  if (tonic === undefined) return undefined;
  return { tonic, minor: Boolean(m[2]) };
}

/**
 * Index of the chord sounding at `seconds`, or -1 before the first. Binary
 * search over the sorted `at` times — ported verbatim from Run Sheet's
 * `chordIndexAt` so the two apps pick the same "current" chord to the frame.
 */
export function chordIndexAt(chords: ReadonlyArray<DetectedChord>, seconds: number): number {
  if (chords.length === 0 || seconds < chords[0].at) return -1;
  let lo = 0;
  let hi = chords.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (chords[mid].at <= seconds) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
