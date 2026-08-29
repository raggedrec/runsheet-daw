# Run Sheet DAW — working notes

A browser DAW for Ragged Company Recordings. Opens one song from Run Sheet,
plays its stems, records against them, and saves takes back to Idea Drop.
Built on openDAW's engine; the interface is ours.

Read `docs/checkpoint.md` before starting. It records what works, what doesn't,
and why — including several days of findings that are expensive to rediscover.

## Commands

```
npm run dev      # localhost, with the COOP/COEP headers openDAW needs
npm test         # 68 assertions, no browser, ~1 second
npm run build    # tsc -b && vite build
```

Run `npm test` before every commit. It won't catch engine bugs — those live in
openDAW's async behaviour — but it catches the arithmetic, the encoders and the
parsers, and it has caught real mistakes three times.

**Never `npm install` from a Linux sandbox into this folder.** Native binaries
(rolldown, tsc, oxlint) are platform-specific and it breaks the build. Install
and build on the Mac.

## openDAW: the traps

These each cost hours. The full list is in `docs/checkpoint.md`; these are the
ones most likely to bite again.

1. **openDAW hands back control long before it is done.** `Project.startRecording`
   fires an async function with `.finally()` and returns immediately. Three
   separate bugs came from assuming a returned call had finished. Wait for
   observable state, not for the return.
2. **Transaction boundaries cut both ways.** Box *writes* must be inside
   `project.editing.modify()`. `CaptureDevices` lookups must be *outside* it,
   because its box-graph subscribers haven't run yet.
3. **`editing.modify()` is synchronous.** Do async work before it, in a prepare
   pass, and apply the results inside.
4. **`startAudioWorklet()` connects the worklet itself.** Don't connect it again
   — that sums the engine with itself, +6 dB.
5. **`engine.play()` alone produces silence.** Set a position first, even the
   one the playhead already occupies.
6. **`engine.position` does not advance** in this build. `useTransport` anchors
   on what the engine reports and interpolates between reports.
7. **Never use `constructor.name`** for device or box names. It works in dev and
   returns a single minified letter in production. Use openDAW's static
   `ClassName`, which is a string and survives.

## Conventions

**One source of truth, always.** Two bugs this week came from the same shape of
mistake: something computed in two places that should have been derived from
one. The mix lives in openDAW's boxes and nowhere else — React holds no copy,
`revision` only tells it to re-read. The transport lives in `useTransport` and
nothing else touches the engine's playback. In the timeline, the frame range and
the pixel range come from the same two numbers.

**Comments explain why, not what.** The code says what it does. A comment earns
its place by recording a decision, a constraint, or a trap — especially one that
cost something to learn. Don't narrate.

**Say what's not done.** If something is half-built, the commit message and the
UI should both say so. A control that looks live and does nothing is worse than
no control. `docs/checkpoint.md` has a "doesn't work" section; keep it honest.

**Prefer failing loudly.** Errors carry what the engine actually reported, not a
guess. The engine log panel exists because six fixes were shipped without
reading openDAW's console output, all of them wrong.

## Licensing — resolved: this app is AGPL by choice

Confirmed from `node_modules/@opendaw/*/package.json`: every `@opendaw/*`
package declares **LGPL-3.0-or-later** (nam-wasm is MIT). The AGPL applies to
the openDAW *studio app*, not the SDK. The LGPL did **not** force AGPL on this
app — keeping it private inside Run Sheet was legally open — but Ragged Company
Recordings has **chosen to license this app AGPL-3.0-or-later** and stay there.

Because it's AGPL, **§13 is only discharged by a running source link.** The
footer in `src/DawApp.tsx` links to the public repo at
`github.com/raggedrec/runsheet-daw` (verified public). If that repo goes
private or moves, update the footer link or the app is out of compliance the
moment it is network-reachable — a Vercel preview counts.

- `lucide-react` (ISC) and `fontaudio` (MIT) — safe, no constraints.
- GridSound, Ardour (GPLv2), Tracktion (GPLv3) — reference only. Copying any of
  it forecloses ever taking this app closed-source again.

## Related

- **RCR-TRACKER** — Run Sheet itself, private. Links here via the DAW button in
  the song detail panel, sharing a session cookie on the parent domain.
- `docs/ui-target.md` — the layout target, from Shayne's mockup.
- `docs/checkpoint.md` — current state. Read first, update when it changes.
