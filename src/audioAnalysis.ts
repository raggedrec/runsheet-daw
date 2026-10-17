/**
 * Tempo, key, tuning and chord estimation from decoded audio.
 *
 * Runs entirely in the browser on an already-decoded buffer — nothing is
 * uploaded. Written as pure functions over Float32Array so the maths can be
 * tested in Node against synthesised signals whose answers are known.
 *
 * These are the classic pre-deep-learning methods: spectral flux for onsets,
 * autocorrelation for tempo, chroma plus Krumhansl-Schmuckler for key, and
 * template matching for chords. That's a deliberate choice — the alternative
 * is shipping a trained model to the browser, which is exactly the shape of
 * the stem-separation work that stalled on a 300MB download.
 *
 * Measured against synthesised mixes with drums, bass, a vocal line, reverb and
 * a count-in (npm run bench:chords):
 *
 *   with the track's own chord sheet as a hint   18/18 exact
 *   with no hints at all                         14/18 exact, 18/18 root+quality
 *   low-register roots a semitone apart          12/12, no spurious labels
 *
 * Two defects account for nearly all of the earlier inaccuracy, and both were
 * in the measurement rather than the matching:
 *
 *  1. One spectrogram served both tempo and harmony. They want opposite things
 *     — see the window sizes below.
 *  2. The chromagram summed every bin. A spectrum is mostly noise floor, and
 *     its combined weight swamped the few bins that were notes, leaving every
 *     pitch class within a few percent of every other. Taking only spectral
 *     peaks fixed it: the same Am that read A:1.00 B:0.99 C:0.88 A#:0.86 now
 *     reads A:1.00 E:0.77 C:0.58 B:0.46.
 *
 * Everything returns a confidence so the UI can offer a suggestion rather than
 * assert a fact, and chordConfidence lets a weak reading announce itself.
 */

/** Analysis sample rate. Nyquist ~5.5kHz still covers every chroma partial we use. */
const ANALYSIS_RATE = 11025;

/*
 * Two different windows, because tempo and harmony want opposite things.
 *
 * Using one spectrogram for both was the original structural mistake. Onsets
 * need time resolution — a short window, so a drum hit is a spike rather than a
 * smear. Harmony needs frequency resolution — a long window, or low notes can't
 * be told apart at all.
 *
 * How badly: at 11025Hz with a 2048 window each bin is 5.4Hz wide, while a
 * semitone at E2 is 4.9Hz. Under one bin. Across the two octaves where chord
 * roots actually live, the old front end could not distinguish a note from its
 * neighbour — and since bass is the loudest thing in a mix, that blur decided
 * the chord. Quadrupling the window gives 1.35Hz bins: ~3.6 bins per semitone
 * down there, which is enough to tell E from F.
 */
const ONSET_FRAME = 2048;
const ONSET_HOP = 512;

const HARMONY_FRAME = 8192;
const HARMONY_HOP = 2048;

export const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_CLASSES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/**
 * Which accidentals to spell chords with, from the key. A flat key wants flats
 * (Db, not C#; Bbm, not A#m) or a chart written in flats won't match. Decided by
 * the relative major so a minor key spells like its signature: the unambiguous
 * flat majors are Db, Eb, F, Ab, Bb — everything else (and no key) takes sharps,
 * the previous behaviour.
 */
const FLAT_MAJORS = new Set([1, 3, 5, 8, 10]);
export function classesForKey(key?: { tonic: number; minor: boolean } | null): ReadonlyArray<string> {
  if (!key) return PITCH_CLASSES;
  const major = key.minor ? (key.tonic + 3) % 12 : key.tonic;
  return FLAT_MAJORS.has(major) ? FLAT_CLASSES : PITCH_CLASSES;
}

// ---------------------------------------------------------------- preparation

/** Average the channels. Stereo width shouldn't change what note is playing. */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (let i = 0; i < out.length; i += 1) {
    let sum = 0;
    for (const ch of channels) sum += ch[i];
    out[i] = sum / channels.length;
  }
  return out;
}

/**
 * Drop to the analysis rate by averaging blocks.
 *
 * Averaging is a crude low-pass, but it's the right crude: it attenuates the
 * content above the new Nyquist that would otherwise alias down into the
 * chroma bins and invent notes that were never played.
 */
