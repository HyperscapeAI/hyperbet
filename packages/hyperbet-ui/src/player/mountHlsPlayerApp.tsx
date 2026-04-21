import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { HlsPlayerApp } from "./HlsPlayerApp";

export function mountHlsPlayerApp(rootElement: HTMLElement): void {
  createRoot(rootElement).render(
    <StrictMode>
      <HlsPlayerApp />
    </StrictMode>,
  );
}
