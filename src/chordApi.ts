/**
 * Remote chord recognition via a ChordMini backend (github.com/ptnghia-j/ChordMiniApp).
 *
 * The in-browser DSP in audioAnalysis.ts has a hard ceiling on real mixes.
 * ChordMini runs trained models (Chord-CNN-LSTM / BTC) + madmom server-side and
 * is far more accurate. When VITE_CHORD_API_URL is set, the wand uses this
 * instead of the worker; the result maps into the same StoredAnalysis shape, so
 * the chord lane just works. When it's not set, nothing changes and the browser
 * engine is used. Ported from Run Sheet's chordApi.ts so the two stay in step.
 *
 * Backend contract (confirmed from the repo):
 *   POST {API}/api/recognize-chords   multipart form field `file`
 *   → { success, chords: [{ chord, start, end, time, confidence }], model_used }
 *   POST {API}/api/detect-beats       multipart form field `file`  → { bpm, beats }
 * Chord labels come as `Root:quality` ("C:maj", "A:min", "G:7", "N" = no chord).
 */
import type { StoredAnalysis } from "./chords";

export const CHORD_API_URL = (import.meta.env?.VITE_CHORD_API_URL as string | undefined)?.replace(/\/$/, "");

/**
 * A real mix takes the model a while; past this it is not coming back. One
 * signal covers the audio download and both POSTs — the budget for the whole
 * analysis, not per call. Too short is worse than too long: a timeout silently
 * drops to the weaker browser engine.
 */
export const CHORD_API_TIMEOUT_MS = 300_000;

export function isChordApiConfigured(): boolean {
  return Boolean(CHORD_API_URL);
}

interface ChordMiniChord {
  chord: string;
  start?: number;
  time?: number;
  end?: number;
  confidence?: number;
}
interface ChordMiniResponse {
  success?: boolean;
  chords?: ChordMiniChord[];
  model_used?: string;
  error?: string;
}

const QUALITY: Record<string, string> = {
  maj: "", major: "", min: "m", minor: "m",
  "7": "7", min7: "m7", m7: "m7", maj7: "maj7",
  dim: "dim", dim7: "dim7", aug: "aug", sus2: "sus2", sus4: "sus4",
  "9": "9", min9: "m9", maj9: "maj9", hdim7: "m7b5", minmaj7: "mM7",
  "6": "6", min6: "m6",
};

/**
 * ChordMini "Root:quality[/bass]" → a chord label. Drops the bass, maps the
 * quality to our suffixes, and returns null for no-chord ("N") / unknown ("X")
 * so those segments are skipped rather than rendered as a wrong chord.
 */
export function normalizeChordLabel(raw: string): string | null {
  if (!raw) return null;
  const noBass = raw.split("/")[0].trim();
  if (noBass === "N" || noBass === "X" || noBass.toUpperCase() === "N.C.") return null;
  const [root, quality = ""] = noBass.split(":");
  if (!/^[A-G](?:#|b)?$/.test(root)) return null;
  if (quality === "") return root; // bare root = major
  const mapped = QUALITY[quality.toLowerCase()];
  // Unknown quality: keep it verbatim rather than guessing major, so nothing is
  // silently mislabelled.
  return root + (mapped ?? quality);
}

/**
 * Map a ChordMini response (and optional bpm) into StoredAnalysis, merging
 * consecutive identical chords the way the browser engine does.
 */
export function toStoredAnalysis(
  resp: ChordMiniResponse,
  opts: { bpm?: number | null; key?: string | null } = {},
): StoredAnalysis {
  const merged: { at: number; label: string; confidence: number }[] = [];
  let confSum = 0;
  let confCount = 0;
  for (const c of resp.chords ?? []) {
    const label = normalizeChordLabel(c.chord);
    if (!label) continue;
    const at = c.start ?? c.time ?? 0;
    const confidence = typeof c.confidence === "number" ? c.confidence : 0;
    confSum += confidence;
    confCount += 1;
    const last = merged[merged.length - 1];
    if (last && last.label === label) {
      last.confidence = Math.max(last.confidence, confidence);
      continue;
    }
    merged.push({ at, label, confidence });
  }
  return {
    bpm: opts.bpm ?? null,
    key: opts.key ?? null,
    tuningCents: 0,
    chords: merged,
    chordConfidence: confCount ? confSum / confCount : undefined,
  };
}

/**
 * Analyse a track's audio with the remote backend. Fetches the (signed) audio
 * URL and posts it, so the backend does the heavy lifting. Throws on failure so
 * the caller can fall back to the browser engine.
 */
export async function analyzeChordsRemote(
  audioUrl: string,
  opts: { model?: string; signal?: AbortSignal } = {},
): Promise<StoredAnalysis> {
  if (!CHORD_API_URL) throw new Error("VITE_CHORD_API_URL is not set");

  // A refused connection fails immediately; a backend that is up but wedged does
  // not, and the wand would spin until the tab closed. Caller's signal wins.
  const signal = opts.signal ?? AbortSignal.timeout(CHORD_API_TIMEOUT_MS);

  const audioRes = await fetch(audioUrl, { signal });
  if (!audioRes.ok) throw new Error(`Couldn't fetch the audio (${audioRes.status})`);
  const blob = await audioRes.blob();

  const post = async (path: string, extra: Record<string, string> = {}) => {
    const form = new FormData();
    form.append("file", blob, "track.audio");
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    const res = await fetch(`${CHORD_API_URL}${path}`, { method: "POST", body: form, signal });
    if (!res.ok) throw new Error(`${path} failed (${res.status})`);
    return res.json();
  };

  const chordResp = (await post("/api/recognize-chords", opts.model ? { model: opts.model } : {})) as ChordMiniResponse;
  if (chordResp.success === false) throw new Error(chordResp.error || "Chord recognition failed");

  // Beats are best-effort — a missing/failed beat call shouldn't sink the chords.
  let bpm: number | null = null;
  try {
    const beatResp = (await post("/api/detect-beats")) as { bpm?: number };
    if (typeof beatResp.bpm === "number") bpm = Math.round(beatResp.bpm);
  } catch {
    /* keep bpm null */
  }

  return toStoredAnalysis(chordResp, { bpm });
}