export function downsample(samples: Float32Array, from: number, to = ANALYSIS_RATE): Float32Array {
  if (from <= to) return samples;
  const ratio = from / to;
  const outLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += samples[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

// ------------------------------------------------------------------- spectrum

/** In-place iterative radix-2 FFT. Small enough to own rather than depend on. */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let j = 0; j < len / 2; j += 1) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm;
        const vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

const hannCache = new Map<number, Float32Array>();
function hann(size: number): Float32Array {
  const cached = hannCache.get(size);
  if (cached) return cached;
  const w = new Float32Array(size);
  for (let i = 0; i < size; i += 1) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  hannCache.set(size, w);
  return w;
}

/** Magnitude spectra, one per hop. The basis for everything below. */
export function spectrogram(
  samples: Float32Array,
  frame = ONSET_FRAME,
  hop = ONSET_HOP,
): Float32Array[] {
  const frames: Float32Array[] = [];
  const window = hann(frame);
  const re = new Float32Array(frame);
  const im = new Float32Array(frame);
  for (let start = 0; start + frame <= samples.length; start += hop) {
    for (let i = 0; i < frame; i += 1) {
      re[i] = samples[start + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float32Array(frame / 2);
    for (let i = 0; i < frame / 2; i += 1) mag[i] = Math.hypot(re[i], im[i]);
    frames.push(mag);
  }
  return frames;
}

// ---------------------------------------------------------------------- tempo

/**
 * Spectral flux: how much energy *appeared* since the last frame.
 *
 * Only rises count — a note starting is an onset, a note stopping is not.
 */
export function onsetEnvelope(frames: Float32Array[]): Float32Array {
  const env = new Float32Array(frames.length);
  for (let f = 1; f < frames.length; f += 1) {
    let flux = 0;
    for (let b = 0; b < frames[f].length; b += 1) {
      const diff = frames[f][b] - frames[f - 1][b];
      if (diff > 0) flux += diff;
    }
    env[f] = flux;
  }
  // Subtract a local average so a loud chorus doesn't outweigh a quiet verse.
  const smoothed = new Float32Array(env.length);
  const w = 16;
  for (let i = 0; i < env.length; i += 1) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - w); j < Math.min(env.length, i + w); j += 1) {
      sum += env[j];
      count += 1;
    }
    smoothed[i] = Math.max(0, env[i] - sum / count);
  }
  return smoothed;
}

export interface TempoResult {
  bpm: number | null;
  confidence: number;
  /** The other candidate when half or double time is nearly as likely. */
  alternate: number | null;
}

/**
 * Autocorrelate the onset envelope and read the strongest musical lag.
 *
 * Tempo detection's classic failure is the octave error — reporting 75 for a
 * 150 track. Rather than hide it, weight toward the range people actually
 * count in and hand back the runner-up so the UI can offer both.
 */
