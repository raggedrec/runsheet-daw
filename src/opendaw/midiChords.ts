/**
 * Turn the detected chords into a playable MIDI chord track.
 *
 * A reference pad, not a performance: a Vaporisateur synth with one note region
 * holding block-triad voicings, each chord held from its `at` to the next. The
 * notes live in openDAW's graph, so they play, bounce and export like any track
 * — the DAW's own timeline draws waveforms, not a piano roll, so the notes
 * aren't drawn there, but the chord lane above is the visual reference.
 *
 * openDAW times notes in pulses (PPQN.Quarter = 960), so seconds convert through
 * the project tempo. All the box writes go inside one `editing.modify`, like
 * every other graph change; the created unit is read out so the caller can add
 * a lane for it.
 */
import type { Project } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import { chordToMidi, type DetectedChord } from "../chords";

/** openDAW's pulses per quarter note — mirrored from lib-dsp's PPQN.Quarter. */
const PPQN_QUARTER = 960;

export function createChordTrack(
  project: Project,
  chords: ReadonlyArray<DetectedChord>,
  bpm: number,
  songSeconds: number,
  name = "Chords (MIDI)",
): AudioUnitBox {
  const pulsesPerSecond = (bpm / 60) * PPQN_QUARTER;
  const total = Math.max(1, Math.round(songSeconds * pulsesPerSecond));

  let unit: AudioUnitBox | null = null;
  project.editing.modify(() => {
    // A synth instrument gives a note track (unlike Tape, which is audio).
    const { audioUnitBox, trackBox } = project.api.createInstrument(InstrumentFactories.Vaporisateur, { name });
    unit = audioUnitBox;

    const region = project.api.createNoteRegion({ trackBox, position: 0, duration: total, name });

    chords.forEach((chord, i) => {
      const end = i + 1 < chords.length ? chords[i + 1].at : songSeconds;
      const position = Math.max(0, Math.round(chord.at * pulsesPerSecond));
      const duration = Math.max(1, Math.round((end - chord.at) * pulsesPerSecond));
      for (const pitch of chordToMidi(chord.label)) {
        // `owner` is anything with an `events` pointer; the region is one.
        project.api.createNoteEvent({ owner: region, position, duration, pitch, velocity: 0.7 });
      }
    });
  });

  if (unit === null) throw new Error("The chord track wasn't created.");
  return unit;
}
