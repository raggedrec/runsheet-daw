/**
 * The notes on a track, in seconds, read straight from the box graph.
 *
 * One source of truth: the in-lane note view (and later the editor) read here,
 * so an edit to the graph shows everywhere with no second copy to drift. Walks
 * the unit's tracks → note regions → events, converting pulses to seconds at the
 * song tempo. Returns null for a track with no notes (an audio stem, an empty
 * take), so the timeline can fall back to its waveform path.
 */
import type { Project } from "@opendaw/studio-core";
import type { AudioUnitBox } from "@opendaw/studio-boxes";

/** openDAW's pulses per quarter note — mirrored from lib-dsp's PPQN.Quarter. */
const PPQN_QUARTER = 960;

export interface LaneNote {
  /** Seconds from the song start. */
  at: number;
  /** Seconds. */
  duration: number;
  /** MIDI note number. */
  pitch: number;
}

export interface LaneNotes {
  notes: ReadonlyArray<LaneNote>;
  minPitch: number;
  maxPitch: number;
}

export function readLaneNotes(project: Project, unit: AudioUnitBox, bpm: number): LaneNotes | null {
  const adapter = project.rootBoxAdapter.audioUnits.adapters().find((a) => a.box === unit);
  if (!adapter || bpm <= 0) return null;

  const secondsPerPulse = 60 / (bpm * PPQN_QUARTER);
  const notes: LaneNote[] = [];
  let minPitch = Infinity;
  let maxPitch = -Infinity;

  for (const track of adapter.tracks.values()) {
    for (const region of track.regions.collection.asArray()) {
      if (!region.isNoteRegion()) continue;
      const collection = region.optCollection.unwrapOrNull();
      if (!collection) continue;
      // Event positions are relative to their region's start.
      const base = region.position;
      for (const ev of collection.events.asArray()) {
        notes.push({
          at: (base + ev.position) * secondsPerPulse,
          duration: ev.duration * secondsPerPulse,
          pitch: ev.pitch,
        });
        if (ev.pitch < minPitch) minPitch = ev.pitch;
        if (ev.pitch > maxPitch) maxPitch = ev.pitch;
      }
    }
  }

  if (notes.length === 0) return null;
  return { notes, minPitch, maxPitch };
}
