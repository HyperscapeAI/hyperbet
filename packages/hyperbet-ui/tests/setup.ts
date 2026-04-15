import { afterEach } from "bun:test";
import { cleanupRenderedTrees } from "./render";

import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

window.matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => { },
  removeListener: () => { },
  addEventListener: () => { },
  removeEventListener: () => { },
  dispatchEvent: () => false,
} as MediaQueryList);

window.HTMLElement.prototype.scrollIntoView = () => { };

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanupRenderedTrees();
  window.document.body.innerHTML = "";
});
