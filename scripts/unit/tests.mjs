/**
 * Tests that run without a browser.
 *
 *   npm test
 *
 * Everything here is pure: no engine, no AudioContext, no network. That's the
 * point — these are the parts that can be checked in a second rather than by
 * building, pushing, deploying and clicking. They wouldn't have caught the
 * recording bugs, which all lived in openDAW's async ordering, but they do
 * stop the arithmetic and the encoders quietly rotting while attention is
 * elsewhere.
 */
import { formatTime, formatBars } from "./bundle.mjs";
import { laneName, tempoOf, formatKey } from "./bundle.mjs";
import { sanitizeLook, laneColorFor, LANE_HEIGHT, DEFAULT_LOOK } from "./bundle.mjs";
import { encodeWav } from "./bundle.mjs";
import { bandMagnitudeDb, eqResponseDb } from "./bundle.mjs";
import { chordIndexAt, chordToMidi } from "./bundle.mjs";
import { chordsToSmf } from "./bundle.mjs";
import { classesForKey } from "./bundle.mjs";
import {
  feedMeter, clearClip, meterFill, linearToDb, SILENT_METER, METER_FLOOR_DB, RELEASE_DB_PER_SEC, HOLD_SECS, CLIP_LINEAR,
} from "./bundle.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass += 1;
  else { fail += 1; console.log(`  FAIL: ${name}${extra ? `  (${extra})` : ""}`); }
};
const eq = (name, actual, expected) =>
  ok(name, Object.is(actual, expected), `got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`);

console.log("\n  clock");
eq("zero", formatTime(0), "0:00");
eq("seconds pad", formatTime(9), "0:09");
eq("a minute", formatTime(60), "1:00");
eq("four fifty-one", formatTime(291.48), "4:51");
// Truncates rather than rounds: a clock that reads 4:51 when the song has
// 0.4s left is lying about having finished.
eq("truncates, never rounds up", formatTime(59.9), "0:59");
eq("negatives clamp", formatTime(-5), "0:00");

console.log("  bar | beat");
// Musicians count from bar 1 beat 1, not bar 0 beat 0.
eq("the very start", formatBars(0, 120), "1|1");
eq("one beat in at 120", formatBars(0.5, 120), "1|2");
eq("second bar at 120", formatBars(2, 120), "2|1");
eq("a slower tempo", formatBars(2, 60), "1|3");
eq("negatives clamp", formatBars(-1, 120), "1|1");

console.log("  lane names from filenames");
eq("takes the part, not the song", laneName("Touching Hands 112 DRUMS.mp3"), "Drums");
eq("underscores too", laneName("SKIN_120_VOX.wav"), "Vox");
// A trailing number is a tempo or a version, not a part name.
eq("skips a trailing number", laneName("Skin Dressed in Gold ACO 120.mp3"), "Aco");
eq("keeps a long name whole", laneName("Reference Mix Master.mp3"), "Master");

console.log("  tempo parsing (Run Sheet's bpm is free text)");
eq("a plain number", tempoOf("120"), 120);
eq("decimals", tempoOf("112.5"), 112.5);
eq("empty is null", tempoOf(""), null);
eq("nonsense is null", tempoOf("fastish"), null);
// Out of range is rejected rather than clamped: a wrong tempo silently
// accepted puts every region in the wrong place.
eq("absurdly slow is null", tempoOf("3"), null);
eq("absurdly fast is null", tempoOf("900"), null);

console.log("  musical keys (case is meaning here)");
// The bug that prompted these: a chip with textTransform uppercase turned
// C minor into CM and B flat into BB.
eq("minor keeps its lower-case m", formatKey("Cm"), "Cm");
eq("major stays bare", formatKey("C"), "C");
eq("a flat is a lower-case b", formatKey("Bb"), "Bb");
// People type BB for B flat. It is not a key otherwise, so read it as one.
eq("BB is B flat", formatKey("BB"), "Bb");
eq("sharps survive", formatKey("F#m"), "F#m");
eq("lower case gets capitalised", formatKey("f#m"), "F#m");
eq("written-out minor collapses", formatKey("C minor"), "Cm");
eq("min collapses too", formatKey("C min"), "Cm");
eq("written-out major is dropped", formatKey("A major"), "A");
eq("maj is dropped", formatKey("A maj"), "A");
eq("extensions are kept", formatKey("Cm7"), "Cm7");
eq("unicode flat normalises", formatKey("E♭"), "Eb");
eq("whitespace is trimmed", formatKey("  Dm  "), "Dm");
eq("empty is null", formatKey(""), null);
eq("null is null", formatKey(null), null);
// Not a key at all — show what was typed rather than mangling it.
eq("nonsense passes through", formatKey("dunno"), "dunno");

