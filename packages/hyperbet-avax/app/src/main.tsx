import { mountHyperbetApp } from "@hyperbet/ui";
import { applyStoredHyperbetTheme } from "@hyperbet/ui/lib/theme";

import "./styles.css";
import AppRoot from "./AppRoot";

applyStoredHyperbetTheme({ themeId: "avax", storageKey: "avax-theme" });
mountHyperbetApp(document.getElementById("root")!, AppRoot);
