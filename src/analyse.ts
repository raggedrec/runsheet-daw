/**
 * The magic wand's plumbing: fetch a file, decode it, analyse it off the main
 * thread.
 *
 * The analyser itself (audioAnalysis.ts) and its worker are ported verbatim
 * from Run Sheet, so the DAW detects the same chords Run Sheet would and writes
 * the same `idea_drop_files.analysis` blob. This file is only transport:
 * browser-decode the audio, hand the samples to the worker, return the result.
 * Nothing is uploaded — the samples never leave the tab.
 */
import { analyseAudio, type AudioAnalysis, type ChordHints } from "./audioAnalysis";

/** Long files are the ones that hurt, and the first five minutes are enough. */
const MAX_SECONDS = 300;

export async function decodeToChannels(
  data: ArrayBuffer,
): Promise<{ channels: Float32Array[]; sampleRate: number }> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const buffer = await ctx.decodeAudioData(data);
    const wanted = Math.min(buffer.length, Math.floor(MAX_SECONDS * buffer.sampleRate));
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c += 1) {
      channels.push(buffer.getChannelData(c).slice(0, wanted));
    }
    return { channels, sampleRate: buffer.sampleRate };
  } finally {
    // Browsers cap concurrent AudioContexts; leaking one per analysis would
    // eventually refuse to decode anything at all.
    void ctx.close();
  }
}

/**
 * Analyse in a worker where possible, falling back to the main thread.
 *
 * The fallback freezes the tab for a few seconds — a four-minute file is ~10k
 * FFTs — but a frozen tab beats a feature that silently does nothing.
 */
export function analyseInWorker(
  channels: Float32Array[],
  sampleRate: number,
  chords: boolean,
  hints?: ChordHints,
): Promise<AudioAnalysis> {
  if (typeof Worker === "undefined") {
    return Promise.resolve(analyseAudio(channels, sampleRate, { chords, hints }));
  }

  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./audioAnalysis.worker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve(analyseAudio(channels, sampleRate, { chords, hints }));
      return;
    }

    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("Analysis took too long and was stopped."));
    }, 120_000);

    worker.onmessage = (e: MessageEvent<{ ok: boolean; result?: AudioAnalysis; error?: string }>) => {
      clearTimeout(timeout);
      worker.terminate();
      if (e.data.ok && e.data.result) resolve(e.data.result);
      else reject(new Error(e.data.error ?? "Analysis failed"));
    };
    worker.onerror = () => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error("Analysis failed to start"));
    };

    // Transfer rather than copy: these arrays are megabytes each.
    worker.postMessage({ channels, sampleRate, chords, hints }, channels.map((c) => c.buffer));
  });
}
