# Run Sheet DAW

Recording and playback for [Run Sheet](https://raggedcompanyrecordings.com),
built on the [openDAW SDK](https://opendaw.org).

Separate from Run Sheet on purpose, for two reasons that happen to point the
same way: openDAW is AGPL, so keeping it in its own app means only this app is
publishable; and it needs `SharedArrayBuffer`, which needs cross-origin
isolation, which would break every Supabase signed URL if applied to Run
Sheet's origin.

## Running it

```bash
npm install
cp .env.example .env
npm run dev
```

Then fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`.
Leave `VITE_SESSION_COOKIE_DOMAIN` blank for local development — a cookie
scoped to a parent domain can't be shared from localhost anyway, so the client
falls back to localStorage.

### If `npm run dev` fails with "Cannot find native binding"

Vite 8 uses rolldown, which is a compiled binary and platform-specific. If
`node_modules` was populated on a different operating system — a container, a
CI runner, or a shared drive written to by another machine — the binding for
*this* machine won't be there.

```bash
rm -rf node_modules package-lock.json
npm install
```

Install on the machine you intend to run on.

The dev server sets `Cross-Origin-Opener-Policy` and
`Cross-Origin-Embedder-Policy` itself — without them the engine cannot start.
`vercel.json` does the same in production.

`npm run dev` and `npm run build` both sync openDAW's prebuilt WASM binaries
into `public/opendaw-wasm` first. They're fetched at runtime rather than
imported, so the bundler never sees them; skip that step and the app builds
cleanly and then 404s at boot.

## What's here

Phase 1: the engine boots and reports what came up — isolation, workers,
worklets, Rust engine or TypeScript fallback, sample rate — plus whether the
session arrived from Run Sheet.

No timeline, no recording, no saving yet. Those are Phases 3 to 5.

## Secrets

The anon key belongs here and is safe to publish; row level security is what
protects the data. The service role key must never appear in this repository —
it bypasses RLS entirely.

## Licence

GNU AGPL v3 or later. See `NOTICE`, and `LICENSE` once added.

## Keeping `npm audit` meaningful

openDAW pulls in a large transitive tree — 105 packages before this app has a
user interface. Some of it is server-side code that a browser never runs:
`@opendaw/studio-core` depends on `y-websocket`, which depends on `y-leveldb`,
which depends on `leveldown`, a native LevelDB binding for Node.

None of that reaches the browser. Checked against a production build:
`leveldown`, `y-leveldb`, `y-websocket` and `abstract-leveldown` appear zero
times in the bundle. Vite tree-shakes them; only Yjs's in-memory document is
actually used. A vulnerability in any of them is a vulnerability in code your
users never download.

So there are two different questions, and one script each:

```bash
npm run audit:ship    # what actually ships — this one matters
npm run audit:all     # everything, including build tooling
```

`audit:ship` passes `--omit=dev`, which drops Vite, TypeScript, oxlint and
their trees. What's left is what a browser executes. Fix those.

For `audit:all`, judgement applies. A denial-of-service in a bundler that runs
on your own machine against your own source is not the same as one in a library
handling untrusted input in production.

**Don't approve install scripts you don't need.** npm will offer to run
`leveldown`'s `node-gyp-build`. It compiles a native binding for a Node
database this app never loads. Declining costs nothing.

**When a real finding does appear** in a transitive dependency and the
maintainer hasn't released a fix, `overrides` in `package.json` forces a
patched version:

```json
"overrides": { "some-package": "^1.2.3" }
```

Use it deliberately and leave a comment saying why — an override that outlives
its reason silently pins you to an old version.
