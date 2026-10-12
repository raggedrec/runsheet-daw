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