console.log("  look, sanitised");
{
  const l = sanitizeLook({ skin: "dark", accent: "amber", laneHeight: 90 });
  ok("valid values survive", l.skin === "dark" && l.accent === "amber" && l.laneHeight === 90);
}
eq("unknown skin falls back", sanitizeLook({ skin: "neon" }).skin, DEFAULT_LOOK.skin);
eq("unknown accent falls back", sanitizeLook({ accent: "puce" }).accent, DEFAULT_LOOK.accent);
eq("height clamps low", sanitizeLook({ laneHeight: 2 }).laneHeight, LANE_HEIGHT.min);
eq("height clamps high", sanitizeLook({ laneHeight: 9000 }).laneHeight, LANE_HEIGHT.max);
eq("garbage height falls back", sanitizeLook({ laneHeight: "tall" }).laneHeight, LANE_HEIGHT.default);
eq("null is survivable", sanitizeLook(null).skin, DEFAULT_LOOK.skin);

console.log("  lane colours are by role, not position");
ok("drums always the same", laneColorFor("Drums") === laneColorFor("DRUMS"));
ok("vox differs from drums", laneColorFor("Vox") !== laneColorFor("Drums"));
ok("an unknown part still gets a colour", typeof laneColorFor("Zither") === "string");

console.log("  WAV encoding");
{
  // A tiny two-channel signal with a known shape.
  const frames = 4;
  const audio = {
    sampleRate: 48000,
    numberOfFrames: frames,
    numberOfChannels: 2,
    frames: [
      new Float32Array([0, 1, -1, 0.5]),
      new Float32Array([0, -1, 1, -0.5]),
    ],
  };
  const blob = encodeWav(audio);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const ascii = (at, len) => String.fromCharCode(...bytes.slice(at, at + len));

  eq("RIFF header", ascii(0, 4), "RIFF");
  eq("WAVE type", ascii(8, 4), "WAVE");
  eq("fmt chunk", ascii(12, 4), "fmt ");
  eq("PCM format", view.getUint16(20, true), 1);
  eq("channel count", view.getUint16(22, true), 2);
  eq("sample rate", view.getUint32(24, true), 48000);
  eq("byte rate", view.getUint32(28, true), 48000 * 4);
  eq("block align", view.getUint16(32, true), 4);
  eq("bit depth", view.getUint16(34, true), 16);
  eq("data chunk", ascii(36, 4), "data");
  eq("data length", view.getUint32(40, true), frames * 4);
  eq("total size", bytes.length, 44 + frames * 4);
  eq("declared size matches", view.getUint32(4, true), 36 + frames * 4);

  // Interleaved: L,R,L,R — not one channel then the other.
  eq("first frame left", view.getInt16(44, true), 0);
  eq("first frame right", view.getInt16(46, true), 0);
  eq("full scale positive", view.getInt16(48, true), 32767);
  eq("full scale negative", view.getInt16(50, true), -32768);
  // setInt16 truncates rather than rounds: 0.5 * 32767 is 16383.5, stored as
  // 16383. Half an LSB, inaudible, and standard behaviour.
  eq("half scale truncates", view.getInt16(56, true), 16383);
}

{
  // Anything above 1.0 must clamp. Without this it wraps to a large negative
  // integer — a click on playback, not a clipped peak.
  const blob = encodeWav({
    sampleRate: 44100, numberOfFrames: 2, numberOfChannels: 1,
    frames: [new Float32Array([4.0, -4.0])],
  });
  const view = new DataView(await blob.arrayBuffer());
  eq("clamps above one", view.getInt16(44, true), 32767);
  eq("clamps below minus one", view.getInt16(46, true), -32768);
}

{
  const blob = encodeWav({
    sampleRate: 48000, numberOfFrames: 0, numberOfChannels: 2, frames: [new Float32Array(), new Float32Array()],
  });
  eq("an empty take is a valid header, not a crash", blob.size, 44);
}

console.log("  eq response (RBJ biquad magnitude)");
const near = (name, actual, expected, tol) =>
  ok(name, Math.abs(actual - expected) <= tol, `got ${actual.toFixed(2)}, wanted ${expected}±${tol}`);
