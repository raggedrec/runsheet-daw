/**
 * WAV encoding, deliberately kept clear of openDAW.
 *
 * The type import is erased at build time, so this module pulls in nothing at
 * runtime — which is what lets it be tested in Node. Anything that reaches for
 * an AudioWorkletNode cannot be, and the boundary is worth keeping sharp.
 */
import type { AudioData } from "@opendaw/lib-dsp";

/**
 * A 16-bit PCM WAV from openDAW's float frames.
 *
 * 16-bit rather than 24 or float: it's what every DAW, phone and browser opens
 * without thinking, and the take is already going to be re-encoded by whatever
 * it lands in. The dither question doesn't arise at the level of "a demo take
 * against a backing track".
 *
 * Frames arrive as one Float32Array per channel and WAV wants them
 * interleaved, so this walks frames in the outer loop and channels in the
 * inner one.
 */
export function encodeWav(audio: AudioData): Blob {
  const { sampleRate, numberOfChannels: channels, numberOfFrames: frames } = audio;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = frames * blockAlign;

  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // format 1 = uncompressed PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let ch = 0; ch < channels; ch++) {
      // Clamp before scaling. A float above 1.0 would otherwise wrap to a
      // large negative integer — a click on playback rather than a clipped
      // peak, which is far more noticeable and far harder to explain.
      const sample = Math.max(-1, Math.min(1, audio.frames[ch]?.[frame] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}
