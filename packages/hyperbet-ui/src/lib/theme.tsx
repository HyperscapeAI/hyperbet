import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export type HyperbetAppearance = "dark" | "light";
export type HyperbetThemeId = "evm" | "avax" | "bsc" | "base" | "solana";
type ThemeCssVariables = CSSProperties & Record<`--${string}`, string>;

export const DEFAULT_HYPERBET_APPEARANCE: HyperbetAppearance = "dark";
export const DEFAULT_HYPERBET_THEME_ID: HyperbetThemeId = "evm";
export const DEFAULT_HYPERBET_THEME_STORAGE_KEY = "hyperbet-ui-theme";

type HyperbetThemeDefinition = {
  accentColor: string;
  accentColorForeground: string;
  chainLabel: string;
  colorVariables: ThemeCssVariables;
};

const COMMON_COLOR_VARIABLES: ThemeCssVariables = {
  "--hm-black": "#000000",
  "--hm-text-primary": "#ffffff",
  "--hm-text-strong": "rgba(255,255,255,0.85)",
  "--hm-text-secondary": "rgba(255,255,255,0.72)",
  "--hm-text-soft": "rgba(255,255,255,0.62)",
  "--hm-text-muted": "rgba(255,255,255,0.5)",
  "--hm-text-faint": "rgba(255,255,255,0.35)",
  "--hm-border-subtle": "rgba(255,255,255,0.06)",
  "--hm-border-soft": "rgba(255,255,255,0.08)",
  "--hm-border-light": "rgba(255,255,255,0.12)",
  "--hm-border-strong": "rgba(255,255,255,0.2)",
  "--hm-surface-soft": "rgba(255,255,255,0.02)",
  "--hm-surface-glass": "rgba(255,255,255,0.03)",
  "--hm-surface-hover": "rgba(255,255,255,0.05)",
  "--hm-surface-panel": "rgba(0,0,0,0.3)",
  "--hm-surface-panel-strong": "rgba(0,0,0,0.35)",
  "--hm-surface-elevated": "rgba(0,0,0,0.4)",
  "--hm-overlay-strong": "rgba(0,0,0,0.8)",
  "--hm-success": "#4ade80",
  "--hm-success-soft": "#86efac",
  "--hm-success-bg": "rgba(74,222,128,0.08)",
  "--hm-success-border": "rgba(74,222,128,0.2)",
  "--hm-warning": "#facc15",
  "--hm-warning-soft": "#fbbf24",
  "--hm-danger": "#ef4444",
  "--hm-danger-soft": "#fca5a5",
  "--hm-info": "#93c5fd",
  "--hm-info-bg": "rgba(96,165,250,0.18)",
  "--hm-info-border": "rgba(96,165,250,0.45)",
  "--hm-header-control-bg":
    "linear-gradient(180deg, rgba(28, 29, 33, 0.94) 0%, rgba(14, 14, 16, 0.99) 100%)",
  "--hm-header-control-hover-bg":
    "linear-gradient(180deg, rgba(38, 39, 44, 0.98) 0%, rgba(18, 18, 21, 1) 100%)",
  "--hm-header-control-border": "rgba(255, 255, 255, 0.1)",
  "--hm-header-control-border-strong": "rgba(255, 255, 255, 0.28)",
  "--hm-header-control-text": "#eceef2",
  "--hm-header-theme-icon": "#e5b84a",
  "--hm-header-control-shadow": "0 10px 24px rgba(0, 0, 0, 0.28)",
  "--hm-chart-bg": "#0d0e10",
  "--hm-chart-grid": "rgba(255, 255, 255, 0.06)",
  "--hm-chart-border": "rgba(255, 255, 255, 0.08)",
  "--hm-chart-text": "rgba(236, 238, 242, 0.68)",
  "--hm-chart-midline": "rgba(255, 255, 255, 0.14)",
  "--hm-chart-crosshair": "rgba(236, 238, 242, 0.18)",
  "--hm-chart-crosshair-label-bg": "#16181b",
  "--hm-chart-yes": "#e5b84a",
  "--hm-chart-yes-dim": "rgba(229, 184, 74, 0.22)",
  "--hm-chart-yes-zero": "rgba(229, 184, 74, 0)",
  "--hm-chart-no": "#22c55e",
  "--hm-chart-no-dim": "rgba(34, 197, 94, 0.12)",
  "--hm-chart-no-zero": "rgba(34, 197, 94, 0)",
};

const HYPERBET_THEME_DEFINITIONS: Record<
  HyperbetThemeId,
  HyperbetThemeDefinition
