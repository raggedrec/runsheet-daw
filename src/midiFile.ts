/**
 * A Standard MIDI File of the chord progression — the export behind the chord
 * lane's download.
 *
 * Built from the same chords and tempo as the in-DAW MIDI track, so the file and
 * the track agree. Format 0 (one track): a tempo meta event, block-triad notes
 * held from each chord's `at` to the next, end of track. Pure — no DOM, no
 * openDAW — so it is unit-tested rather than inspected in another DAW.
 */
import { chordToMidi, type DetectedChord } from "./chords";

/** Variable-length quantity, big-endian 7-bit groups — how SMF stores times. */
function vlq(value: number): number[] {
  let n = Math.max(0, Math.round(value));
  const out = [n & 0x7f];
  n = Math.floor(n / 128);
  while (n > 0) {
    out.unshift((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  return out;
}

const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number): number[] => [(n >> 8) & 255, n & 255];

/** The progression as a Standard MIDI File. `tpq` = ticks per quarter note. */
export function chordsToSmf(
  chords: ReadonlyArray<DetectedChord>,
  bpm: number,
  songSeconds: number,
  tpq = 960,
): Uint8Array {
  const ticksPerSecond = (bpm / 60) * tpq;

  // (tick, order, bytes) events; order 0 = note-off, so offs win ties with the
  // next chord's ons and a held note doesn't bleed into the next chord.
  const events: Array<{ tick: number; order: number; data: number[] }> = [];
  chords.forEach((chord, i) => {
    const end = i + 1 < chords.length ? chords[i + 1].at : songSeconds;
    const onTick = Math.max(0, Math.round(chord.at * ticksPerSecond));
    const offTick = Math.max(onTick + 1, Math.round(end * ticksPerSecond));
    for (const pitch of chordToMidi(chord.label)) {
      events.push({ tick: onTick, order: 1, data: [0x90, pitch, 80] }); // note on, channel 1
      events.push({ tick: offTick, order: 0, data: [0x80, pitch, 0] }); // note off
    }
  });
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const track: number[] = [];
  // Tempo: microseconds per quarter note.
  const uspq = Math.round(60000000 / bpm);
  track.push(...vlq(0), 0xff, 0x51, 0x03, (uspq >> 16) & 255, (uspq >> 8) & 255, uspq & 255);
  // Track name.
  const name = Array.from(new TextEncoder().encode("Chords"));
  track.push(...vlq(0), 0xff, 0x03, ...vlq(name.length), ...name);

  let prev = 0;
  for (const ev of events) {
    track.push(...vlq(ev.tick - prev), ...ev.data);
    prev = ev.tick;
  }
  track.push(...vlq(0), 0xff, 0x2f, 0x00); // end of track

  const header = [0x4d, 0x54, 0x68, 0x64, ...u32(6), ...u16(0), ...u16(1), ...u16(tpq)]; // MThd, format 0, 1 track
  const chunk = [0x4d, 0x54, 0x72, 0x6b, ...u32(track.length), ...track]; // MTrk
  return new Uint8Array([...header, ...chunk]);
}
