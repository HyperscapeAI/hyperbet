import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getLocaleTag,
  resolveUiLocale,
  type UiLocale,
} from "@hyperbet/ui/i18n";
import type { ChainId } from "../lib/chainConfig";
import { buildArenaWriteHeaders, GAME_API_URL } from "../lib/config";

type EvmPlatform = "BSC" | "BASE" | "AVAX";

type PointsSnapshot = {
  wallet: string;
  pointsScope?: "WALLET" | "LINKED";
  identityWalletCount?: number;
  totalPoints: number;
  selfPoints: number;
  winPoints: number;
  referralPoints: number;
  stakingPoints: number;
  invitedWalletCount: number;
  referredBy: { wallet: string; code: string } | null;
};

type InviteSummary = {
  wallet: string;
  platformView: string;
  inviteCode: string;
  invitedWalletCount: number;
  invitedWallets: string[];
  invitedWalletsTruncated: boolean;
  pointsFromReferrals: number;
  feeShareFromReferralsGold: string;
  treasuryFeesFromReferredBetsGold: string;
  referredByWallet: string | null;
  referredByCode: string | null;
  activeReferralCount: number;
  pendingSignupBonuses: number;
  totalReferralWinPoints: number;
};

type WalletLinkResponse = {
  result?: {
    alreadyLinked: boolean;
    awardedPoints: number;
  };
  error?: string;
};

const LOCAL_INVITE_ORIGIN = "http://localhost:4179";
const WEBSITE_INVITE_ORIGIN = "https://hyperscape.bet";

function shortWallet(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function extractInviteCode(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!trimmed.includes("://")) return trimmed;

  try {
    const parsed = new URL(trimmed);
    return parsed.searchParams.get("invite")?.trim() ?? "";
  } catch {
    return "";
  }
}

function buildInviteShareLink(inviteCode: string): string {
  if (typeof window === "undefined") {
    return `${WEBSITE_INVITE_ORIGIN}/?invite=${encodeURIComponent(inviteCode)}`;
  }
  const isLocalHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  const shareOrigin = isLocalHost ? LOCAL_INVITE_ORIGIN : WEBSITE_INVITE_ORIGIN;
  const url = new URL(window.location.pathname, `${shareOrigin}/`);
  url.searchParams.set("invite", inviteCode);
  return url.toString();
}