> = {
  evm: {
    accentColor: "#e5b84a",
    accentColorForeground: "#0b0c0e",
    chainLabel: "EVM",
    colorVariables: {
      ...COMMON_COLOR_VARIABLES,
      "--hm-accent-gold": "#e5b84a",
      "--hm-accent-gold-bright": "#f0d060",
      "--hm-accent-gold-dim": "#d4a84b",
      "--hm-accent-gold-ember": "#b8860b",
      "--hm-accent-gold-shadow": "#8b6914",
      "--hm-accent-red": "#ef4444",
      "--hm-border-bronze": "#6b5a20",
      "--hm-gold-glow-subtle": "rgba(229, 184, 74, 0.06)",
      "--hm-gold-glow-light": "rgba(229, 184, 74, 0.08)",
      "--hm-gold-glow-medium": "rgba(229, 184, 74, 0.15)",
      "--hm-gold-glow-strong": "rgba(229, 184, 74, 0.2)",
      "--hm-gold-border-subtle": "rgba(229, 184, 74, 0.12)",
      "--hm-gold-border-light": "rgba(229, 184, 74, 0.2)",
      "--hm-gold-border-medium": "rgba(229, 184, 74, 0.35)",
      "--hm-gold-border-accent": "rgba(229, 184, 74, 0.6)",
      "--hm-gold-shimmer": "rgba(229, 184, 74, 0.5)",
      "--hm-gold-shimmer-fade": "rgba(229, 184, 74, 0.35)",
      "--hm-header-theme-icon": "#e5b84a",
      "--hm-header-control-border-strong": "rgba(229, 184, 74, 0.34)",
      "--hm-chart-yes": "#e5b84a",
      "--hm-chart-yes-dim": "rgba(229, 184, 74, 0.22)",
      "--hm-chart-yes-zero": "rgba(229, 184, 74, 0)",
      "--hm-chain-theme-color": "#e5b84a",
    },
  },
  avax: {
    accentColor: "#E84142",
    accentColorForeground: "#ffffff",
    chainLabel: "AVAX",
    colorVariables: {
      ...COMMON_COLOR_VARIABLES,
      "--hm-accent-gold": "#E84142",
      "--hm-accent-gold-bright": "#FF394A",
      "--hm-accent-gold-dim": "#c73030",
      "--hm-accent-gold-ember": "#a02525",
      "--hm-accent-gold-shadow": "#7a1a1a",
      "--hm-accent-red": "#E84142",
      "--hm-border-bronze": "rgba(232, 65, 66, 0.35)",
      "--hm-gold-glow-subtle": "rgba(232, 65, 66, 0.06)",
      "--hm-gold-glow-light": "rgba(232, 65, 66, 0.1)",
      "--hm-gold-glow-medium": "rgba(232, 65, 66, 0.18)",
      "--hm-gold-glow-strong": "rgba(232, 65, 66, 0.28)",
      "--hm-gold-border-subtle": "rgba(232, 65, 66, 0.14)",
      "--hm-gold-border-light": "rgba(232, 65, 66, 0.25)",
      "--hm-gold-border-medium": "rgba(232, 65, 66, 0.45)",
      "--hm-gold-border-accent": "rgba(232, 65, 66, 0.7)",
      "--hm-gold-shimmer": "rgba(232, 65, 66, 0.55)",
      "--hm-gold-shimmer-fade": "rgba(232, 65, 66, 0.35)",
      "--hm-header-theme-icon": "#E84142",
      "--hm-header-control-border-strong": "rgba(232, 65, 66, 0.34)",
      "--hm-chart-yes": "#E84142",
      "--hm-chart-yes-dim": "rgba(232, 65, 66, 0.22)",
      "--hm-chart-yes-zero": "rgba(232, 65, 66, 0)",
      "--hm-chain-theme-color": "#E84142",
    },
  },
  bsc: {
    accentColor: "#F0B90B",
    accentColorForeground: "#111111",
    chainLabel: "BSC",
    colorVariables: {
      ...COMMON_COLOR_VARIABLES,
      "--hm-accent-gold": "#F0B90B",
      "--hm-accent-gold-bright": "#ffd24d",
      "--hm-accent-gold-dim": "#d39a00",
      "--hm-accent-gold-ember": "#b8860b",
      "--hm-accent-gold-shadow": "#6b4f00",
      "--hm-border-bronze": "rgba(240, 185, 11, 0.35)",
      "--hm-gold-glow-subtle": "rgba(240, 185, 11, 0.06)",
      "--hm-gold-glow-light": "rgba(240, 185, 11, 0.1)",
      "--hm-gold-glow-medium": "rgba(240, 185, 11, 0.18)",
      "--hm-gold-glow-strong": "rgba(240, 185, 11, 0.28)",
      "--hm-gold-border-subtle": "rgba(240, 185, 11, 0.14)",
      "--hm-gold-border-light": "rgba(240, 185, 11, 0.25)",
      "--hm-gold-border-medium": "rgba(240, 185, 11, 0.45)",
      "--hm-gold-border-accent": "rgba(240, 185, 11, 0.7)",
      "--hm-gold-shimmer": "rgba(240, 185, 11, 0.55)",
      "--hm-gold-shimmer-fade": "rgba(240, 185, 11, 0.35)",
      "--hm-header-theme-icon": "#F0B90B",
      "--hm-header-control-border-strong": "rgba(240, 185, 11, 0.34)",
      "--hm-chart-yes": "#F0B90B",
      "--hm-chart-yes-dim": "rgba(240, 185, 11, 0.22)",
      "--hm-chart-yes-zero": "rgba(240, 185, 11, 0)",
      "--hm-chain-theme-color": "#F0B90B",
    },
  },
  base: {
    accentColor: "#0052FF",
    accentColorForeground: "#ffffff",
    chainLabel: "BASE",
    colorVariables: {
      ...COMMON_COLOR_VARIABLES,
      "--hm-accent-gold": "#0052FF",
      "--hm-accent-gold-bright": "#4e86ff",
      "--hm-accent-gold-dim": "#003dc1",
      "--hm-accent-gold-ember": "#0032a0",
      "--hm-accent-gold-shadow": "#002470",
      "--hm-border-bronze": "rgba(0, 82, 255, 0.35)",
      "--hm-gold-glow-subtle": "rgba(0, 82, 255, 0.06)",
      "--hm-gold-glow-light": "rgba(0, 82, 255, 0.1)",
      "--hm-gold-glow-medium": "rgba(0, 82, 255, 0.18)",
      "--hm-gold-glow-strong": "rgba(0, 82, 255, 0.28)",
      "--hm-gold-border-subtle": "rgba(0, 82, 255, 0.14)",
      "--hm-gold-border-light": "rgba(0, 82, 255, 0.25)",
      "--hm-gold-border-medium": "rgba(0, 82, 255, 0.45)",
      "--hm-gold-border-accent": "rgba(0, 82, 255, 0.7)",
      "--hm-gold-shimmer": "rgba(0, 82, 255, 0.55)",
      "--hm-gold-shimmer-fade": "rgba(0, 82, 255, 0.35)",
      "--hm-header-theme-icon": "#0052FF",
      "--hm-header-control-border-strong": "rgba(0, 82, 255, 0.34)",
      "--hm-chart-yes": "#0052FF",
      "--hm-chart-yes-dim": "rgba(0, 82, 255, 0.22)",
      "--hm-chart-yes-zero": "rgba(0, 82, 255, 0)",
      "--hm-chain-theme-color": "#0052FF",
    },
  },
  solana: {
    accentColor: "#9945FF",
    accentColorForeground: "#ffffff",
    chainLabel: "SOLANA",
    colorVariables: {
      ...COMMON_COLOR_VARIABLES,
      "--hm-accent-gold": "#9945FF",
      "--hm-accent-gold-bright": "#b87cff",
      "--hm-accent-gold-dim": "#7c3aed",
      "--hm-accent-gold-ember": "#6d28d9",
      "--hm-accent-gold-shadow": "#4c1d95",
      "--hm-border-bronze": "rgba(153, 69, 255, 0.35)",
      "--hm-gold-glow-subtle": "rgba(153, 69, 255, 0.06)",
      "--hm-gold-glow-light": "rgba(153, 69, 255, 0.1)",
      "--hm-gold-glow-medium": "rgba(153, 69, 255, 0.18)",
      "--hm-gold-glow-strong": "rgba(153, 69, 255, 0.28)",
      "--hm-gold-border-subtle": "rgba(153, 69, 255, 0.14)",
      "--hm-gold-border-light": "rgba(153, 69, 255, 0.25)",
      "--hm-gold-border-medium": "rgba(153, 69, 255, 0.45)",
      "--hm-gold-border-accent": "rgba(153, 69, 255, 0.7)",
      "--hm-gold-shimmer": "rgba(153, 69, 255, 0.55)",
      "--hm-gold-shimmer-fade": "rgba(153, 69, 255, 0.35)",
      "--hm-header-theme-icon": "#9945FF",
      "--hm-header-control-border-strong": "rgba(153, 69, 255, 0.34)",
      "--hm-chart-yes": "#9945FF",
      "--hm-chart-yes-dim": "rgba(153, 69, 255, 0.22)",
      "--hm-chart-yes-zero": "rgba(153, 69, 255, 0)",
      "--hm-chain-theme-color": "#9945FF",
    },
  },
};

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function getStoredAppearance(
  storageKey: string,
  fallback: HyperbetAppearance,
): HyperbetAppearance {
  if (!isBrowser()) return fallback;
  const stored = window.localStorage.getItem(storageKey);
  return stored === "light" ? "light" : fallback;
}

