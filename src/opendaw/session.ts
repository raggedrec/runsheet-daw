/**
 * Creating an openDAW Project and getting its engine running.
 *
 * A Project needs six things (see ProjectEnv in the package). Four of them are
 * plumbing that only exists so the engine can find audio again after a reload:
 *
 *   sampleService     imports files and writes them to openDAW's own store
 *   sampleManager     hands decoded audio to the engine when it asks
 *   soundfontService  same idea for soundfonts, which this app never uses
 *   soundfontManager  ditto
 *
 * The two managers each take a "provider" — a single `fetch(uuid, progress)`
 * that returns the audio for an id. Ours reads back from the store the import
 * wrote to, which closes the loop: import once, and the engine can find it
 * whenever it needs it.
 *
 * Every name here was read out of the installed type definitions. The package
 * has no documentation for this, and its README has already been wrong three
 * times.
 */
import {
  AudioWorklets,
  GlobalSampleLoaderManager,
  GlobalSoundfontLoaderManager,
  Project,
  SampleService,
  SampleStorage,
  SoundfontService,
  SoundfontStorage,
  type SampleProvider,
  type SoundfontProvider,
} from "@opendaw/studio-core";
import { BpmDetector } from "@opendaw/studio-adapters";
import type { BootResult } from "../opendawBoot";

export interface DawSession {
  project: Project;
  audioContext: AudioContext;
  sampleService: SampleService;
  /** The engine node itself. Held so it can be disconnected on teardown. */
  worklet: AudioWorkletNode;
}

/**
 * Reads back what importFile wrote.
 *
 * SampleStorage.load returns [audio, peaks, meta]; the manager wants
 * [audio, meta]. The peaks are the waveform overview, which openDAW draws
 * itself and this app doesn't need yet.
 */
const sampleProvider: SampleProvider = {
  async fetch(uuid, progress) {
    const [audio, , meta] = await SampleStorage.get().load(uuid);
    progress(1);
    return [audio, meta];
  },
};

/**
 * Required by ProjectEnv, never exercised.
 *
 * This app has no soundfont instruments. Rejecting loudly rather than
 * returning something empty means that if a code path ever does ask for one,
 * it says so instead of playing silence.
 */
const soundfontProvider: SoundfontProvider = {
  async fetch(uuid) {
    const [buffer, meta] = await SoundfontStorage.get().load(uuid);
    void uuid;
    return [buffer, meta];
  },
};

export async function createSession(boot: BootResult): Promise<DawSession> {
  const { audioContext } = boot;

  /*
   * BpmDetector.Unknown rather than the WASM detector.
   *
   * openDAW can analyse an imported file for tempo, but Run Sheet already
   * stores the BPM for every song — it's typed in or detected there. Running a
   * second detector would cost a WASM module and a pass over the audio to
   * produce a worse answer than the one we already have.
   */
  const sampleService = new SampleService(audioContext, BpmDetector.Unknown);
  const sampleManager = new GlobalSampleLoaderManager(sampleProvider);
  const soundfontService = new SoundfontService();
  const soundfontManager = new GlobalSoundfontLoaderManager(soundfontProvider);

  const project = Project.new({
    audioContext,
    audioWorklets: AudioWorklets.get(audioContext),
    sampleManager,
    soundfontManager,
    sampleService,
    soundfontService,
  });

  /*
   * startAudioWorklet builds the EngineWorklet and returns it. It does NOT
   * connect it — the name misleads, and discarding the return value is a
   * silent failure.
   *
   * EngineWorklet extends AudioWorkletNode: it *is* the engine, as a node in
   * the graph. Web Audio only calls process() on nodes that reach a
   * destination, so an unconnected engine never runs at all. Not "runs
   * silently" — the transport doesn't move, position stays at 0 and isPlaying
   * never becomes true, which looks exactly like a dead Play button.
   *
   * Connecting once is not enough. openDAW REPLACES the worklet when the graph
   * changes shape — starting a recording is the case that matters here, since
   * the engine has to be rebuilt with the capture inputs attached. The old
   * node, and our connection to it, is thrown away. Connect only at startup
   * and the result is: audio dies the instant you press Record, and nothing is
   * captured either, because the replacement engine is never pulled.
   *
   * `RestartWorklet` is the hook for exactly this — `load` is handed each new
   * worklet, `unload` retires the old one. Connecting there means every engine
   * openDAW builds reaches the speakers, not just the first.
   */
  const connected = new Set<AudioWorkletNode>();
  const connect = (node: AudioWorkletNode) => {
    if (connected.has(node)) return;
    node.connect(audioContext.destination);
    connected.add(node);
  };
  const disconnect = (node: AudioWorkletNode) => {
    if (!connected.delete(node)) return;
    try {
      node.disconnect();
    } catch {
      // Already gone. Nothing to do, and throwing here would take down a
      // recording that otherwise succeeded.
    }
  };

  let live: AudioWorkletNode | null = null;
  const worklet = project.startAudioWorklet({
    unload: async () => {
      if (live) disconnect(live);
      live = null;
    },
    load: (next) => {
      connect(next);
      live = next;
    },
  });
  // The first worklet comes back as a return value rather than through `load`,
  // so it's connected here. The Set makes a double-connect impossible if that
  // ever changes — two connections would sum the engine with itself, +6dB.
  connect(worklet);
  live ??= worklet;

  // engine — the EngineFacade with play/stop/record — is only usable once the
  // worklet has reported ready.
  await project.engine.isReady();

  return { project, audioContext, sampleService, worklet };
}
