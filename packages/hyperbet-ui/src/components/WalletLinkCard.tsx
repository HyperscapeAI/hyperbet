import { useCallback, useState } from "react";
import { resolveUiLocale, type UiLocale } from "@hyperbet/ui/i18n";
import type { ChainId } from "../lib/chainConfig";
import { GAME_API_URL, buildArenaWriteHeaders } from "../lib/config";

type EvmPlatform = "BSC" | "BASE" | "AVAX";

type WalletLinkResponse = {
  result?: {
    alreadyLinked: boolean;
    awardedPoints: number;
  };
  error?: string;
};

function getWalletLinkCopy(locale: UiLocale) {
  return locale === "zh"
    ? {
        title: "钱包关联",
        solana: "Solana",
        evm: "EVM",
        notConnected: "未连接",
        connectBothWallets: "请先连接 Solana 与 EVM 钱包",
        linkingWallets: "正在关联钱包...",
        walletLinkFailed: "钱包关联失败",
        walletsAlreadyLinked: "钱包已关联",
        walletsLinked: (bonus: number) =>
          bonus > 0 ? `钱包已关联（+${bonus} 积分）` : "钱包已关联",
        linkWallets: "关联钱包",
        connectWallets: "连接钱包",
      }
    : {
        title: "Wallet Link",
        solana: "Solana",
        evm: "EVM",
        notConnected: "Not connected",
        connectBothWallets: "Connect both Solana and EVM wallets first",
        linkingWallets: "Linking wallets...",
        walletLinkFailed: "Wallet link failed",
        walletsAlreadyLinked: "Wallets are already linked",
        walletsLinked: (bonus: number) =>
          `Wallets linked${bonus > 0 ? ` (+${bonus} points)` : ""}`,
        linkWallets: "Link Wallets",
        connectWallets: "Connect Wallets",
      };
}

function shortWallet(value: string | null, notConnectedLabel: string): string {
  if (!value) return notConnectedLabel;
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function WalletLinkCard(props: {
  activeChain: ChainId;
  solanaWallet?: string | null;
  evmWallet: string | null;
  evmWalletPlatform: EvmPlatform | null;
  locale?: UiLocale;
}) {
  const {
    activeChain,
    solanaWallet,
    evmWallet,
    evmWalletPlatform,
    locale,
  } = props;
  const resolvedLocale = resolveUiLocale(locale);
  const copy = getWalletLinkCopy(resolvedLocale);
  const [status, setStatus] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const canLink = Boolean(solanaWallet && evmWallet && evmWalletPlatform);
  const statusColor = /failed|error/i.test(status)
    ? "#fda4af"
    : /linked|already|关联/.test(status)
      ? "#86efac"
      : "rgba(255,255,255,0.72)";

  const handleLinkWallets = useCallback(async () => {
    if (!solanaWallet || !evmWallet || !evmWalletPlatform) {
      setStatus(copy.connectBothWallets);
      return;
    }

    const requestBody =
      activeChain === "solana"
        ? {
            wallet: solanaWallet,
            walletPlatform: "SOLANA",
            linkedWallet: evmWallet,
            linkedWalletPlatform: evmWalletPlatform,
          }
        : {
            wallet: evmWallet,
            walletPlatform: evmWalletPlatform,
            linkedWallet: solanaWallet,
            linkedWalletPlatform: "SOLANA",
          };

    setIsBusy(true);
    setStatus(copy.linkingWallets);

    try {
      const response = await fetch(`${GAME_API_URL}/api/arena/wallet-link`, {
        method: "POST",
        headers: buildArenaWriteHeaders(),
        body: JSON.stringify(requestBody),
      });

      const payload = (await response.json()) as WalletLinkResponse;
      if (!response.ok) {
        setStatus(payload.error ?? copy.walletLinkFailed);
        return;
      }

      if (payload.result?.alreadyLinked) {
        setStatus(copy.walletsAlreadyLinked);
      } else {
        setStatus(copy.walletsLinked(payload.result?.awardedPoints ?? 0));
      }
    } catch {
      setStatus(copy.walletLinkFailed);
    } finally {
      setIsBusy(false);
    }
  }, [activeChain, copy, evmWallet, evmWalletPlatform, solanaWallet]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 14,
        borderRadius: 12,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 1.1,
          color: "rgba(255,255,255,0.62)",
        }}
      >
        {copy.title}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "6px 10px",
          fontSize: 12,
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.5)" }}>{copy.solana}</span>
        <span
          style={{ color: solanaWallet ? "#c4b5fd" : "rgba(255,255,255,0.62)" }}
        >
          {shortWallet(solanaWallet ?? null, copy.notConnected)}
        </span>
        <span style={{ color: "rgba(255,255,255,0.5)" }}>{copy.evm}</span>
        <span
          style={{ color: evmWallet ? "#93c5fd" : "rgba(255,255,255,0.62)" }}
        >
          {evmWallet
            ? `${shortWallet(evmWallet, copy.notConnected)}${evmWalletPlatform ? ` (${evmWalletPlatform})` : ""}`
            : copy.notConnected}
        </span>
      </div>

      <button
        type="button"
        onClick={() => void handleLinkWallets()}
        disabled={isBusy || !canLink}
        style={{
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid rgba(96,165,250,0.45)",
          background: "rgba(96,165,250,0.18)",
          color: "#93c5fd",
          cursor: isBusy || !canLink ? "not-allowed" : "pointer",
          fontSize: 12,
          fontWeight: 700,
          textAlign: "left",
          opacity: isBusy || !canLink ? 0.6 : 1,
        }}
      >
        {canLink ? copy.linkWallets : copy.connectWallets}
      </button>

      {status ? (
        <div style={{ fontSize: 11, color: statusColor }}>{status}</div>
      ) : null}
    </div>
  );
}
