# Run Sheet DAW — checkpoint, 29 Aug 2026 (handed to Claude Code)

Written so the next session doesn't rediscover any of this. Read this before touching audio.

## Works

- Engine boots (WASM, cross-origin isolated), loads a song's stems, plays them.
- Timeline: waveform lanes from openDAW peaks, bar ruler, playhead, click-drag scrub.
- Tracks column beside the timeline: name, M, S, R. Click the name to select a track.
- Mixer: vertical strips + master, fader / pan / mute / solo, writing straight to boxes.
- Status bar: sample rate, CPU from `engine.cpuLoad`, position.
- Light/dark skins, accent, lane height — persisted per browser.
- Sample cache: second open of a song does no network and no decoding.
- Session save (`Project.toArrayBuffer()` → Supabase storage).
- Effects: add and remove openDAW devices per track, and edit every parameter.
  Generic panel driven by each adapter's `namedParameter`, with values printed
  by openDAW's own `getPrintValue()` so a synced delay reads "1/8" not 0.25.
- Mixer and devices share one panel; the track list on the left toggles between
  them.
- Timeline horizontal zoom (powers of two), shift-wheel to scroll.
- Track names editable by double-click; writes to openDAW's label too.
- Idea Drop browser, grouped by role.
- `npm test` — 68 assertions, no browser, ~1s.
- `npm run dev` works locally; the dev server sets the COOP/COEP headers openDAW needs.

## Doesn't work / not built

- **RECORDING.** Still the open problem. See below.
- **Session reload — wired, RUNTIME-UNVERIFIED.** The path is built but has never been run
  (localhost can't get past sign-in). `session.ts` now shares one `buildProjectEnv` between
  `createSession` (`Project.new`) and `loadSessionProject` (`Project.loadAnyVersion`, which runs
  version migrations). `lanesFromProject` in `loadSong.ts` reads lanes back out of the graph —
  `rootBoxAdapter.audioUnits.adapters()` → `unit.tracks.values()` → `track.regions.adapters
  .values()` → `region.isAudioRegion()` → `region.file` (`AudioFileBoxAdapter`: `.uuid`,
  `.endInSeconds`, `.peaks`). `DawApp.open` tries the saved session first and falls back to the
  fresh stem load if none exists or it yields no drawable lanes. **Verify the reopen → playback
  loop on the Mac with the engine log before trusting it.**
  - Remaining gap: on a browser that never imported the stems, SampleStorage is empty, so the
    regions have no peaks and `lanesFromProject` skips them (the app then rebuilds from stems).
    Re-importing missing samples on reopen — matching saved region uuids back to Run Sheet files —
    is the next piece.
- **Mixer meters.** `LiveStreamBroadcaster` (lib-fusion) is the SENDING side, in the worklet.
  Reading it needs a receiver plus the address that carries peak data. Not documented, not
  guessed at. Deliberately deferred.
- Mix / stem bounce: `OfflineEngineRenderer` + `ExportConfiguration` (`stems` map per unit with
  `includeAudioEffects`, `includeSends`, `skipChannelStrip`; plus `range`).
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
side builds correctly, and `isRecording` stayed false. The current code therefore plays FIRST,
waits for `isPlaying`, and only then arms — the reverse of four earlier attempts, all of which
armed first and tried to start the transport afterwards.

**New suspect found and fixed (RUNTIME-UNVERIFIED).** `startRecording` called `engine.play()`
directly, without the `engine.setPosition(...)` that `useTransport.play` sets before every Play —
whose own comment says play() "produces silence until something sets a position," and trap #2/#5
below say the same. So the record path was rolling the transport the one way the app already knew
does not take, while the Play button (which sets a position) worked. `recording.ts` now sets the
current position before `play()`. This is the "two places doing one job, the copy forgot a step"
shape again. **Untested — try recording and read the engine log; if isRecording still stays false,
this wasn't it and the count-in path is next.**

**The engine log panel in the app is the tool for this.** It captures openDAW's console output
and unhandled rejections. Six fixes were shipped before it existed, all guesses, all wrong.
Do not debug this without reading it.

## Still to build, in the order I'd do it

1. Test recording. Everything else is improvement; this is foundation.
2. Session reload (see above) — saving works, loading doesn't, so a saved mix
   currently cannot come back.
3. Timeline markers with editable text. Needs `MarkerBox` / `MarkerTrack`, so
   they survive a reload — markers that vanish would be worse than none.
4. Mixer meters (see above).
5. Mix and stem bounce to Idea Drop.

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

**Resolved.** Confirmed from `node_modules/@opendaw/*/package.json`: every `@opendaw/*` package
declares **LGPL-3.0-or-later** (nam-wasm is MIT). The AGPL applies to the openDAW *studio app*,
not the SDK, so LGPL did not force AGPL here — but this app is licensed **AGPL-3.0-or-later by
choice**. §13 is discharged by the footer source link in `src/DawApp.tsx` pointing at the public
repo `github.com/raggedrec/runsheet-daw` (verified public, HTTP 200). Keep that link valid or the
app is out of compliance the moment it is network-reachable.

- `lucide-react` — ISC. In use. No constraints.
- `fontaudio` — MIT. Safe if wanted for audio-specific glyphs.
- GridSound, Ardour (GPLv2), Tracktion Engine (GPLv3/commercial) — reference only. Copying any
  of it permanently forecloses the option above.
- The Figma "DAW Studio Recording UI Pack" — Community licence unchecked. Layout ideas only.

## Two bugs, one shape — worth remembering

Both came from something being computed in two places that should have been
derived from one:

- The transport had a React flag, an AudioContext clock and the engine's
  observables all with an opinion about whether the song was moving. The clock
  ticked convincingly over a stopped engine and hid a broken record path for
  most of a day. Fixed by `useTransport` owning it.
- The timeline passed PeaksPainter the visible slice as audio frames but the
  whole file's width as pixels. It stretched eight seconds across four minutes,
  which looks right at scroll 0 and wrong everywhere else. Fixed by deriving
  both ranges from the same two numbers.

When something looks right in one state and wrong in another, suspect two
sources before suspecting the library.

## Design decisions worth not re-litigating

- Takes are **16-bit WAV**, not MP3: a take is the master everything else derives from. Costs
  ~10 MB per stereo minute. The status bar says so rather than claiming 24-bit.
- Lane colours are by **role**, not position, so a session looks the same each time it opens.
- Arming is **exclusive** and lives on the track. The input device is chosen once, in the
  transport.
- The mix lives in openDAW's boxes and nowhere else. React holds no second copy.
- `docs/ui-target.md` holds the layout target from Shayne's mockup.
- Musical keys are never uppercased: Cm is not CM, Bb is not BB. `formatKey`
  in `src/naming.ts`, with tests.
- Device parameters are a generic list rather than twenty bespoke device UIs.
  A threshold you can move and hear beats a graphic you can't.

## Outstanding elsewhere

- `SUPABASE_SERVICE_ROLE_KEY` still un-rotated in RCR-TRACKER history. Bypasses RLS.
  Highest-value item on any list.
- Run Sheet's session-cookie migration didn't fire on deploy; artists were signed out once.
  Cause unknown, `scripts/session-test/unit.mjs` passes regardless.
