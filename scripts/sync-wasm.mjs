/**
 * Copies openDAW's prebuilt WASM binaries into public/ so the build serves them.
 *
 * The engine fetches engine.wasm and plugins/*.wasm at runtime from a directory
 * URL, not through an import — so the bundler never sees them and never emits
 * them. Without this the app builds cleanly and then fails at boot with a 404,
 * which is a bad way to find out.
 *
 * Copied rather than committed: they're 1.7MB of build output belonging to a
 * dependency, and committing them means a version bump silently leaves stale
 * binaries behind. public/opendaw-wasm is gitignored for the same reason.
 *
 * Runs from `predev` and `prebuild`, so it can't be forgotten.
 */
import { cp, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const from = "node_modules/@opendaw/studio-core-wasm/dist/wasm";
const to = "public/opendaw-wasm/wasm";

if (!existsSync(from)) {
  console.error(`✗ ${from} not found — is @opendaw/studio-core-wasm installed?`);
  process.exit(1);
}

await rm("public/opendaw-wasm", { recursive: true, force: true });
await mkdir("public/opendaw-wasm", { recursive: true });
await cp(from, to, { recursive: true });

console.log(`✓ WASM binaries synced to ${to}`);
