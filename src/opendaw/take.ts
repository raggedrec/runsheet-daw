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
import { encodeWav } from "../wav";

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
