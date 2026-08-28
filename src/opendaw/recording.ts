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
  if (deviceId !== null && capture instanceof CaptureAudio) {
    capture.deviceId.setValue(Option.wrap(deviceId));
  }
  project.captureDevices.setArm(capture, true);
}

export function disarmAll(project: Project): void {
  for (const capture of project.captureDevices.filterArmed()) {
    capture.armed.setValue(false);
  }
}

/**
 * Rolls the transport and records every armed input.
 *
 * `prepareRecording` opens the media stream and has to complete first — start
 * the transport before the stream is live and the take begins with a hole
 * exactly as long as the device took to open.
 */
export async function startRecording(project: Project, countIn: boolean): Promise<void> {
  const armed = project.captureDevices.filterArmed();
  if (armed.length === 0) {
    throw new RecordingError(
      "Nothing is armed.",
      "Add a track, choose an input and arm it before recording.",
    );
  }
  await Promise.all(armed.map((capture) => capture.prepareRecording()));
  project.startRecording(countIn);
}

export function stopRecording(project: Project): void {
  project.stopRecording();
}
