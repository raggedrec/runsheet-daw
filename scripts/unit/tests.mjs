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
import { laneName, tempoOf } from "./bundle.mjs";
import { sanitizeLook, laneColorFor, LANE_HEIGHT, DEFAULT_LOOK } from "./bundle.mjs";
import { encodeWav } from "./bundle.mjs";

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

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
