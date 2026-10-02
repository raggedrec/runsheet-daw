/**
 * The EQ's frequency response, computed — not drawn by eye.
 *
 * openDAW's Revamp EQ is a cascade of RBJ biquad filters (the "Audio EQ
 * Cookbook" shapes). The curve the panel draws is the real transfer function of
 * that cascade: each enabled band's magnitude at a frequency, summed in dB. That
 * makes it honest — the line moves because the maths says the audio does, not
 * because a spline was bent to look plausible.
 *
 * Pure and framework-free so it can be unit-tested in a second (see
 * scripts/unit): a wrong coefficient is caught here, not by squinting at a
 * deployed build.
 *
 * RUNTIME-UNVERIFIED: the band fields are read as Hz / dB / Q (what openDAW
 * stores for a Float32 EQ parameter). Verify the line tracks a real EQ once one
 * is on a track — if it looks inverted or flat, the field units are the suspect.
 */

/** One biquad band. Shelves ignore `q` (fixed slope); passes ignore `gain`. */
export interface EqBand {
  type: "highpass" | "lowpass" | "lowshelf" | "highshelf" | "peaking";
  enabled: boolean;
  /** Corner / centre frequency, Hz. */
  freq: number;
  /** Boost or cut, dB (shelving and peaking only). */
  gain: number;
  /** Resonance (peaking and pass only). */
  q: number;
}

interface Coeffs {
  b0: number; b1: number; b2: number;
  a0: number; a1: number; a2: number;
}

/**
 * Display sample rate. The engine may run at 44.1 or 48 kHz; the difference in a
 * drawn curve below 20 kHz is sub-pixel, so one fixed rate keeps the maths
 * simple without lying about the shape.
 */
export const DISPLAY_FS = 48000;

/** RBJ cookbook coefficients for one band at a sample rate. */
function coeffs(band: EqBand, fs: number): Coeffs {
  const w0 = (2 * Math.PI * band.freq) / fs;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  // A shelf has no Q in openDAW; S=1 (a Butterworth-ish slope) is the standard
  // choice, which reduces its alpha to this.
  const shelfAlpha = (sinw0 / 2) * Math.SQRT2;

  switch (band.type) {
    case "peaking": {
      const A = Math.pow(10, band.gain / 40);
      const alpha = sinw0 / (2 * Math.max(1e-4, band.q));
      return { b0: 1 + alpha * A, b1: -2 * cosw0, b2: 1 - alpha * A, a0: 1 + alpha / A, a1: -2 * cosw0, a2: 1 - alpha / A };
    }
    case "lowshelf": {
      const A = Math.pow(10, band.gain / 40);
      const tsa = 2 * Math.sqrt(A) * shelfAlpha;
      return {
        b0: A * ((A + 1) - (A - 1) * cosw0 + tsa),
        b1: 2 * A * ((A - 1) - (A + 1) * cosw0),
        b2: A * ((A + 1) - (A - 1) * cosw0 - tsa),
        a0: (A + 1) + (A - 1) * cosw0 + tsa,
        a1: -2 * ((A - 1) + (A + 1) * cosw0),
        a2: (A + 1) + (A - 1) * cosw0 - tsa,
      };
    }
    case "highshelf": {
      const A = Math.pow(10, band.gain / 40);
      const tsa = 2 * Math.sqrt(A) * shelfAlpha;
      return {
        b0: A * ((A + 1) + (A - 1) * cosw0 + tsa),
        b1: -2 * A * ((A - 1) + (A + 1) * cosw0),
        b2: A * ((A + 1) + (A - 1) * cosw0 - tsa),
        a0: (A + 1) - (A - 1) * cosw0 + tsa,
        a1: 2 * ((A - 1) - (A + 1) * cosw0),
        a2: (A + 1) - (A - 1) * cosw0 - tsa,
      };
    }
    case "highpass": {
      const alpha = sinw0 / (2 * Math.max(1e-4, band.q));
      return { b0: (1 + cosw0) / 2, b1: -(1 + cosw0), b2: (1 + cosw0) / 2, a0: 1 + alpha, a1: -2 * cosw0, a2: 1 - alpha };
    }
    case "lowpass": {
      const alpha = sinw0 / (2 * Math.max(1e-4, band.q));
      return { b0: (1 - cosw0) / 2, b1: 1 - cosw0, b2: (1 - cosw0) / 2, a0: 1 + alpha, a1: -2 * cosw0, a2: 1 - alpha };
    }
  }
}

/**
 * One band's magnitude at frequency `f`, in dB. Disabled bands are flat (0 dB),
 * so a cascade with everything off is a straight line — the honest "no effect".
 *
 * Evaluates H(e^jω) directly: z⁻¹ = cos ω − j·sin ω, so the numerator and
 * denominator are each a complex number and the magnitude is their ratio. The
 * pass slope order isn't applied — the corner frequency is exact, the roll-off
 * is drawn as the single 2nd-order stage, not the steeper multi-stage one.
 */
export function bandMagnitudeDb(band: EqBand, f: number, fs: number = DISPLAY_FS): number {
  if (!band.enabled || band.freq <= 0) return 0;
  const { b0, b1, b2, a0, a1, a2 } = coeffs(band, fs);
  const w = (2 * Math.PI * f) / fs;
  const cosw = Math.cos(w), sinw = Math.sin(w);
  const cos2w = Math.cos(2 * w), sin2w = Math.sin(2 * w);
  const numRe = b0 + b1 * cosw + b2 * cos2w;
  const numIm = -(b1 * sinw + b2 * sin2w);
  const denRe = a0 + a1 * cosw + a2 * cos2w;
  const denIm = -(a1 * sinw + a2 * sin2w);
  const num = Math.hypot(numRe, numIm);
  const den = Math.hypot(denRe, denIm) || 1e-12;
  return 20 * Math.log10(num / den);
}

/** The whole cascade's magnitude at `f`, in dB — the sum of every band. */
export function eqResponseDb(bands: ReadonlyArray<EqBand>, f: number, fs: number = DISPLAY_FS): number {
  let sum = 0;
  for (const band of bands) sum += bandMagnitudeDb(band, f, fs);
  return sum;
}
