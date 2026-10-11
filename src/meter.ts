/**
 * Peak-meter ballistics: instant attack, a release measured in dB per second,
 * a held peak, and a clip light that stays lit until someone clears it.
 *
 * Ported from SoundCraft's `PeakMeter` (crates/dsp/src/meter.rs, MIT OR
 * Apache-2.0, Copyright (c) 2026 ArtCraft Team and the SoundCraft contributors).
 *
 * Why the latch matters more than the bar: a vocal that clips on the last
 * chorus clips while the engineer is reading lyrics, and a meter that has
 * already fallen back by the time anyone looks has destroyed the only evidence.
 *
 * Why seconds and not frames: the release used to be `level * 0.8` per
 * animation frame, so a 120 Hz display fell twice as fast as a 60 Hz one and
 * the same mix read differently on two Macs. Everything here takes the real
 * elapsed time.
 *
 * Pure: no React, no engine, no AudioContext — so it's covered by `npm test`.
 */

export const METER_FLOOR_DB = -80;

/** How fast the bar and, after its hold, the peak marker fall. */
export const RELEASE_DB_PER_SEC = 20;

/** How long the peak marker stays put before it starts falling. */
export const HOLD_SECS = 2;

/**
 * At or above this a sample counts as clipped: the top code of a 16-bit WAV,
 * which is what takes are written as. A float stream that reaches it has
 * clipped in the file even if it never quite touched 1.0.
 */
export const CLIP_LINEAR = 1 - 1 / 32768;

export interface MeterState {
  /** Displayed level, dBFS. */
  levelDb: number;
  /** Held peak, dBFS. */
  holdDb: number;
  /** Seconds left before the held peak starts to fall. */
  holdLeft: number;
  /** Latched until `clearClip`. */
  clipped: boolean;
}

export const SILENT_METER: MeterState = Object.freeze({
  levelDb: METER_FLOOR_DB,
  holdDb: METER_FLOOR_DB,
  holdLeft: 0,
  clipped: false,
});

export function linearToDb(v: number): number {
  if (!(v > 0) || !Number.isFinite(v)) return METER_FLOOR_DB;
  return Math.max(METER_FLOOR_DB, 20 * Math.log10(v));
}

/**
 * Feed the loudest sample seen over the last `dtSecs` seconds.
 *
 * A negative or non-finite dt (a clock that went backwards, a first frame with
 * no previous timestamp) is treated as zero rather than allowed to push the
 * meter upward.
 */
export function feedMeter(s: MeterState, peakLinear: number, dtSecs: number): MeterState {
  const dt = Number.isFinite(dtSecs) && dtSecs > 0 ? dtSecs : 0;
  const peak = Number.isFinite(peakLinear) ? Math.abs(peakLinear) : 0;
  const peakDb = linearToDb(peak);
  const fall = RELEASE_DB_PER_SEC * dt;

  const levelDb = Math.max(peakDb, Math.max(METER_FLOOR_DB, s.levelDb - fall));

  let holdDb: number;
  let holdLeft: number;
  if (peakDb >= s.holdDb) {
    holdDb = peakDb;
    holdLeft = HOLD_SECS;
  } else if (s.holdLeft > 0) {
    holdDb = s.holdDb;
    holdLeft = Math.max(0, s.holdLeft - dt);
  } else {
    // The marker never sits below the bar it's marking.
    holdDb = Math.max(levelDb, s.holdDb - fall);
    holdLeft = 0;
  }

  return { levelDb, holdDb, holdLeft, clipped: s.clipped || peak >= CLIP_LINEAR };
}

export function clearClip(s: MeterState): MeterState {
  return { ...s, clipped: false };
}

/**
 * dB → 0..1 along the bar. Linear over the bottom 60 dB, as both meters have
 * always drawn it — the scale is a separate decision from the ballistics.
 */
export function meterFill(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db + 60) / 60));
}
