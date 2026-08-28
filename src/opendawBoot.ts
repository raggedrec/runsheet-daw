/**
 * Bringing the openDAW engine up.
 *
 * The order matters and none of it is optional. Each step was read out of the
 * installed type definitions rather than recalled:
 *
 *   Workers.install(url)                — @opendaw/studio-core/workers-main.js
 *   AudioWorklets.install(url)          — @opendaw/studio-core/processors.js
 *   WasmEngine.install({...})           — the prebuilt Rust engine
 *   WasmEngine.ensureReady(context)     — falls back to TypeScript if false
 *   AudioWorklets.createFor(context)    — async, one per context
 *   Project.new(env)                    — env needs six things, see ProjectEnv
 *   audioWorklets.createEngine({project}) -> EngineWorklet
 *   engine.setWorklet(worklet)          — EngineFacade is the public handle
 *
 * The asset URLs come from the package via Vite's `?url`, so a version bump
 * can't silently leave stale copies behind in `public/`.
 *
 * Nothing here touches Supabase. Booting the engine and loading a song are
 * separate concerns and separate failures.
 */
import { Workers, AudioWorklets, EngineFacade } from "@opendaw/studio-core";
import { WasmEngine } from "@opendaw/studio-core-wasm";

import workersMainUrl from "@opendaw/studio-core/workers-main.js?url";
import processorsUrl from "@opendaw/studio-core/processors.js?url";
import wasmProcessorUrl from "@opendaw/studio-core-wasm/wasm-processor.js?url";
import wasmOfflineWorkerUrl from "@opendaw/studio-core-wasm/wasm-offline-worker.js?url";

export interface BootResult {
  audioContext: AudioContext;
  audioWorklets: AudioWorklets;
  engine: EngineFacade;
  /** False when the Rust engine couldn't start and TypeScript is running. */
  wasm: boolean;
  sampleRate: number;
}

export class BootError extends Error {
  constructor(
    message: string,
    /** What the user can actually do about it, if anything. */
    readonly remedy: string,
  ) {
    super(message);
    this.name = "BootError";
  }
}

/**
 * The one check worth making before anything else.
 *
 * Without cross-origin isolation there is no SharedArrayBuffer, and the engine
 * cannot start at all. Failing here with a clear message beats failing four
 * steps later inside a worklet.
 */
export function checkIsolation(): void {
  if (!self.crossOriginIsolated) {
    throw new BootError(
      "This page is not cross-origin isolated.",
      "The server must send Cross-Origin-Opener-Policy: same-origin and " +
        "Cross-Origin-Embedder-Policy: require-corp. In production that's " +
        "vercel.json; in dev it's the headers block in vite.config.ts.",
    );
  }
  if (typeof SharedArrayBuffer === "undefined") {
    throw new BootError(
      "SharedArrayBuffer is unavailable.",
      "The isolation headers are set but the browser still isn't granting it.",
    );
  }
}

let booted: Promise<BootResult> | null = null;

/** Boots once and reuses it — the worklets and workers are process-wide. */
export function boot(): Promise<BootResult> {
  booted ??= bootOnce();
  return booted;
}

async function bootOnce(): Promise<BootResult> {
  checkIsolation();

  await Workers.install(workersMainUrl);
  AudioWorklets.install(processorsUrl);

  /*
   * wasmUrl is a directory, not a file: the engine fetches engine.wasm and
   * plugins/*.wasm beneath it at runtime.
   *
   * That means the bundler never sees them, so they have to be served as
   * static files. scripts/sync-wasm.mjs copies them from the package into
   * public/opendaw-wasm before every dev run and build — deriving the URL from
   * the processor's bundled path instead gives a directory that doesn't exist
   * in dist, and the app then builds cleanly and 404s at boot.
   */
  WasmEngine.install({
    processorUrl: wasmProcessorUrl,
    offlineWorkerUrl: wasmOfflineWorkerUrl,
    wasmUrl: `${import.meta.env.BASE_URL}opendaw-wasm/wasm`,
  });

  const audioContext = new AudioContext();
  // Browsers start contexts suspended until a gesture; the caller resumes.
  const wasm = await WasmEngine.ensureReady(audioContext);

  const audioWorklets = await AudioWorklets.createFor(audioContext);
  const engine = new EngineFacade();

  return {
    audioContext,
    audioWorklets,
    engine,
    wasm,
    sampleRate: audioContext.sampleRate,
  };
}
