/**
 * Runs the analysis off the main thread.
 *
 * A four minute file is roughly ten thousand FFTs. On the main thread that
 * locks the tab for seconds — long enough that the "analysing" spinner
 * wouldn't even animate. The maths itself lives in audioAnalysis.ts and is
 * tested there; this file is only transport.
 */
import { analyseAudio, type AudioAnalysis, type ChordHints } from "./audioAnalysis";

export interface AnalyseRequest {
  channels: Float32Array[];
  sampleRate: number;
  chords: boolean;
  hints?: ChordHints;
}

self.onmessage = (e: MessageEvent<AnalyseRequest>) => {
  const { channels, sampleRate, chords, hints } = e.data;
  try {
    const result: AudioAnalysis = analyseAudio(channels, sampleRate, { chords, hints });
    self.postMessage({ ok: true, result });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : "Analysis failed" });
  }
};
