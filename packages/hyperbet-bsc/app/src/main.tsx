import { mountHyperbetApp } from "@hyperbet/ui";
import { applyStoredHyperbetTheme } from "@hyperbet/ui/lib/theme";
import AppRoot from "./AppRoot";

applyStoredHyperbetTheme({ themeId: "bsc", storageKey: "bsc-theme" });
mountHyperbetApp(document.getElementById("root")!, AppRoot);
