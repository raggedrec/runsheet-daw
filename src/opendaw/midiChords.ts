/**
 * Turn the detected chords into a playable MIDI chord track.
 *
 * A reference pad, not a performance: a Vaporisateur synth (polyphonic by
 * default) with one note region of block-triad voicings, each chord held from
 * its `at` to the next. The notes live in openDAW's graph, so they play, bounce
 * and export like any track — the DAW's own timeline draws waveforms, not a
 * piano roll, so the notes aren't drawn there; the chord lane is the reference.
 *
 * The boxes are built explicitly, mirroring openDAW's own MIDI-record path
 * (RecordMidi): a NoteEventCollectionBox, a NoteRegionBox pointing at it and the
 * track, and a NoteEventBox per note pointing back at the collection. Timed in
 * pulses (PPQN.Quarter = 960) from the song tempo. All inside one editing.modify.
 */
import type { Project } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { NoteEventBox, NoteEventCollectionBox, NoteRegionBox, type AudioUnitBox } from "@opendaw/studio-boxes";
import { UUID } from "@opendaw/lib-std";
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
  const { boxGraph } = project;

  let unit: AudioUnitBox | null = null;
  let wired = 0;
  project.editing.modify(() => {
    // A synth instrument gives a Notes track (unlike Tape, which is audio).
    const { audioUnitBox, trackBox } = project.api.createInstrument(InstrumentFactories.Vaporisateur, { name });
    unit = audioUnitBox;

    const collection = NoteEventCollectionBox.create(boxGraph, UUID.generate());
    NoteRegionBox.create(boxGraph, UUID.generate(), (box) => {
      box.regions.refer(trackBox.regions);
      box.events.refer(collection.owners);
      box.position.setValue(0);
      box.duration.setValue(total);
      box.loopDuration.setValue(total);
      box.label.setValue(name);
    });

    chords.forEach((chord, i) => {
      const end = i + 1 < chords.length ? chords[i + 1].at : songSeconds;
      const position = Math.max(0, Math.round(chord.at * pulsesPerSecond));
      const duration = Math.max(1, Math.round((end - chord.at) * pulsesPerSecond));
      for (const pitch of chordToMidi(chord.label)) {
        NoteEventBox.create(boxGraph, UUID.generate(), (box) => {
          box.position.setValue(position);
          box.duration.setValue(duration);
          box.pitch.setValue(pitch);
          box.velocity.setValue(0.7);
          box.events.refer(collection.events);
        });
        wired += 1;
      }
    });
  });

  // Loud, so a silent track can be told apart from a wiring failure.
  console.info(`[createChordTrack] wired ${wired} note events into the region`);
  if (unit === null) throw new Error("The chord track wasn't created.");
  return unit;
}
