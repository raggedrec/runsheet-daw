# Run Sheet DAW — checkpoint, 29 Aug 2026

Written so the next session doesn't rediscover any of this. Read this before touching audio.

## Works

- Engine boots (WASM, cross-origin isolated), loads a song's stems, plays them.
- Timeline: waveform lanes from openDAW peaks, bar ruler, playhead, click-drag scrub.
- Tracks column beside the timeline: name, M, S, R. Click the name to select a track.
- Mixer: vertical strips + master, fader / pan / mute / solo, writing straight to boxes.
- Effects rack: add and remove openDAW devices on the selected track (no parameter editing).
- Idea Drop browser, grouped by role.
- Status bar: sample rate, CPU from `engine.cpuLoad`, position.
- Light/dark skins, accent, lane height — persisted per browser.
- Sample cache: second open of a song does no network and no decoding.
- Session save (`Project.toArrayBuffer()` → Supabase storage).
- `npm test` — 52 assertions, no browser, ~1s.
- `npm run dev` works locally; the dev server sets the COOP/COEP headers openDAW needs.

## Doesn't work / not built

- **RECORDING.** Still the open problem. See below.
- **Session reload.** `loadSession` / `sessionExists` exist in `src/session.ts` and are unused.
  Needs `createSession` refactored to expose its `ProjectEnv` for `Project.load(env, buffer)`,
  and lanes derived from the project rather than Run Sheet's file list:
  `project.rootBoxAdapter.audioUnits.adapters()` → `.tracks` → `TrackRegions.adapters` →
  region `.file` → AudioFileBox → `address.uuid` → `SampleStorage.get().load(uuid)`.
- **Mixer meters.** `LiveStreamBroadcaster` (lib-fusion) is the SENDING side, in the worklet.
  Reading it needs a receiver plus the address that carries peak data. Not documented, not
  guessed at. Deliberately deferred.
- Mix / stem bounce: `OfflineEngineRenderer` + `ExportConfiguration` (`stems` map per unit with
  `includeAudioEffects`, `includeSends`, `skipChannelStrip`; plus `range`).
- Zoom. The whole song is squeezed to the window width. `TimelineRange` in studio-core/ui does
  the pixel↔time maths.
- Sign-in inside the DAW. On localhost there is no shared cookie domain, so the DAW can't see
  the Run Sheet session — this is what blocks local testing of anything past the start screen.

## Recording: what is known, from source not inference

`Recording.start` (studio-core/dist/capture/Recording.js) does, in order:
1. `await` `prepareRecording()` on every armed capture
2. `clearRecordedRegions()` on each
3. `capture.startRecording()` on each — this is what logs `[RecordAudio] start`
4. `engine.prepareRecordingState(countIn)` — ARMS. Does not start the transport.
5. finalises later, from a subscriber on `isRecording`/`isCountingIn`, inside its own
   `editing.modify()`. Regions do not exist until that runs.

`Project.startRecording` calls `Recording.start(...).finally()` — fire and forget. It returns
long before any of the above has happened.

Last known state: `[RecordAudio] start` is reached with a clean latency report, so the capture
side builds correctly. `isRecording` stays false. Current code plays first, confirms
`isPlaying`, then arms — untested at time of writing.

**The engine log panel in the app is the tool for this.** It captures openDAW's console output
and unhandled rejections. Six fixes were shipped before it existed, all guesses, all wrong.
Do not debug this without reading it.

## Traps — every one of these cost hours

1. **`startAudioWorklet()` connects the worklet itself.** Do not connect it again; that sums the
   engine with itself, +6 dB.
2. **`engine.play()` alone produces silence.** Set a position first, even the current one.
3. **`engine.position` does not advance** in this build. `useTransport` anchors on what the
   engine reports and interpolates with the AudioContext clock between reports. Interpolation
   only runs while the engine says something is moving — never invent motion.
4. **Transaction boundaries cut both ways.** Box *writes* must be inside `editing.modify()`.
   `CaptureDevices` lookups must be *outside* it — its box-graph subscribers haven't run yet.
5. **`editing.modify()` is synchronous.** Async work happens before it, in a prepare pass.
6. **openDAW hands back control long before it is done.** Three separate bugs came from
   assuming a returned call had finished. Wait for observable state, not for the return.
7. **`RestartWorklet` is crash recovery**, invoked only from `error`/`processorerror`. Not a
   graph-change hook.
8. **`decodeAudioData` detaches its ArrayBuffer** — read `byteLength` before decoding.
9. **Vite dev serves missing files as index.html with 200** — check content-type when probing.
10. **Never `npm install` into the mounted drive from the Linux sandbox.** Native binaries
    (rolldown, tsc, oxlint) are platform-specific. Build on the Mac.

## Licensing

Every `@opendaw/*` package on npm declares **LGPL-3.0-or-later**, not AGPL. The AGPL applies to
the openDAW *studio app* repo, not the SDK. This app was split out and published partly on the
belief the SDK was AGPL. **Read the shipped LICENSE files in `node_modules/@opendaw/*` before
acting on it** — if LGPL holds, the DAW could live inside Run Sheet privately.

- `lucide-react` — ISC. In use. No constraints.
- `fontaudio` — MIT. Safe if wanted for audio-specific glyphs.
- GridSound, Ardour (GPLv2), Tracktion Engine (GPLv3/commercial) — reference only. Copying any
  of it permanently forecloses the option above.
- The Figma "DAW Studio Recording UI Pack" — Community licence unchecked. Layout ideas only.

## Design decisions worth not re-litigating

- Takes are **16-bit WAV**, not MP3: a take is the master everything else derives from. Costs
  ~10 MB per stereo minute. The status bar says so rather than claiming 24-bit.
- Lane colours are by **role**, not position, so a session looks the same each time it opens.
- Arming is **exclusive** and lives on the track. The input device is chosen once, in the
  transport.
- The mix lives in openDAW's boxes and nowhere else. React holds no second copy.
- `docs/ui-target.md` holds the layout target from Shayne's mockup.

## Outstanding elsewhere

- `SUPABASE_SERVICE_ROLE_KEY` still un-rotated in RCR-TRACKER history. Bypasses RLS.
  Highest-value item on any list.
- Run Sheet's session-cookie migration didn't fire on deploy; artists were signed out once.
  Cause unknown, `scripts/session-test/unit.mjs` passes regardless.