function getReferralCopy(locale: UiLocale) {
  return locale === "zh"
    ? {
        title: "邀请",
        loadWallet: "连接钱包以加载邀请数据。",
        statsUnavailable: (errors: string[]) =>
          `邀请统计不可用（${errors.join("，")}）`,
        statsRequestFailed: "邀请统计请求失败",
        connectWalletToRedeem: "请先连接钱包再兑换邀请码",
        enterInviteCode: "请输入邀请码",
        redeeming: "正在兑换邀请码...",
        redeemFailed: "邀请码兑换失败",
        alreadyLinkedReferrer: "已关联该邀请人",
        inviteLinkedWithBonus: (bonus: number) =>
          `邀请码已关联，奖励 +${bonus} 积分`,
        inviteLinked: "邀请码已关联",
        connectBothWallets: "请先连接 Solana 与 EVM 钱包",
        linkingWallets: "正在关联钱包...",
        walletLinkFailed: "钱包关联失败",
        walletsAlreadyLinked: "钱包已关联",
        walletsLinked: (bonus: number) => `钱包已关联（+${bonus} 积分）`,
        inviteLinkCopied: "邀请链接已复制",
        inviteLinkCopyFailed: "复制邀请链接失败",
        walletScope: "钱包",
        linkedScope: "已关联",
        wallets: (count: number) => `${count} 个钱包`,
        referredBy: (wallet: string) => `邀请人 ${wallet}`,
        points: "积分",
        referrals: "邀请",
        pending: (count: number) => `（${count} 待发放）`,
        feeShare: "分成",
        winBonuses: (points: number) =>
          `胜场奖励 +${points.toLocaleString(getLocaleTag(locale))} 积分`,
        refreshingPoints: "正在刷新积分...",
        copyLink: "复制链接",
        redeemPlaceholder: "输入邀请码或邀请链接",
        redeem: "兑换",
        linkWallets: "关联钱包",
      }
    : {
        title: "Referral",
        loadWallet: "Connect a wallet to load referral data.",
        statsUnavailable: (errors: string[]) =>
          `Stats unavailable (${errors.join(", ")})`,
        statsRequestFailed: "Stats request failed",
        connectWalletToRedeem: "Connect wallet to redeem invite code",
        enterInviteCode: "Enter an invite code",
        redeeming: "Redeeming invite code...",
        redeemFailed: "Invite redeem failed",
        alreadyLinkedReferrer: "Already linked to this referrer",
        inviteLinkedWithBonus: (bonus: number) =>
          `Invite code linked! +${bonus} bonus points`,
        inviteLinked: "Invite code linked",
        connectBothWallets: "Connect both Solana and EVM wallets first",
        linkingWallets: "Linking wallets...",
        walletLinkFailed: "Wallet link failed",
        walletsAlreadyLinked: "Wallets are already linked",
        walletsLinked: (bonus: number) => `Wallets linked (+${bonus} points)`,
        inviteLinkCopied: "Invite link copied",
        inviteLinkCopyFailed: "Failed to copy invite link",
        walletScope: "WALLET",
        linkedScope: "LINKED",
        wallets: (count: number) => `${count} wallet${count === 1 ? "" : "s"}`,
        referredBy: (wallet: string) => `Referred by ${wallet}`,
        points: "Points",
        referrals: "Referrals",
        pending: (count: number) => ` (${count} pending)`,
        feeShare: "Fee Share",
        winBonuses: (points: number) =>
          `Win Bonuses: +${points.toLocaleString(getLocaleTag(locale))} pts`,
        refreshingPoints: "Refreshing points...",
        copyLink: "Copy Link",
        redeemPlaceholder: "Redeem invite code or link",
        redeem: "Redeem",
        linkWallets: "Link Wallets",
      };
}

function formatPointsScope(
  scope: PointsSnapshot["pointsScope"] | undefined,
  copy: ReturnType<typeof getReferralCopy>,
): string {
  return scope === "LINKED" ? copy.linkedScope : copy.walletScope;
}

