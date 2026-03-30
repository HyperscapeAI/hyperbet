import { mountHyperbetApp } from "@hyperbet/ui/mount";
import { applyStoredHyperbetTheme } from "@hyperbet/ui/lib/theme";

import "./styles.css";
import AppRoot from "./AppRoot";

applyStoredHyperbetTheme({ themeId: "evm", storageKey: "hyperbet-evm-theme" });
mountHyperbetApp(document.getElementById("root")!, AppRoot);