// A peaking band reads its own gain at its centre frequency.
near("peak hits its gain at centre", bandMagnitudeDb({ type: "peaking", enabled: true, freq: 1000, gain: 6, q: 1 }, 1000), 6, 0.3);
near("a cut too", bandMagnitudeDb({ type: "peaking", enabled: true, freq: 1000, gain: -9, q: 2 }, 1000), -9, 0.3);
// Far from the centre a bell does nothing.
near("peak is flat an octave-and-more away", bandMagnitudeDb({ type: "peaking", enabled: true, freq: 1000, gain: 6, q: 2 }, 60), 0, 0.5);
// A shelf approaches its full gain in its own band.
near("low shelf lifts the lows", bandMagnitudeDb({ type: "lowshelf", enabled: true, freq: 200, gain: 6, q: 0 }, 30), 6, 0.6);
near("low shelf leaves the highs", bandMagnitudeDb({ type: "lowshelf", enabled: true, freq: 200, gain: 6, q: 0 }, 12000), 0, 0.3);
// A high-pass kills what's below its corner and passes what's above.
ok("high-pass attenuates below the corner", bandMagnitudeDb({ type: "highpass", enabled: true, freq: 1000, gain: 0, q: 0.707 }, 60) < -20);
near("high-pass passes well above", bandMagnitudeDb({ type: "highpass", enabled: true, freq: 100, gain: 0, q: 0.707 }, 8000), 0, 0.3);
// Disabled is flat, and the cascade sums its bands.
eq("a disabled band is flat", bandMagnitudeDb({ type: "peaking", enabled: false, freq: 1000, gain: 12, q: 1 }, 1000), 0);
near("the cascade sums", eqResponseDb([
  { type: "peaking", enabled: true, freq: 1000, gain: 6, q: 1 },
  { type: "peaking", enabled: true, freq: 1000, gain: 3, q: 1 },
], 1000), 9, 0.4);

console.log("  meter ballistics");
{
  const close = (name, actual, expected) =>
    ok(name, Math.abs(actual - expected) < 1e-6, `got ${actual}, wanted ${expected}`);
  // Attack is instant: one frame of -6 dBFS reads -6 straight away.
  const hit = feedMeter(SILENT_METER, 0.5, 1 / 60);
  close("instant attack", hit.levelDb, 20 * Math.log10(0.5));
  close("peak marker jumps with it", hit.holdDb, hit.levelDb);
  // The whole point of measuring in seconds: one second of silence falls the
  // same distance whether it arrived as 60 frames or 120.
  let at60 = hit, at120 = hit;
  for (let i = 0; i < 60; i++) at60 = feedMeter(at60, 0, 1 / 60);
  for (let i = 0; i < 120; i++) at120 = feedMeter(at120, 0, 1 / 120);
  close("release is the same at 60 and 120 Hz", at60.levelDb, at120.levelDb);
  close("release is RELEASE_DB_PER_SEC", at60.levelDb, hit.levelDb - RELEASE_DB_PER_SEC);
  // The held peak stays put for HOLD_SECS, then falls.
  let held = hit;
  for (let i = 0; i < 60 * (HOLD_SECS - 0.5); i++) held = feedMeter(held, 0, 1 / 60);
  close("hold stays put inside the hold time", held.holdDb, hit.holdDb);
  for (let i = 0; i < 60 * 1.5; i++) held = feedMeter(held, 0, 1 / 60);
  ok("hold falls after the hold time", held.holdDb < hit.holdDb);
  ok("the marker never sits below the bar", held.holdDb >= held.levelDb);
  // It bottoms out at the floor rather than falling forever.
  let floor = hit;
  for (let i = 0; i < 600; i++) floor = feedMeter(floor, 0, 1 / 60);
  eq("falls to the floor and stops", floor.levelDb, METER_FLOOR_DB);
  // A clock that went backwards (or a first frame) can't move the meter.
  close("negative dt is no time", feedMeter(hit, 0, -1).levelDb, hit.levelDb);
  close("NaN dt is no time", feedMeter(hit, 0, NaN).levelDb, hit.levelDb);
  eq("NaN sample reads as silence", feedMeter(SILENT_METER, NaN, 0.1).levelDb, METER_FLOOR_DB);
}

