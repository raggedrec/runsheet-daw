import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // openDAW needs SharedArrayBuffer, which needs a cross-origin isolated
    // page. Vercel serves these in production via vercel.json; the dev server
    // has to set them itself or nothing works locally.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  // The WASM binaries and worker modules ship inside the package and are
  // fetched at runtime, so they must not be inlined or renamed.
  assetsInclude: ["**/*.wasm"],
});
