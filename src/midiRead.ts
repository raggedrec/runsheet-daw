/**
 * Read a Standard MIDI File and pull a chord progression out of it.
 *
 * MIDI gives exact pitches and exact timing, so this beats the audio wand:
 * parse every track's notes (flattened), walk the file a quarter note at a time,
 * name the pitch classes sounding in each slot, and merge repeats into held
 * chords. Timing comes from the file's own tempo map, so a tempo change is
 * honoured without the song BPM — a MIDI file carries its own clock.
 *
 * Pure (no DOM, no openDAW), so it's unit-tested by round-tripping chordsToSmf.
 */
import { nameChord, type DetectedChord } from "./chords";

export interface SmfNote {
  startTick: number;
  endTick: number;
  pitch: number;
}

interface Tempo {
  tick: number;
  usPerQuarter: number;
}

export interface SmfData {
  ticksPerQuarter: number;
  notes: SmfNote[];
  tempos: Tempo[];
}

/** Parse the bytes of a .mid into its notes and tempo map. */
export function readSmf(input: ArrayBuffer | Uint8Array): SmfData {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let p = 0;
  const u32 = () => {
    const v = ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
    p += 4;
    return v;
  };
  const u16 = () => {
    const v = (bytes[p] << 8) | bytes[p + 1];
    p += 2;
    return v;
  };
  const tag = (n: number) => {
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[p + i]);
    p += n;
    return s;
  };

  if (tag(4) !== "MThd") throw new Error("Not a MIDI file (no MThd header).");
  const headerEnd = p + 4 + u32(); // 4 (length field) + the header body it measures
  u16(); // format — format 0, 1 and 2 all read the same way here
  const ntracks = u16();
  const division = u16();
  p = headerEnd;
  if (division & 0x8000) throw new Error("This MIDI file uses SMPTE timing, which isn't supported.");
  const ticksPerQuarter = division || 480;

  const notes: SmfNote[] = [];
  const tempos: Tempo[] = [];

  for (let t = 0; t < ntracks && p + 8 <= bytes.length; t++) {
    if (tag(4) !== "MTrk") {
      p += u32(); // skip an unknown chunk
      continue;
    }
    const stop = Math.min(bytes.length, p + 4 + u32()); // 4 (length field) + body
    let tick = 0;
    let status = 0;
    const open = new Map<number, number>(); // (channel<<8 | pitch) → startTick
    const readVlq = () => {
      let v = 0;
      for (;;) {
        const b = bytes[p++];
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      return v;
    };

    while (p < stop) {
      tick += readVlq();
      if (bytes[p] & 0x80) status = bytes[p++]; // else running status: keep prev
      const type = status & 0xf0;
      const chan = status & 0x0f;
      if (status === 0xff) {
        const metaType = bytes[p++];
        const len = readVlq();
        if (metaType === 0x51 && len === 3) {
          tempos.push({ tick, usPerQuarter: (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2] });
        }
        p += len;
      } else if (status === 0xf0 || status === 0xf7) {
        p += readVlq(); // sysex — skip its bytes
      } else if (type === 0x90 || type === 0x80) {
        const pitch = bytes[p++];
        const vel = bytes[p++];
        const key = (chan << 8) | pitch;
        if (type === 0x90 && vel > 0) {
          if (!open.has(key)) open.set(key, tick);
        } else {
          const startTick = open.get(key);
          if (startTick !== undefined) {
            notes.push({ startTick, endTick: tick, pitch });
            open.delete(key);
          }
        }
      } else if (type === 0xc0 || type === 0xd0) {
        p += 1; // program change / channel pressure — one data byte
      } else {
        p += 2; // 0xa0, 0xb0, 0xe0 — two data bytes
      }
    }
    // Close any notes still held at the track's end.
    for (const [key, startTick] of open) notes.push({ startTick, endTick: tick, pitch: key & 0xff });
    p = stop;
  }

  tempos.sort((a, b) => a.tick - b.tick);
  return { ticksPerQuarter, notes, tempos };
}

/** Seconds at `tick`, following the tempo map (120 BPM until the first mark). */
function tickToSeconds(tick: number, tempos: Tempo[], tpq: number): number {
  let seconds = 0;
  let lastTick = 0;
  let us = 500000; // 120 BPM
  for (const tempo of tempos) {
    if (tempo.tick >= tick) break;
    seconds += ((tempo.tick - lastTick) / tpq) * (us / 1e6);
    lastTick = tempo.tick;
    us = tempo.usPerQuarter;
  }
  return seconds + ((tick - lastTick) / tpq) * (us / 1e6);
}

/**
 * The file's notes as a chord progression. Walks a quarter note at a time,
 * names the pitch classes sounding in each slot, merges held repeats, and drops
 * only leading silence so the chart starts on the first chord.
 */
export function notesToChords(data: SmfData, flat = false): DetectedChord[] {
  const { notes, tempos, ticksPerQuarter } = data;
  if (notes.length === 0) return [];

  const totalTicks = notes.reduce((m, n) => Math.max(m, n.endTick), 0);
  const step = Math.max(1, ticksPerQuarter);
  const raw: DetectedChord[] = [];
  for (let s = 0; s < totalTicks; s += step) {
    const e = s + step;
    const active = notes.filter((n) => n.startTick < e && n.endTick > s);
    const at = tickToSeconds(s, tempos, ticksPerQuarter);
    if (active.length === 0) {
      raw.push({ at, label: "N.C.", confidence: 1 });
      continue;
    }
    const bass = active.reduce((lo, n) => Math.min(lo, n.pitch), Infinity);
    const { label, confidence } = nameChord(active.map((n) => n.pitch), ((bass % 12) + 12) % 12, flat);
    raw.push({ at, label, confidence });
  }

  const merged: DetectedChord[] = [];
  for (const c of raw) {
    const prev = merged[merged.length - 1];
    if (!prev || prev.label !== c.label) merged.push(c);
  }
  while (merged.length > 0 && merged[0].label === "N.C.") merged.shift();
  return merged;
}

/** Convenience: bytes of a .mid → chord progression. */
export function extractChordsFromSmf(input: ArrayBuffer | Uint8Array, flat = false): DetectedChord[] {
  return notesToChords(readSmf(input), flat);
}