console.log("  clip latch");
{
  eq("starts clear", SILENT_METER.clipped, false);
  eq("a loud but legal sample doesn't clip", feedMeter(SILENT_METER, 0.99, 0.01).clipped, false);
  eq("the top 16-bit code clips", feedMeter(SILENT_METER, CLIP_LINEAR, 0.01).clipped, true);
  eq("negative full scale clips too", feedMeter(SILENT_METER, -1, 0.01).clipped, true);
  // The reason it exists: it stays lit through any amount of quiet after.
  let s = feedMeter(SILENT_METER, 1.2, 0.01);
  for (let i = 0; i < 6000; i++) s = feedMeter(s, 0, 1 / 60);
  eq("stays lit through 100 s of silence", s.clipped, true);
  eq("until cleared", clearClip(s).clipped, false);
  eq("clearing leaves the level alone", clearClip(s).levelDb, s.levelDb);
}

console.log("  meter scale");
eq("0 dBFS fills the bar", meterFill(0), 1);
eq("-60 is empty", meterFill(-60), 0);
eq("-30 is halfway", meterFill(-30), 0.5);
eq("over 0 clamps", meterFill(6), 1);
eq("the floor is empty", meterFill(METER_FLOOR_DB), 0);
eq("silence is the floor", linearToDb(0), METER_FLOOR_DB);

console.log("  chord index at playhead (shared with Run Sheet)");
{
  const ch = [
    { at: 0, label: "C", confidence: 1 },
    { at: 2, label: "G", confidence: 1 },
    { at: 4, label: "Am", confidence: 1 },
  ];
  eq("before the first chord", chordIndexAt(ch, -1), -1);
  eq("on the first boundary", chordIndexAt(ch, 0), 0);
  eq("inside the first", chordIndexAt(ch, 1.9), 0);
  eq("exactly on a boundary takes the new chord", chordIndexAt(ch, 2), 1);
  eq("inside the middle", chordIndexAt(ch, 3.5), 1);
  eq("in the last, open-ended", chordIndexAt(ch, 999), 2);
  eq("empty is -1", chordIndexAt([], 5), -1);
}

console.log("  chord spelling follows the key");
// pc 1 = Db / C#. A flat key spells it Db, a sharp key C#, no key C#.
eq("Db major → flats", classesForKey({ tonic: 1, minor: false })[1], "Db");
eq("Bb minor → flats (relative Db)", classesForKey({ tonic: 10, minor: true })[10], "Bb");
eq("Ab major → flats", classesForKey({ tonic: 8, minor: false })[6], "Gb");
eq("G major → sharps", classesForKey({ tonic: 7, minor: false })[1], "C#");
eq("E minor → sharps (relative G)", classesForKey({ tonic: 4, minor: true })[6], "F#");
eq("no key → sharps", classesForKey(null)[1], "C#");

console.log("  chord label → MIDI (block voicings, rooted at C3=48)");
const arr = (name, a, b) => ok(name, a.length === b.length && a.every((x, i) => x === b[i]), `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
arr("major triad", chordToMidi("C"), [48, 52, 55]);
arr("minor triad", chordToMidi("Am"), [57, 60, 64]);
arr("dominant 7", chordToMidi("G7"), [55, 59, 62, 65]);
arr("major 7 (flat root)", chordToMidi("Dbmaj7"), [49, 53, 56, 60]);
arr("minor 7", chordToMidi("Em7"), [52, 55, 59, 62]);
arr("sharp-root minor", chordToMidi("F#m"), [54, 57, 61]);
arr("sus4", chordToMidi("Csus4"), [48, 53, 55]);
arr("slash bass is ignored", chordToMidi("D/F#"), [50, 54, 57]);
arr("no-chord parses to nothing", chordToMidi("N.C."), []);
arr("flat and sharp name the same note", chordToMidi("Bb"), chordToMidi("A#"));

console.log("  chord progression → Standard MIDI File");
{
  const smf = chordsToSmf([{ at: 0, label: "C", confidence: 1 }, { at: 1, label: "Am", confidence: 1 }], 120, 2);
  // Header: "MThd", length 6, format 0, 1 track, division 960.
  arr("MThd header", Array.from(smf.slice(0, 14)), [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (960 >> 8) & 255, 960 & 255]);
  // A track chunk follows.
  arr("MTrk chunk", Array.from(smf.slice(14, 18)), [0x4d, 0x54, 0x72, 0x6b]);
  // Two triads = six note-ons (0x90) and six note-offs (0x80).
  let ons = 0, offs = 0;
  for (const b of smf) { if (b === 0x90) ons += 1; if (b === 0x80) offs += 1; }
  eq("six note-ons (two triads)", ons, 6);
  eq("six note-offs", offs, 6);
  // Ends with end-of-track meta FF 2F 00.
  arr("end of track", Array.from(smf.slice(-3)), [0xff, 0x2f, 0x00]);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