export function getHyperbetThemeDefinition(
  themeId: HyperbetThemeId = DEFAULT_HYPERBET_THEME_ID,
): HyperbetThemeDefinition {
  return HYPERBET_THEME_DEFINITIONS[themeId] ?? HYPERBET_THEME_DEFINITIONS.evm;
}

export function getHyperbetAccentColor(
  themeId: HyperbetThemeId = DEFAULT_HYPERBET_THEME_ID,
): string {
  return getHyperbetThemeDefinition(themeId).accentColor;
}

export function applyHyperbetTheme(
  appearance: HyperbetAppearance,
  themeId: HyperbetThemeId = DEFAULT_HYPERBET_THEME_ID,
  storageKey = DEFAULT_HYPERBET_THEME_STORAGE_KEY,
): void {
  if (!isBrowser()) return;
  document.documentElement.dataset.theme = appearance;
  document.documentElement.dataset.hyperbetTheme = themeId;
  window.localStorage.setItem(storageKey, appearance);
}

export function applyStoredHyperbetTheme({
  themeId = DEFAULT_HYPERBET_THEME_ID,
  storageKey = DEFAULT_HYPERBET_THEME_STORAGE_KEY,
  fallback = DEFAULT_HYPERBET_APPEARANCE,
}: {
  themeId?: HyperbetThemeId;
  storageKey?: string;
  fallback?: HyperbetAppearance;
} = {}): void {
  applyHyperbetTheme(getStoredAppearance(storageKey, fallback), themeId, storageKey);
}

