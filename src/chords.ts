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