export function detectTempo(env: Float32Array, envRate: number): TempoResult {
  if (env.length < 32) return { bpm: null, confidence: 0, alternate: null };

  const minLag = Math.floor((60 / 300) * envRate);
  const maxLag = Math.min(Math.ceil((60 / 30) * envRate), Math.floor(env.length / 2));
  if (maxLag <= minLag) return { bpm: null, confidence: 0, alternate: null };

  let mean = 0;
  for (let i = 0; i < env.length; i += 1) mean += env[i];
  mean /= env.length;

  const scores: { lag: number; score: number }[] = [];
  const byLag = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = 0; i + lag < env.length; i += 1) sum += (env[i] - mean) * (env[i + lag] - mean);
    const bpm = (60 * envRate) / lag;
    // A broad preference for 60-180, centred near 120. Keeps the octave error
    // from winning on a track whose onsets are equally strong at half time.
    const weight = Math.exp(-0.5 * ((Math.log2(bpm / 120) / 0.75) ** 2));
    const score = (sum / (env.length - lag)) * weight;
    byLag[lag] = score;
    scores.push({ lag, score });
  }

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  if (!best || best.score <= 0) return { bpm: null, confidence: 0, alternate: null };

  /*
   * Lags are whole frames, and at ~21 frames a second that grid is coarse where
   * it matters most: around 140bpm the neighbouring lags are 129 and 144, with
   * nothing in between. Fitting a parabola through the peak and its two
   * neighbours recovers the fractional lag and with it a believable bpm.
   */
  const refine = (lag: number): number => {
    if (lag <= minLag || lag >= maxLag) return lag;
    const left = byLag[lag - 1];
    const mid = byLag[lag];
    const right = byLag[lag + 1];
    const denom = left - 2 * mid + right;
    if (denom === 0) return lag;
    const delta = (0.5 * (left - right)) / denom;
    return Math.abs(delta) <= 1 ? lag + delta : lag;
  };

  const bpm = (60 * envRate) / refine(best.lag);

  // Look for a genuinely different runner-up, not a neighbouring lag. This is
  // usually the half or double time reading, and on fast material it's often
  // the correct one — so it gets refined too rather than handed back raw.
  const alt = scores.find((s) => {
    const candidate = (60 * envRate) / s.lag;
    return Math.abs(Math.log2(candidate / bpm)) > 0.3;
  });

  const confidence = alt ? Math.max(0, Math.min(1, 1 - alt.score / best.score)) : 0.8;
  return {
    bpm: Math.round(bpm * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    alternate: alt ? Math.round(((60 * envRate) / refine(alt.lag)) * 10) / 10 : null,
  };
}

// ------------------------------------------------------------ chroma and key

export interface ChromaResult {
  /** Energy per pitch class, normalised to a maximum of 1. */
  chroma: number[];
  /**
   * Energy per pitch class from the bass register only (~40–260 Hz), normalised.
   * The bass note is what tells a chord's root and quality apart — Fm from Bbm,
   * a major from its relative minor — so chord matching weights it.
   */
  bass: number[];
  /** Cents away from A440, positive meaning sharp. */
  tuningCents: number;
}

/**
 * Fold the spectrum onto twelve pitch classes, and measure the tuning offset
 * while we're here: if every partial sits consistently above or below its
 * nominal bin, the track isn't at A440.
 */
export function chromagram(
  frames: Float32Array[],
  sampleRate: number,
  refA = 440,
  frameSize = HARMONY_FRAME,
): ChromaResult {
  const chroma = Array.from({ length: 12 }, () => 0);
  const bass = Array.from({ length: 12 }, () => 0);
  const binHz = sampleRate / frameSize;
  const lowBin = Math.max(2, Math.floor(65 / binHz)); // C2
  const highBin = Math.min(frames[0]?.length ?? 0, Math.floor(2100 / binHz)); // ~C7
  // The bass register — low E on a bass/piano up to the low-mids. Its own peak
  // picking, so a loud midrange pad can't drown out the root in the low end.
  const bassLowBin = Math.max(2, Math.floor(40 / binHz));
  const bassHighBin = Math.min(frames[0]?.length ?? 0, Math.floor(260 / binHz));

  let deviationSum = 0;
  let deviationWeight = 0;

  for (const mag of frames) {
    /*
     * Only spectral peaks count.
     *
     * Summing every bin was the mistake that made the chroma useless: a
     * spectrum has thousands of bins, almost all of them noise floor, and
     * their combined weight swamped the handful that are actual notes. The
     * result was a chroma where every pitch class sat within a few percent of
     * every other — no contrast, so the chord was decided by rounding error.
     *
     * A played note is a local maximum. Noise is not. Taking only the peaks
     * throws away the floor entirely.
     */
    let frameMax = 0;
    for (let b = lowBin; b < highBin; b += 1) if (mag[b] > frameMax) frameMax = mag[b];
    if (frameMax <= 0) continue;
    const floor = frameMax * 0.02;

    for (let b = lowBin + 1; b < highBin - 1; b += 1) {
      const v = mag[b];
      if (v < floor) continue;
      if (v <= mag[b - 1] || v < mag[b + 1]) continue; // not a peak

      /*
       * Parabolic interpolation across the peak: the true partial rarely sits
       * exactly on a bin centre, and the offset is what tells us the tuning.
       */
      const alpha = mag[b - 1];
      const beta = v;
      const gamma = mag[b + 1];
      const denom = alpha - 2 * beta + gamma;
      const shift = denom !== 0 ? (0.5 * (alpha - gamma)) / denom : 0;
      const hz = (b + (Math.abs(shift) <= 1 ? shift : 0)) * binHz;
      if (hz <= 0) continue;

      // Amplitude, mildly compressed. Enough to stop one loud partial owning
      // the frame, not so much that quiet notes vanish into the floor.
      const weight = Math.sqrt(v / frameMax);

      const pitch = 69 + 12 * Math.log2(hz / refA);
      const nearest = Math.round(pitch);
      const offset = pitch - nearest;
      if (Math.abs(offset) < 0.5) {
        deviationSum += offset * v * v;
        deviationWeight += v * v;
      }
      chroma[((nearest % 12) + 12) % 12] += weight;
    }

    // Bass register, its own peak picking, folded to pitch classes.
    let bassFrameMax = 0;
    for (let b = bassLowBin; b < bassHighBin; b += 1) if (mag[b] > bassFrameMax) bassFrameMax = mag[b];
    if (bassFrameMax > 0) {
      const bassFloor = bassFrameMax * 0.05;
      for (let b = bassLowBin + 1; b < bassHighBin - 1; b += 1) {
        const v = mag[b];
        if (v < bassFloor) continue;
        if (v <= mag[b - 1] || v < mag[b + 1]) continue; // not a peak
        const hz = b * binHz;
        if (hz <= 0) continue;
        const nearest = Math.round(69 + 12 * Math.log2(hz / refA));
        bass[((nearest % 12) + 12) % 12] += Math.sqrt(v / bassFrameMax);
      }
    }
  }

  const max = Math.max(...chroma);
  const bassPeak = Math.max(...bass);
  return {
    chroma: max > 0 ? chroma.map((c) => c / max) : chroma,
    bass: bassPeak > 0 ? bass.map((c) => c / bassPeak) : bass,
    tuningCents: deviationWeight > 0 ? Math.round((deviationSum / deviationWeight) * 100) : 0,
  };
}

