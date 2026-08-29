/**
 * Recording a take against the song.
 *
 * The shape of this in openDAW:
 *
 *   1. An audio unit exists for every track. Each one owns a `Capture` — the
 *      thing that knows which input device feeds it and whether it's armed.
 *   2. Arming is done through `CaptureDevices.setArm`, not by setting the flag
 *      directly, because arming can be exclusive: arming one input disarms the
 *      others, which is what you want when you have one interface and one pair
 *      of hands.
 *   3. `capture.prepareRecording()` opens the media stream. It is async and
 *      must finish before the transport rolls, or the first bar is silence.
 *   4. `project.startRecording(countIn)` rolls the transport and records every
 *      armed input.
 *
 * The browser will not name audio inputs until permission has been granted —
 * before that, `enumerateDevices` returns entries with empty labels. So the
 * picker asks for permission first and only then lists devices; a dropdown of
 * blank entries is worse than a button that says what it's about to do.
 */
import type { Project } from "@opendaw/studio-core";
import { CaptureAudio } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import { Option } from "@opendaw/lib-std";
import type { Capture } from "@opendaw/studio-core";

export interface InputDevice {
  deviceId: string;
  label: string;
}

export class RecordingError extends Error {
  constructor(message: string, readonly remedy: string) {
    super(message);
    this.name = "RecordingError";
  }
}

/**
 * Asks for microphone permission and lists the inputs.
 *
 * The stream opened here is stopped immediately: its only job is to make the
 * browser reveal device labels. openDAW opens its own stream when recording
 * actually starts, and leaving this one running would light the recording
 * indicator for as long as the tab is open.
 */