type HyperbetThemeContextValue = {
  appearance: HyperbetAppearance;
  setAppearance: (appearance: HyperbetAppearance) => void;
  toggleAppearance: () => void;
  themeId: HyperbetThemeId;
  themeDefinition: HyperbetThemeDefinition;
  storageKey: string;
};

const HyperbetThemeContext = createContext<HyperbetThemeContextValue | null>(
  null,
);

export function HyperbetThemeProvider({
  children,
  themeId = DEFAULT_HYPERBET_THEME_ID,
  defaultAppearance = DEFAULT_HYPERBET_APPEARANCE,
  storageKey = DEFAULT_HYPERBET_THEME_STORAGE_KEY,
}: {
  children: ReactNode;
  themeId?: HyperbetThemeId;
  defaultAppearance?: HyperbetAppearance;
  storageKey?: string;
}) {
  const [appearance, setAppearanceState] = useState<HyperbetAppearance>(() =>
    getStoredAppearance(storageKey, defaultAppearance),
  );

  useEffect(() => {
    applyHyperbetTheme(appearance, themeId, storageKey);
  }, [appearance, themeId, storageKey]);

  const setAppearance = useCallback((nextAppearance: HyperbetAppearance) => {
    setAppearanceState(nextAppearance);
  }, []);

  const toggleAppearance = useCallback(() => {
    setAppearanceState((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const themeDefinition = useMemo(
    () => getHyperbetThemeDefinition(themeId),
    [themeId],
  );

  const value = useMemo(
    () => ({
      appearance,
      setAppearance,
      toggleAppearance,
      themeId,
      themeDefinition,
      storageKey,
    }),
    [appearance, setAppearance, toggleAppearance, themeId, themeDefinition, storageKey],
  );

  return (
    <HyperbetThemeContext.Provider value={value}>
      {children}
    </HyperbetThemeContext.Provider>
  );
}

export function useHyperbetTheme(): HyperbetThemeContextValue {
  const context = useContext(HyperbetThemeContext);
  if (!context) {
    throw new Error("useHyperbetTheme must be used within HyperbetThemeProvider");
  }
  return context;
}

export function useResolvedHyperbetTheme(
  themeId?: HyperbetThemeId,
): HyperbetThemeDefinition {
  const context = useContext(HyperbetThemeContext);
  if (themeId) {
    return getHyperbetThemeDefinition(themeId);
  }
  return context?.themeDefinition ?? getHyperbetThemeDefinition(DEFAULT_HYPERBET_THEME_ID);
}

export function useHyperbetThemeSurface(themeId?: HyperbetThemeId): {
  themeDefinition: HyperbetThemeDefinition;
  themeStyle: CSSProperties;
  themeAttribute: HyperbetThemeId | undefined;
} {
  const themeDefinition = useResolvedHyperbetTheme(themeId);
  return {
    themeDefinition,
    themeStyle: themeDefinition.colorVariables,
    themeAttribute: themeId,
  };
}
