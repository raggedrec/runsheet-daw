/**
 * The metronome's click sounds.
 *
 * openDAW has a metronome built into the engine — it counts the bars in and can
 * click through playback — but it ships with no sound of its own: `enabled` with
 * nothing loaded is a silent metronome. `loadClickSound(index, data)` is how you
 * give it one, so we synthesise two short clicks and hand them over: index 0 is
 * the bar accent, index 1 the beat between.
 *
 * Synthesised rather than shipped as WAV assets because a click is three lines of
 * maths — a sine burst under a fast decay — and a generated one needs no fetch,
 * no COOP/COEP-safe asset path, and no licence to worry about.
 */
import { AudioData } from "@opendaw/lib-dsp";
import type { Project } from "@opendaw/studio-core";

/**
 * A short percussive click as AudioData the engine can play.
 *
 * A sine at `freqHz` under an exponential decay: a click, not a sustained beep.
 * `AudioData.create` allocates the SharedArrayBuffer-backed frames the worklet
 * reads across the thread boundary — a plain Float32Array won't cross it.
 */
export function makeClick(sampleRate: number, freqHz: number, seconds: number): AudioData {
  const frames = Math.max(1, Math.floor(sampleRate * seconds));
  const data = AudioData.create(sampleRate, frames, 1);
  const channel = data.frames[0];
  // Per-second decay, tuned so a ~50 ms buffer has fallen to silence by its end
  // rather than clipping off mid-swing (which is its own audible click).
  const decay = 90;
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    channel[i] = Math.sin(2 * Math.PI * freqHz * t) * Math.exp(-t * decay);
  }
  return data;
}

/**
 * Loads both click sounds into the engine.
 *
 * The accent is higher and the beat lower, the usual convention, so bar one is
 * audibly the downbeat. Call once the worklet exists — before that the load is
 * dispatched into nothing.
 */
export function loadClickSounds(project: Project, sampleRate: number): void {
  project.engine.loadClickSound(0, makeClick(sampleRate, 1760, 0.05));
  project.engine.loadClickSound(1, makeClick(sampleRate, 1240, 0.045));
}
