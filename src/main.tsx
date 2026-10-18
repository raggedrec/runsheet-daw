import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted fonts (see theme.ts). The page is cross-origin isolated
// (COEP require-corp), so webfonts can't come from a CDN — @fontsource bundles
// them same-origin. Only the weights the UI actually uses.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import DawApp from "./DawApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DawApp />
  </StrictMode>,
);
