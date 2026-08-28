import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import DawApp from "./DawApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DawApp />
  </StrictMode>,
);
