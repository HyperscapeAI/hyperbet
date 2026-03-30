import type { CSSProperties } from "react";
import {
  useHyperbetTheme,
  useResolvedHyperbetTheme,
  type HyperbetAppearance,
  type HyperbetThemeId,
} from "../lib/theme";

const NEXT_THEME: Record<HyperbetAppearance, HyperbetAppearance> = {
  dark: "light",
  light: "dark",
};

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function ThemeSelector({
  compact = false,
  theme,
}: {
  compact?: boolean;
  theme?: HyperbetThemeId;
}) {
  const { appearance, setAppearance } = useHyperbetTheme();
  const resolvedTheme = useResolvedHyperbetTheme(theme);

  return (
    <button
      type="button"
      className={`hm-theme-toggle${compact ? " hm-theme-toggle--compact" : ""}`}
      aria-label={`Switch to ${NEXT_THEME[appearance]} theme`}
      data-testid="theme-selector"
      data-hyperbet-theme={theme}
      style={resolvedTheme.colorVariables as CSSProperties}
      onClick={() => setAppearance(NEXT_THEME[appearance])}
    >
      {appearance === "dark" ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