// Krumhansl-Schmuckler profiles: how strongly each scale degree is felt.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(a: number[], b: number[]): number {
  const n = a.length;
  const meanA = a.reduce((x, y) => x + y, 0) / n;
  const meanB = b.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] - meanA;
    const y = b[i] - meanB;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

export interface KeyResult {
  tonic: number;
  mode: "major" | "minor";
  name: string;
  confidence: number;
}

/** Rotate both profiles through all twelve tonics and take the best fit. */
export function detectKeyFromChroma(chroma: number[]): KeyResult | null {
  if (chroma.every((c) => c === 0)) return null;

  const candidates: KeyResult[] = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    const rotated = chroma.map((_, i) => chroma[(i + tonic) % 12]);
    candidates.push({
      tonic,
      mode: "major",
      name: `${PITCH_CLASSES[tonic]} major`,
      confidence: correlate(rotated, MAJOR_PROFILE),
    });
    candidates.push({
      tonic,
      mode: "minor",
      name: `${PITCH_CLASSES[tonic]}m`,
      confidence: correlate(rotated, MINOR_PROFILE),
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];
  const second = candidates[1];
  if (best.confidence <= 0) return null;

  // Report the margin over the runner-up rather than the raw correlation: a
  // track can correlate well with several related keys, and that's the useful
  // thing to know before trusting it.
  const margin = Math.max(0, Math.min(1, (best.confidence - second.confidence) * 3));
  return { ...best, confidence: Math.round(margin * 100) / 100 };
}

// -------------------------------------------------------------------- chords

/*
 * Triads only, by default.
 *
 * sus4 and dim were in here and did real damage: a passing tone or a vocal
 * sitting on the fourth is enough to make sus4 outscore the triad, and on a
 * real mix that happened constantly. Extensions are still recognised, but only
 * when they beat the plain triad by a clear margin — see EXTENSIONS below.
 */
const TRIADS: { suffix: string; intervals: number[] }[] = [
  { suffix: "", intervals: [0, 4, 7] },
  { suffix: "m", intervals: [0, 3, 7] },
];

/**
 * Only used when they clearly beat the triad on the same root.
 *
 * sus4 is back after being removed outright, which was an over-correction: real
 * songs are full of them. It just has to earn the label like any other
 * extension rather than winning off a single passing tone.
 */
const EXTENSIONS: { suffix: string; intervals: number[] }[] = [
  { suffix: "7", intervals: [0, 4, 7, 10] },
  { suffix: "maj7", intervals: [0, 4, 7, 11] },
  { suffix: "m7", intervals: [0, 3, 7, 10] },
  { suffix: "sus4", intervals: [0, 5, 7] },
  { suffix: "sus2", intervals: [0, 2, 7] },
];

/** An extension must win by this much before it's reported instead of the triad. */
const EXTENSION_MARGIN = 0.25;

/**
 * ...unless you've already written that chord in the sheet, in which case it
 * only has to be plausible. If you typed Cmaj7, Cmaj7 is not a wild guess.
 */
const KNOWN_EXTENSION_MARGIN = 0.06;

/** Nudges toward chords the track says it uses. Deliberately gentle — a hint,
 *  not an override: if the audio clearly disagrees, the audio still wins. */
const VOCABULARY_BONUS = 0.1;
const DIATONIC_BONUS = 0.04;
/** The bass note is a strong cue for the root — a bigger nudge than the key
 *  hint, but still a nudge, so an inversion or a walking bass can override it. */
const BASS_BONUS = 0.14;

/**
 * What the track already tells us about itself.
 *
 * Run Sheet knows things a bare audio file doesn't: the key you typed, and the
 * chords in your sheet. Using them costs nothing and is the single biggest
 * accuracy gain available without a trained model — it turns an open guess
 * across 24 candidates into a mostly closed one.
 */
export interface ChordHints {
  /** Pitch classes of chords written in the sheet, with their full labels. */
  vocabulary?: string[];
  /** Tonic pitch class and mode, from the key field or from detection. */
  key?: { tonic: number; minor: boolean } | null;
  /**
   * The known tempo, to segment chords on real bars rather than the analyser's
   * tempo guess. A wrong guess sizes the segments wrong, so boundaries fall off
   * the beat and short chords get filtered away — which reads as chords that
   * don't line up (and the first one landing seconds late). Overrides the
   * detected tempo for segmentation only; the reported bpm is still detected.
   */
  bpm?: number | null;
}

/** Scale degrees that produce the ordinary chords of a key. */
function diatonicRoots(key: { tonic: number; minor: boolean }): Set<number> {
  const steps = key.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  return new Set(steps.map((s) => (key.tonic + s) % 12));
}

/** Below this, the segment isn't calling a chord — drums, silence, or a mess. */
const MIN_CHORD_SCORE = 0.55;

export interface ChordSegment {
  /** Seconds from the start of the file. */
  at: number;
  label: string;
  confidence: number;
}

function matchChord(
  chroma: number[],
  bass: number[],
  hints: ChordHints = {},
): { label: string; confidence: number } | null {
  const max = Math.max(...chroma);
  if (max <= 0) return null;
  const norm = chroma.map((c) => c / max);

  // The dominant bass pitch class, if the low end said anything this segment.
  const bassPeak = Math.max(...bass);
  const bassRoot = bassPeak > 0 ? bass.indexOf(bassPeak) : -1;

  const vocab = new Set(hints.vocabulary ?? []);
  const diatonic = hints.key ? diatonicRoots(hints.key) : null;
  // Spell the output in the key's accidentals; vocab matching stays on
  // PITCH_CLASSES, the spelling a vocabulary is normalised to.
  const classes = classesForKey(hints.key);

  const scoreOf = (root: number, suffix: string, intervals: number[]): number => {
    const template = Array.from({ length: 12 }, () => 0);
    for (const iv of intervals) template[(root + iv) % 12] = 1;
    let score = correlate(norm, template);
    /*
     * Hints nudge, they don't decide. A chord written in the sheet gets a small
     * lift, a chord merely belonging to the key gets a smaller one. Strong
     * enough to break ties between near-equal candidates — which is where the
     * wrong answers came from — but not enough to override audio that plainly
     * disagrees.
     */
    if (vocab.has(PITCH_CLASSES[root] + suffix)) score += VOCABULARY_BONUS;
    else if (diatonic?.has(root)) score += DIATONIC_BONUS;
    // A root sitting in the bass is the strongest hint there is on a real mix.
    if (bassRoot >= 0 && root === bassRoot) score += BASS_BONUS;
    return score;
  };

  let best: { root: number; suffix: string; score: number } | null = null;
  let runnerUp = -1;

  for (let root = 0; root < 12; root += 1) {
    for (const tpl of TRIADS) {
      const score = scoreOf(root, tpl.suffix, tpl.intervals);
      if (!best || score > best.score) {
        if (best) runnerUp = best.score;
        best = { root, suffix: tpl.suffix, score };
      } else if (score > runnerUp) {
        runnerUp = score;
      }
    }
  }

  if (!best || best.score < MIN_CHORD_SCORE) return null;

  // Only now consider an extension, and only on the root the triad chose.
  let suffix = best.suffix;
  let bestExtension = best.score;
  for (const tpl of EXTENSIONS) {
    const isMinorExt = tpl.suffix === "m7";
    const isSus = tpl.suffix.startsWith("sus");
    // m7 belongs to a minor triad, 7/maj7 to a major one; sus fits either.
    if (!isSus && best.suffix === "" && isMinorExt) continue;
    if (!isSus && best.suffix === "m" && !isMinorExt) continue;

    const label = PITCH_CLASSES[best.root] + tpl.suffix;
    const margin = vocab.has(label) ? KNOWN_EXTENSION_MARGIN : EXTENSION_MARGIN;
    const score = scoreOf(best.root, tpl.suffix, tpl.intervals);
    if (score > best.score + margin && score > bestExtension) {
      bestExtension = score;
      suffix = tpl.suffix;
    }
  }

  return {
    label: classes[best.root] + suffix,
    confidence: Math.round(Math.max(0, Math.min(1, (best.score - runnerUp) * 3)) * 100) / 100,
  };
}

/**
 * A chord label per segment, merged where consecutive segments agree.
 *
 * Segment length follows the tempo when we have one — chords change on beats,
 * not on arbitrary boundaries — and falls back to half a second when we don't.
 */
export function detectChords(
  frames: Float32Array[],
  sampleRate: number,
  bpm: number | null,
  hints: ChordHints = {},
): ChordSegment[] {
  if (frames.length === 0) return [];
  const frameSeconds = HARMONY_HOP / sampleRate;
  // Half-bar segments: chords commonly change mid-bar (Bbm | Gb within one bar),
  // and a full-bar window blurs the two into one averaged chroma and keeps only
  // the louder. Two beats catches the change; the merge below re-joins a chord
  // that does hold a whole bar, so nothing is lost by going finer.
  const segBpm = hints.bpm ?? bpm;
  const segmentSeconds = segBpm ? Math.max(0.3, (60 / segBpm) * 2) : 0.5;
  const framesPerSegment = Math.max(2, Math.round(segmentSeconds / frameSeconds));

  // One label per slot (null where nothing scored), so smoothing can reason
  // about time rather than only the chords that happened to match.
  const slots: { at: number; label: string | null; confidence: number }[] = [];
  for (let start = 0; start < frames.length; start += framesPerSegment) {
    const slice = frames.slice(start, start + framesPerSegment);
    if (slice.length < 2) break;
    const { chroma, bass } = chromagram(slice, sampleRate);
    const match = matchChord(chroma, bass, hints);
    slots.push({ at: start * frameSeconds, label: match?.label ?? null, confidence: match?.confidence ?? 0 });
  }

  // Smooth single-slot flickers: a lone chord between two slots that agree is
  // almost always a passing tone outvoting the real harmony for half a bar —
  // adopt the neighbours' chord. One left-to-right pass clears the isolated ones
  // without erasing a genuine two-slot change.
  for (let i = 1; i < slots.length - 1; i += 1) {
    const prev = slots[i - 1].label;
    if (prev && prev === slots[i + 1].label && slots[i].label !== prev) slots[i].label = prev;
  }

  const raw: ChordSegment[] = slots
    .filter((s): s is { at: number; label: string; confidence: number } => s.label !== null)
    .map((s) => ({ at: s.at, label: s.label, confidence: s.confidence }));

  // Merge runs of the same chord, and drop anything that lasted a blink —
  // usually a passing tone briefly outvoting the real harmony.
  const merged: ChordSegment[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.label === seg.label) {
      last.confidence = Math.max(last.confidence, seg.confidence);
      continue;
    }
    merged.push({ ...seg });
  }

  /*
   * The end of the audio, not the start of the last raw segment.
   *
   * Using the latter meant the final chord measured as zero-length and was
   * always thrown away — every progression lost its last chord, which is
   * exactly the one you most want to see when the file stops playing.
   */
  const endsAt = frames.length * frameSeconds;
  return merged.filter((seg, i) => {
    const next = merged[i + 1];
    const duration = (next ? next.at : endsAt) - seg.at;
    return duration >= segmentSeconds * 0.9;
  });
}

