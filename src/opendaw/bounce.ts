/**
 * Bouncing the mix to a single audio file.
 *
 * openDAW renders offline through OfflineEngineRenderer — a separate engine that
 * runs faster than real time in a worker and returns the finished audio. It is
 * installed by WasmEngine.install during boot (it wires the offline worker), so
 * nothing extra is set up here.
 *
 * `Option.None` for the export configuration means the whole mix through the
 * master, rather than a stems map — one file, everything in it, which is what a
 * bounce is. The sample rate matches the session so the bounce lines up with the
 * takes it sits beside in Idea Drop.
 */
import { OfflineEngineRenderer, type Project } from "@opendaw/studio-core";
import { Option, DefaultObservableValue } from "@opendaw/lib-std";
import type { AudioData } from "@opendaw/lib-dsp";

export async function bounceMix(project: Project, sampleRate: number): Promise<AudioData> {
  const progress = new DefaultObservableValue(0);
  return OfflineEngineRenderer.start(project, Option.None, progress, undefined, sampleRate);
}
