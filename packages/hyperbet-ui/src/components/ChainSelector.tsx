import { useChain } from "../lib/ChainContext";
import { type ChainId } from "../lib/chainConfig";
import { getLocalizedChainDisplay } from "@hyperbet/ui/tokens";
import { resolveUiLocale } from "@hyperbet/ui/i18n";

function ChainIcon({
  icon,
  name,
}: {
  icon: string;
  name: string;
}) {
  const isUrl = icon.startsWith("http://") || icon.startsWith("https://");
  if (isUrl) {
    return (
      <img
        src={icon}
        alt={name}
        width={24}
        height={24}
        style={{ display: "block", width: 24, height: 24, objectFit: "contain" }}
      />
    );
  }
  return <>{icon}</>;
}

export function ChainSelector() {
  const { activeChain, setActiveChain, availableChains } = useChain();
  const locale = resolveUiLocale();

  if (availableChains.length <= 1) {
    const display = getLocalizedChainDisplay(activeChain, locale);
    return (
      <div className="chain-badge">
        <span className="chain-badge-icon">
          <ChainIcon icon={display.icon} name={display.name} />
        </span>
        <span className="chain-badge-name">{display.shortName}</span>
      </div>
    );
  }

  return (
    <div className="chain-select-wrap">
      <select
        id="chain-selector"
        className="chain-select"
        value={activeChain}
        onChange={(e) => setActiveChain(e.target.value as ChainId)}
      >
        {availableChains.map((chain) => {
          const display = getLocalizedChainDisplay(chain, locale);
          const optionIcon =
            display.icon.startsWith("http://") ||
            display.icon.startsWith("https://")
              ? display.shortName
              : display.icon;
          return (
            <option key={chain} value={chain} style={{ background: "#111" }}>
              {optionIcon} {display.name}
            </option>
          );
        })}
      </select>
      <span className="chain-select-arrow">▼</span>
    </div>
  );
}