/**
 * Lay detected chords out as a chord sheet, four to a line.
 *
 * Deliberately not reusing the MIDI formatter: that one works in ticks and
 * beats, these are seconds, and bending one shape into the other would make
 * both harder to read.
 */
export function chordSegmentsToSheet(segments: ChordSegment[], perLine = 4): string {
  const lines: string[] = [];
  for (let i = 0; i < segments.length; i += perLine) {
    lines.push(
      segments
        .slice(i, i + perLine)
        .map((seg) => seg.label.padEnd(8))
        .join("")
        .replace(/\s+$/, ""),
    );
  }
  return lines.join("\n");
}

/**
 * Which chord is sounding at a given moment.
 *
 * Segments carry a start time only, so a chord runs until the next one begins.
 * Returns the index rather than the segment so the caller can highlight it
 * without searching again.
 *
 * Binary search because this runs on every timeupdate — four times a second
 * across a progression that can be hundreds of entries long.
 */
export function chordIndexAt(segments: ChordSegment[], seconds: number): number {
  if (segments.length === 0 || seconds < segments[0].at) return -1;
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (segments[mid].at <= seconds) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ------------------------------------------------------------------ top level

export interface AudioAnalysis {
  bpm: number | null;
  bpmAlternate: number | null;
  bpmConfidence: number;
  key: KeyResult | null;
  tuningCents: number;
  chords: ChordSegment[];
  /**
   * How much to trust the chord reading as a whole, 0-1.
   *
   * The mean margin by which each chord beat its runner-up. A dense mix where
   * every segment was a close call scores low even if each individual label
   * looks plausible — which is exactly when the strip should not look
   * authoritative.
   */
  chordConfidence: number;
  durationSeconds: number;
}

/** Everything in one pass over the file. */
export function analyseAudio(
  channels: Float32Array[],
  sampleRate: number,
  opts: { chords?: boolean; hints?: ChordHints } = {},
): AudioAnalysis {
  const mono = downsample(toMono(channels), sampleRate);

  // Short window for rhythm, long window for harmony. See the note at the top.
  const onsetFrames = spectrogram(mono, ONSET_FRAME, ONSET_HOP);
  const harmonyFrames = spectrogram(mono, HARMONY_FRAME, HARMONY_HOP);
  const envRate = ANALYSIS_RATE / ONSET_HOP;

  const tempo = detectTempo(onsetEnvelope(onsetFrames), envRate);
  const { chroma, tuningCents } = chromagram(harmonyFrames, ANALYSIS_RATE);
  const detectedKey = detectKeyFromChroma(chroma);

  const chords =
    opts.chords === false
      ? []
      : detectChords(harmonyFrames, ANALYSIS_RATE, tempo.bpm, {
          ...opts.hints,
          key:
            opts.hints?.key ??
            (detectedKey ? { tonic: detectedKey.tonic, minor: detectedKey.mode === "minor" } : null),
        });

  return {
    bpm: tempo.bpm,
    bpmAlternate: tempo.alternate,
    bpmConfidence: tempo.confidence,
    key: detectedKey,
    tuningCents,
    chords,
    chordConfidence:
      chords.length === 0
        ? 0
        : Math.round((chords.reduce((sum, c) => sum + c.confidence, 0) / chords.length) * 100) / 100,
    durationSeconds: (channels[0]?.length ?? 0) / sampleRate,
  };
}
