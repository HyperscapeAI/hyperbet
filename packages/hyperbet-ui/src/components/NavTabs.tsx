import { startTransition, type ReactNode } from "react";

export interface NavTab {
  id: string;
  label: ReactNode;
  testId?: string;
}

interface NavTabsProps {
  tabs: NavTab[];
  activeTab: string;
  onChange: (id: string) => void;
  variant?: "header" | "mobile";
}

export function NavTabs({ tabs, activeTab, onChange, variant = "header" }: NavTabsProps) {
  return (
    <nav
      className={`hm-nav-tabs hm-nav-tabs--${variant} hm-view-tabs hm-view-tabs--${variant}`}
      aria-label="Navigation"
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            data-testid={tab.testId}
            className={`hm-nav-tab hm-view-tab${isActive ? " hm-nav-tab--active hm-view-tab--active" : ""}`}
            aria-current={isActive ? "page" : undefined}
            onClick={() => startTransition(() => onChange(tab.id))}
          >
            <span className="hm-nav-tab-label">{tab.label}</span>
            {isActive && <span className="hm-nav-tab-glow" aria-hidden="true" />}
          </button>
        );
      })}
    </nav>
  );
}
