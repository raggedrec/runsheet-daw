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

/** Pitch-class → name. Sharps by default; flats for flat keys. */
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/**
 * Chord templates: root-relative intervals and the suffix they print, most
 * specific first so a seventh wins over the triad it contains. The intervals
 * mirror qualityIntervals(), so every name here parses back through chordToMidi.
 */
const CHORD_TEMPLATES: ReadonlyArray<{ ivals: number[]; suffix: string }> = [
  { ivals: [0, 4, 7, 11], suffix: "maj7" },
  { ivals: [0, 3, 7, 10], suffix: "m7" },
  { ivals: [0, 4, 7, 10], suffix: "7" },
  { ivals: [0, 3, 6, 9], suffix: "dim7" },
  { ivals: [0, 3, 6, 10], suffix: "m7b5" },
  { ivals: [0, 4, 7, 9], suffix: "6" },
  { ivals: [0, 3, 7, 9], suffix: "m6" },
  { ivals: [0, 4, 7], suffix: "" },
  { ivals: [0, 3, 7], suffix: "m" },
  { ivals: [0, 3, 6], suffix: "dim" },
  { ivals: [0, 4, 8], suffix: "aug" },
  { ivals: [0, 2, 7], suffix: "sus2" },
  { ivals: [0, 5, 7], suffix: "sus4" },
];

/**
 * Name the chord formed by a set of pitch classes — the reverse of chordToMidi,
 * for reading chords out of a MIDI file where the notes are exact. Tries every
 * present pitch class as the root against the templates above, preferring the
 * fullest match in root position; falls back to naming the bass as a plain major
 * when nothing fits, and "N.C." when nothing sounds. `bassPc` is the lowest
 * note's pitch class (for root-position preference); `flat` spells with flats.
 */
export function nameChord(
  pitchClasses: Iterable<number>,
  bassPc: number | null = null,
  flat = false,
): { label: string; confidence: number } {
  const pcs = new Set<number>();
  for (const pc of pitchClasses) pcs.add(((pc % 12) + 12) % 12);
  if (pcs.size === 0) return { label: "N.C.", confidence: 1 };

  const names = flat ? FLAT_NAMES : SHARP_NAMES;
  let best: { root: number; suffix: string; score: number; exact: boolean } | null = null;

  for (const root of pcs) {
    const rel = new Set<number>();
    for (const pc of pcs) rel.add((pc - root + 12) % 12);
    for (const tpl of CHORD_TEMPLATES) {
      if (!tpl.ivals.every((iv) => rel.has(iv))) continue;
      const extras = rel.size - tpl.ivals.length;
      // Reward chord-tone count, penalise notes the template can't explain, and
      // nudge toward the root actually being in the bass (root position).
      const score = tpl.ivals.length - 0.5 * extras + (root === bassPc ? 0.25 : 0);
      if (!best || score > best.score) best = { root, suffix: tpl.suffix, score, exact: extras === 0 };
    }
  }

  if (best) return { label: names[best.root] + best.suffix, confidence: best.exact ? 0.95 : 0.7 };
  // A fragment or a dyad: name the bass as a plain chord, low confidence, so the
  // block still reads rather than vanishing.
  const root = ((bassPc ?? [...pcs][0]) % 12 + 12) % 12;
  return { label: names[root], confidence: 0.4 };
}

/**
 * Copy a run of chords so the first lands at `targetAt`, spacing preserved.
 *
 * The whole point of copy/paste here: a verse's chords pasted at the chorus keep
 * their internal timing, just slid to start at the playhead. `picked` is in
 * absolute song time; the result is too, rebased to `targetAt`.
 */
export function rebaseChords(picked: ReadonlyArray<DetectedChord>, targetAt: number): DetectedChord[] {
  if (picked.length === 0) return [];
  const t0 = picked[0].at;
  return picked.map((c) => ({ at: Math.max(0, targetAt + (c.at - t0)), label: c.label, confidence: c.confidence }));
}
