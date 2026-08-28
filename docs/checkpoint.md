# Run Sheet DAW — checkpoint, 28 Aug 2026

Written to stop the next session re-deriving what this one learned the hard way.

## What works

- Engine boots, WASM, cross-origin isolation OK.
- Loads a Run Sheet song's stems as lanes, plays them.
- Timeline: waveform lanes from openDAW peaks, bar ruler, role stripes, click-drag scrub.
- Light/dark skins, accent + lane height, persisted per browser.
- Start screen listing the parts before committing to the download.
- Record: add track → arm → count-in → record. Take reads back, appears as a lane, uploads to Idea Drop as WAV.
- Save session to Supabase storage (`<sceneId>/<songId>/session.odproject`).

## What does NOT work yet

- **Session reload.** `loadSession`/`sessionExists` in `src/session.ts` are written and unused.
  Loading needs lanes derived from the *project* rather than Run Sheet's file list:
  `project.rootBoxAdapter.audioUnits.adapters()` → `.tracks` → `TrackRegions.adapters` →
  region `.file` → AudioFileBox → `address.uuid` → `SampleStorage.get().load(uuid)`.
  Also needs `createSession` refactored to expose its `ProjectEnv` so `Project.load(env, buffer)`
  can be used instead of `Project.new(env)`.
- **Mute / solo / pan / fader.** API confirmed: `AudioUnitBox.volume/panning/mute/solo`,
  with `AudioUnitBoxAdapter.VolumeMapper` (a `ValueMapping<number>`: `.y(unit)→value`, `.x(value)→unit`).
  Timeline already draws inaudible lanes; it takes `muted`/`soloed` sets that are currently always empty.
- **FX inserts.** `project.api.insertEffect(field, factory)`. Devices exist in `@opendaw/studio-boxes`
  (Compressor, Gate, Delay, Reverb, Revamp EQ, Saturator, NeuralAmp, Crusher…). No UI.
- **Mix / stem bounce.** `OfflineEngineRenderer` + `ExportConfiguration` (`stems` map per unit with
  `includeAudioEffects`, `includeSends`, `skipChannelStrip`; plus `range`).
- **Zoom.** Whole song is squeezed to window width. `TimelineRange` in `@opendaw/studio-core/ui` does
  the pixel↔time maths if wanted.
- **Take readback is unverified against a real recording.** The region → sample path in
  `src/opendaw/take.ts` is inferred from type definitions, not observed.

## Traps hit this session — do not repeat

1. **`startAudioWorklet()` does not connect anything.** `EngineWorklet extends AudioWorkletNode`;
   it must be connected to `audioContext.destination` or `process()` never runs — no audio, no
   position, no `isPlaying`. Looks exactly like a dead Play button.
2. **`engine.play()` alone produces silence.** Set a position first, even the current one.
3. **`engine.position` does not advance** in this build. The clock is driven from
   `AudioContext.currentTime`, re-anchored on every transport change (`src/useTransportClock.ts`).
   Root cause never found.
4. **Transaction boundaries cut both ways.**
   - Box *writes* must be inside `project.editing.modify()` or you get
     "Modification only prohibited in transaction mode".
   - `CaptureDevices` lookups must be *outside* it — its box-graph subscribers haven't run yet,
     so asking inside reads as "this track has no input".
5. **`editing.modify()` is synchronous.** Anything async happens before it, in a prepare pass.
6. **`decodeAudioData` detaches its ArrayBuffer** — read `byteLength` before decoding.
7. **Vite dev serves missing files as index.html with a 200**, so `response.ok` passes and HTML
   reaches `WebAssembly.compile`. Check content-type when probing.
8. **Never `npm install` into the mounted drive from Linux** — native binaries (rolldown, tsc,
   oxlint) are platform-specific. Build on the Mac.

## Licensing — unresolved, and it matters

Every `@opendaw/*` package on npm declares **LGPL-3.0-or-later**, not AGPL. The AGPL applies to the
openDAW *studio app* repo, not the SDK. This app was split out and published partly on the belief
that the SDK was AGPL. If LGPL holds, the DAW could live inside Run Sheet privately.
**Read the shipped LICENSE files in `node_modules/@opendaw/*` before acting on this.**

`fontaudio` (icons) is MIT — safe. GridSound is AGPL — reference only, do not copy code, or the
option above closes permanently.

## Outstanding elsewhere

- `SUPABASE_SERVICE_ROLE_KEY` still un-rotated in RCR-TRACKER history. Bypasses RLS. Highest-value item.
- Run Sheet's session-cookie migration didn't fire on deploy; artists were signed out once.
  Cost is paid, cause unknown, `scripts/session-test/unit.mjs` passes regardless.
