/**
 * Getting a recorded take back out of the engine and into Idea Drop.
 *
 * This is the step that makes the DAW a tool rather than a demo. Until a take
 * leaves the tab it exists nowhere — close the window and the performance is
 * gone, which is not a property any recording device should have.
 *
 * The path out:
 *
 *   capture.recordedRegions()  → the regions this input produced
 *   region.file                → points at an AudioFileBox
 *   box.address.uuid           → the sample's id in openDAW's store
 *   SampleStorage.load(uuid)   → [AudioData, peaks, meta]
 *
 * The audio then has to become a file. WAV rather than MP3: openDAW ships an
 * FFmpeg-based MP3 encoder, but it pulls a WASM core and a peer dependency,
 * and a take is a master — the thing every later bounce is derived from.
 * Encoding it lossily on the way in throws away quality that can never be
 * recovered, to save bandwidth on a file that gets uploaded once. The cost is
 * size: roughly 10 MB per stereo minute at 48 kHz.
 */
import { SampleStorage } from "@opendaw/studio-core";
import type { AudioData } from "@opendaw/lib-dsp";
import type { Peaks } from "@opendaw/lib-fusion";
import type { Capture } from "@opendaw/studio-core";

export interface Take {
  /** What to call it in Idea Drop. */
  name: string;
  audio: AudioData;
  /** Kept so the take can be drawn immediately, without a round trip. */
  peaks: Peaks;
  seconds: number;
  wav: Blob;
}

/**
 * Reads back everything an input recorded.
 *
 * Returns an array because one armed input can produce several regions across
 * several passes — punching in twice gives two takes, and silently keeping
 * only the last would throw away a performance.
 */
export async function collectTakes(capture: Capture, baseName: string): Promise<Take[]> {
  const regions = capture.recordedRegions();
  const takes: Take[] = [];

  for (const [i, region] of regions.entries()) {
    // The region points at an AudioFileBox; that box's own id is the id the
    // sample was stored under.
    const fileBox = (region as { file?: { targetVertex?: { unwrapOrNull?: () => unknown } } }).file
      ?.targetVertex?.unwrapOrNull?.() as { address?: { uuid?: unknown } } | null | undefined;
    const uuid = fileBox?.address?.uuid;
    if (uuid === undefined) continue;

    const [audio, peaks] = await SampleStorage.get().load(uuid as never);
    const seconds = audio.numberOfFrames / audio.sampleRate;
    takes.push({
      // Numbered only when there is more than one, so the common case reads
      // "Vox 2" rather than "Vox 2 1".
      name: regions.length > 1 ? `${baseName} ${i + 1}` : baseName,
      audio,
      peaks,
      seconds,
      wav: encodeWav(audio),
    });
  }
  return takes;
}

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