export function ReferralPanel(props: {
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
  const copy = getReferralCopy(resolvedLocale);

  const primaryWallet = useMemo(() => {
    if (activeChain === "solana" && solanaWallet) return solanaWallet;
    if (
      (activeChain === "bsc" ||
        activeChain === "base" ||
        activeChain === "avax") &&
      evmWallet
    ) {
      return evmWallet;
    }
    return solanaWallet ?? evmWallet ?? null;
  }, [activeChain, solanaWallet, evmWallet]);

  const platformQuery = useMemo(() => {
    if (primaryWallet && primaryWallet === solanaWallet) return "solana";
    if (primaryWallet && primaryWallet === evmWallet) return "evm";
    return activeChain === "solana" ? "solana" : "evm";
  }, [activeChain, evmWallet, primaryWallet, solanaWallet]);
  const [points, setPoints] = useState<PointsSnapshot | null>(null);
  const [invite, setInvite] = useState<InviteSummary | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState("");
  const [redeemCode, setRedeemCode] = useState("");
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const refreshStats = useCallback(async () => {
    if (!primaryWallet) {
      setPoints(null);
      setInvite(null);
      setStatsError("");
      setLoadingStats(false);
      return;
    }

    try {
      setLoadingStats(true);
      setStatsError("");
      const [pointsRes, inviteRes] = await Promise.all([
        fetch(
          `${GAME_API_URL}/api/arena/points/${primaryWallet}?scope=linked`,
          { cache: "no-store" },
        ),
        fetch(
          `${GAME_API_URL}/api/arena/invite/${primaryWallet}?platform=${platformQuery}`,
          { cache: "no-store" },
        ),
      ]);

      const errors: string[] = [];
      if (pointsRes.ok) {
        setPoints((await pointsRes.json()) as PointsSnapshot);
      } else {
        setPoints(null);
        errors.push(`points ${pointsRes.status}`);
      }
      if (inviteRes.ok) {
        setInvite((await inviteRes.json()) as InviteSummary);
      } else {
        setInvite(null);
        errors.push(`invite ${inviteRes.status}`);
      }

      if (errors.length > 0) {
        setStatsError(copy.statsUnavailable(errors));
      }
    } catch {
      setPoints(null);
      setInvite(null);
      setStatsError(copy.statsRequestFailed);
    } finally {
      setLoadingStats(false);
    }
  }, [copy, platformQuery, primaryWallet]);

  useEffect(() => {
    void refreshStats();
    const id = window.setInterval(() => void refreshStats(), 15_000);
    return () => window.clearInterval(id);
  }, [refreshStats]);

  useEffect(() => {
    const inviteFromQuery = new URLSearchParams(window.location.search)
      .get("invite")
      ?.trim();
    if (!inviteFromQuery) return;
    setRedeemCode((current) =>
      current.trim() ? current : inviteFromQuery.toUpperCase(),
    );
  }, []);

  const canLinkWallets = Boolean(
    solanaWallet && evmWallet && evmWalletPlatform,
  );

  const handleRedeem = useCallback(async () => {
    if (!primaryWallet) {
      setStatus(copy.connectWalletToRedeem);
      return;
    }

    const code = extractInviteCode(redeemCode).toUpperCase();
    if (!code) {
      setStatus(copy.enterInviteCode);
      return;
    }

    setBusy(true);
    setStatus(copy.redeeming);
    try {
      const response = await fetch(`${GAME_API_URL}/api/arena/invite/redeem`, {
        method: "POST",
        headers: buildArenaWriteHeaders(),
        body: JSON.stringify({ wallet: primaryWallet, inviteCode: code }),
      });
      const payload = (await response.json()) as {
        error?: string;
        result?: { signupBonus?: number; alreadyLinked?: boolean };
        signupBonus?: number;
      };
      if (!response.ok) {
        setStatus(payload.error ?? copy.redeemFailed);
        return;
      }
      const bonus = payload.result?.signupBonus ?? payload.signupBonus ?? 0;
      if (payload.result?.alreadyLinked) {
        setStatus(copy.alreadyLinkedReferrer);
      } else if (bonus > 0) {
        setStatus(copy.inviteLinkedWithBonus(bonus));
      } else {
        setStatus(copy.inviteLinked);
      }
      setRedeemCode("");
      await refreshStats();
    } catch {
      setStatus(copy.redeemFailed);
    } finally {
      setBusy(false);
    }
  }, [copy, primaryWallet, redeemCode, refreshStats]);

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

    setBusy(true);
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
      await refreshStats();
    } catch {
      setStatus(copy.walletLinkFailed);
    } finally {
      setBusy(false);
    }
  }, [
    activeChain,
    copy,
    evmWallet,
    evmWalletPlatform,
    refreshStats,
    solanaWallet,
  ]);

  const handleCopyInvite = useCallback(async () => {
    if (!invite?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(
        buildInviteShareLink(invite.inviteCode),
      );
      setStatus(copy.inviteLinkCopied);
    } catch {
      setStatus(copy.inviteLinkCopyFailed);
    }
  }, [copy, invite?.inviteCode]);

  const noPrimaryWallet = !primaryWallet;
  const identityWalletCount = points?.identityWalletCount ?? 1;

  return (
    <div
      data-testid="referral-panel"
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
      <div style={{ fontSize: 12, textTransform: "uppercase", opacity: 0.65 }}>
        {copy.title}
      </div>

      {noPrimaryWallet ? (
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
          {copy.loadWallet}
        </div>
      ) : (
        <>
          <div
            data-testid="referral-panel-points-scope"
            style={{ fontSize: 12, color: "rgba(255,255,255,0.62)" }}
          >
            {shortWallet(primaryWallet)} ·{" "}
            {formatPointsScope(points?.pointsScope, copy)} ·{" "}
            {copy.wallets(identityWalletCount)}
          </div>
          {points?.referredBy ? (
            <div
              data-testid="referral-panel-referred-by"
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                background: "rgba(74,222,128,0.08)",
                border: "1px solid rgba(74,222,128,0.2)",
                fontSize: 11,
                marginBottom: 2,
              }}
            >
              <div
                style={{ color: "#4ade80", fontWeight: 600, marginBottom: 2 }}
              >
                {copy.referredBy(shortWallet(points.referredBy.wallet))}
              </div>
              <div style={{ color: "rgba(255,255,255,0.55)" }}>
                {points.referredBy.code}
              </div>
            </div>
          ) : null}

          <div
            style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12 }}
          >
            <span>
              {copy.points}:{" "}
              {(points?.totalPoints ?? 0).toLocaleString(
                getLocaleTag(resolvedLocale),
              )}
            </span>
            <span>
              {copy.referrals}: {invite?.activeReferralCount ?? 0}/
              {invite?.invitedWalletCount ?? 0}
              {(invite?.pendingSignupBonuses ?? 0) > 0
                ? copy.pending(invite?.pendingSignupBonuses ?? 0)
                : ""}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              fontSize: 11,
              color: "rgba(255,255,255,0.6)",
            }}
          >
            <span>
              {copy.feeShare}: {invite?.feeShareFromReferralsGold ?? "0"} GOLD
            </span>
            {(invite?.totalReferralWinPoints ?? 0) > 0 ? (
              <span>
                {copy.winBonuses(invite?.totalReferralWinPoints ?? 0)}
              </span>
            ) : null}
          </div>
          {loadingStats ? (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.56)" }}>
              {copy.refreshingPoints}
            </div>
          ) : null}
          {statsError ? (
            <div style={{ fontSize: 11, color: "#fca5a5" }}>{statsError}</div>
          ) : null}

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code
              data-testid="referral-panel-invite-code"
              style={{
                flex: 1,
                fontSize: 11,
                padding: "8px 10px",
                borderRadius: 8,
                background: "rgba(0,0,0,0.45)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {invite?.inviteCode ?? "-"}
            </code>
            <button
              type="button"
              onClick={handleCopyInvite}
              disabled={!invite?.inviteCode}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(0,0,0,0.35)",
                color: "#fff",
                cursor: invite?.inviteCode ? "pointer" : "not-allowed",
              }}
            >
              {copy.copyLink}
            </button>
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          data-testid="referral-panel-redeem-input"
          type="text"
          placeholder={copy.redeemPlaceholder}
          value={redeemCode}
          onChange={(event) => setRedeemCode(event.target.value)}
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(0,0,0,0.35)",
            color: "#fff",
            fontSize: 12,
          }}
        />
        <button
          type="button"
          data-testid="referral-panel-redeem-button"
          onClick={() => void handleRedeem()}
          disabled={busy || !primaryWallet}
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(234,179,8,0.45)",
            background: "rgba(234,179,8,0.2)",
            color: "#fbbf24",
            cursor: busy || !primaryWallet ? "not-allowed" : "pointer",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {copy.redeem}
        </button>
      </div>

      <button
        type="button"
        data-testid="referral-panel-link-wallets"
        onClick={() => void handleLinkWallets()}
        disabled={busy || !canLinkWallets}
        style={{
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid rgba(96,165,250,0.45)",
          background: "rgba(96,165,250,0.18)",
          color: "#93c5fd",
          cursor: busy || !canLinkWallets ? "not-allowed" : "pointer",
          fontSize: 12,
          fontWeight: 700,
          textAlign: "left",
        }}
      >
        {copy.linkWallets}
      </button>

      {status ? (
        <div
          data-testid="referral-panel-status"
          style={{ fontSize: 11, color: "rgba(255,255,255,0.68)" }}
        >
          {status}
        </div>
      ) : null}
    </div>
  );
}