export async function listInputs(): Promise<InputDevice[]> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new RecordingError(
      "This browser can't record audio.",
      "Recording needs a secure connection and a browser with microphone support.",
    );
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch (err) {
    throw new RecordingError(
      "No microphone access.",
      err instanceof Error && err.name === "NotAllowedError"
        ? "Permission was declined. Allow the microphone for this site and try again."
        : "No input device was available.",
    );
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "audioinput")
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Input ${i + 1}` }));
}

export interface RecordTrack {
  name: string;
  capture: Capture;
}

/**
 * Adds an empty track to record onto.
 *
 * Tape is openDAW's audio device — the one that plays and records regions
 * rather than synthesising. Creating one with no region gives an empty lane
 * with its own fader, mute and input, which is what "new track" means here.
 *
 * Named by the caller rather than "Audio 1": a take called "Vox 2" is findable
 * in Idea Drop three weeks later and a take called "Audio 1" is not.
 */
export function addRecordTrack(project: Project, name: string): RecordTrack {
  let audioUnitBox: AudioUnitBox | null = null;

  project.editing.modify(() => {
    audioUnitBox = project.api.createInstrument(InstrumentFactories.Tape, { name }).audioUnitBox;
  });

  if (audioUnitBox === null) {
    throw new RecordingError("The track wasn't created.", "Nothing was added to the project.");
  }
  const box: AudioUnitBox = audioUnitBox;

  /*
   * The lookup happens AFTER the transaction, not inside it.
   *
   * CaptureDevices learns about new audio units by subscribing to the box
   * graph, and those subscribers don't run until the transaction commits.
   * Asking inside modify() asks before the capture exists, which reads as
   * "this track has no input" when the truth is "not yet".
   */
  const capture = project.captureDevices.get(box.address.uuid).unwrapOrNull()
    // Fall back to identity rather than id: if the address isn't the key the
    // manager files captures under, the capture itself still knows its unit.
    ?? project.captureDevices.allCaptures().find((c) => c.audioUnitBox === box)
    ?? null;

  if (capture === null) {
    throw new RecordingError(
      "The new track has no input.",
      "openDAW created the track but no capture device came with it.",
    );
  }
  return { name, capture };
}

/**
 * Arms a track and points it at a device.
 *
 * Exclusive by design: arming one input disarms the rest. With one interface
 * and one pair of hands, recording four armed tracks at once is nearly always
 * a mistake rather than an intention.
 */
export function armTrack(project: Project, capture: Capture, deviceId: string | null): void {
  /*
   * Inside a transaction, because both of these write to boxes.
   *
   * `deviceId` and `armed` are fields on the capture's box, and openDAW
   * refuses writes outside editing.modify() — the graph is transactional so
   * that undo, and the subscribers that rebuild the audio worklet, see whole
   * changes rather than half of one. Setting them directly throws
   * "Modification only prohibited in transaction mode".
   */
  project.editing.modify(() => {
    if (deviceId !== null && capture instanceof CaptureAudio) {
      capture.deviceId.setValue(Option.wrap(deviceId));
    }
    project.captureDevices.setArm(capture, true);
  });
}

/**
 * The capture belonging to an audio unit, if it has one.
 *
 * Every track gets one when it is created, which is what makes a per-track
 * arm button possible: arming is a property of the track, not of a single
 * global picker sitting in the header.
 */
export function captureFor(project: Project, unit: AudioUnitBox): Capture | null {
  return (
    project.captureDevices.get(unit.address.uuid).unwrapOrNull() ??
    project.captureDevices.allCaptures().find((c) => c.audioUnitBox === unit) ??
    null
  );
}

export function disarmAll(project: Project): void {
  const armed = project.captureDevices.filterArmed();
  if (armed.length === 0) return;
  // One transaction for all of them — see armTrack.
  project.editing.modify(() => {
    for (const capture of armed) capture.armed.setValue(false);
  });
}

/**
 * Rolls the transport and records every armed input.
 *
 * `prepareRecording` opens the media stream and has to complete first — start
 * the transport before the stream is live and the take begins with a hole
 * exactly as long as the device took to open.
 */
/** What the engine says about itself, for the log and for error messages. */
function engineState(project: Project): string {
  const e = project.engine;
  return JSON.stringify({
    isPlaying: e.isPlaying.getValue(),
    isRecording: e.isRecording.getValue(),
    isCountingIn: e.isCountingIn.getValue(),
    position: e.position.getValue(),
  });
}

/**
 * Engine traces for working out why a take did or didn't roll. They matter
 * while developing against openDAW's transport; they're noise in a shipped
 * app. `import.meta.env.DEV` is a compile-time constant, so the production
 * minifier drops both the call and the engineState() work behind it.
 */
function trace(label: string, project: Project): void {
  if (import.meta.env.DEV) {
    console.debug(label, engineState(project));
  }
}

/**
 * Roll first, then arm.
 *
 * Four attempts got this backwards. Every one of them called
 * project.startRecording() and then tried to start the transport, and every
 * one failed with isRecording stuck false — while the plain Play button
 * worked perfectly on its own.
 *
 * That difference is the clue. play() is not broken; it only fails to take
 * AFTER startRecording. So prepareRecordingState is not a thing you follow
 * with playback — it is a thing you apply to a transport that is already
 * moving. Which is also how a musician thinks about it: the song is playing,
 * you drop into record.
 *
 * So the order here is: start playback, confirm the engine agrees it is
 * playing, and only then arm. Each step reports what the engine actually said,
 * because four rounds of inferring it from behaviour is enough.
 */
export async function startRecording(project: Project, countIn: boolean): Promise<void> {
  const armed = project.captureDevices.filterArmed();
  if (armed.length === 0) {
    throw new RecordingError(
      "Nothing is armed.",
      "Add a track, choose an input and arm it before recording.",
    );
  }

  const { engine } = project;
  trace("[RunSheet] before play:", project);

  // 1. Roll the transport, unless a count-in is meant to start it.
  if (!countIn && !engine.isPlaying.getValue()) {
    /*
     * Position before play — the same invariant useTransport.play relies on:
     * engine.play() on its own rolls the transport but produces silence, and
     * in this build can fail to take at all, until a position is set. Re-setting
     * the one the engine already holds costs nothing. This path called play()
     * without it, which is the plainest suspect for isRecording staying false
     * while the Play button worked: the button set a position, this did not.
     */
    engine.setPosition(engine.position.getValue());
    engine.play();
    const playBy = Date.now() + 2000;
    while (Date.now() < playBy && !engine.isPlaying.getValue()) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    if (!engine.isPlaying.getValue()) {
      throw new RecordingError(
        "The transport wouldn't start.",
        `Play was called and the engine stayed stopped. State: ${engineState(project)}`,
      );
    }
  }
  trace("[RunSheet] after play:", project);

  // 2. Arm, into a transport that is already moving.
  project.startRecording(countIn);

  const armBy = Date.now() + 4000;
  while (Date.now() < armBy) {
    if (engine.isRecording.getValue() || engine.isCountingIn.getValue()) {
      trace("[RunSheet] recording:", project);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new RecordingError(
    "The engine never entered record.",
    `The transport was rolling when record was armed. State: ${engineState(project)}`,
  );
}

/**
 * Stops, and waits until the take actually exists.
 *
 * This is the bit that was producing "Nothing was recorded" on perfectly good
 * takes. `stopRecording()` only asks the engine to stop. openDAW finalises the
 * recording later, from a subscriber on `isRecording`/`isCountingIn`, inside
 * its own `editing.modify()` — and only then do the regions appear. Reading
 * `recordedRegions()` on the line after stop asks before any of that has
 * happened, every time.
 *
 * Polling rather than subscribing because the finalise runs in another
 * subscriber to the same observable, and subscriber order isn't ours to
 * control — waiting for the flag would still be a race. The regions appearing
 * is the thing we actually care about, so that's what's waited for.
 */
export async function stopRecording(project: Project, capture: Capture): Promise<void> {
  project.stopRecording();

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 60));
    if (project.isRecording()) continue;
    if (capture.recordedRegions().length > 0) return;
  }
  // Falls through on a genuinely empty take. The caller reports that; five
  // seconds is long enough that a slow finalise isn't mistaken for silence.
}
