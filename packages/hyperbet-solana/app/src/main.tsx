import "@hyperbet/ui/lib/solanaCompat";
import { mountHyperbetApp } from "@hyperbet/ui";

import "./styles.css";
import AppRoot from "./AppRoot";

mountHyperbetApp(document.getElementById("root")!, AppRoot);
