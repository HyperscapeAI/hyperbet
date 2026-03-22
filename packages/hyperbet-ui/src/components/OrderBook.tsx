import React, { useEffect, useState, useRef } from "react";
import {
  formatLocaleAmount,
  getUiCopy,
  resolveUiLocale,
  type UiLocale,
} from "@hyperbet/ui/i18n";

export interface OrderLevel {
  price: number;
  amount: number;
  total: number;
}

interface OrderBookProps {
  yesPot: number;
  noPot: number;
  totalPot: number;
  goldPriceUsd: number | null;
  locale?: UiLocale;
  assetSymbol?: string;
  bids?: OrderLevel[];
  asks?: OrderLevel[];
  midPrice?: number;
  spread?: number;
}

function LevelRow({
  level,
  type,
  maxTotal,
  locale,
  label,
}: {
  level: OrderLevel;
  type: "bid" | "ask";
  maxTotal: number;
  locale: UiLocale;
  label: string;
}) {
  const prevAmountRef = useRef(level.amount);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (level.amount > prevAmountRef.current) {
      setFlash("up");
    } else if (level.amount < prevAmountRef.current) {
      setFlash("down");
    }
    prevAmountRef.current = level.amount;

    const timer = setTimeout(() => setFlash(null), 500);
    return () => clearTimeout(timer);
  }, [level.amount]);

  const color = type === "bid" ? "var(--hm-buy)" : "var(--hm-sell)";
  const bg = type === "bid"
    ? "var(--hm-orderbook-bid-bg, rgba(34,197,94,0.15))"
    : "var(--hm-orderbook-ask-bg, rgba(232,65,66,0.15))";
  const borderColor =
    type === "bid"
      ? "var(--hm-orderbook-bid-border, rgba(34,197,94,0.4))"
      : "var(--hm-orderbook-ask-border, rgba(232,65,66,0.4))";

  let rowBg = "transparent";
  if (flash === "up") rowBg = "var(--hm-flash-up-bg, rgba(255,255,255,0.15))";
  if (flash === "down") rowBg = "var(--hm-flash-down-bg, rgba(232,65,66,0.15))";

  const ariaLabel = `${label} price ${level.price.toFixed(3)}, size ${formatLocaleAmount(
    level.amount,
    locale,
  )}, total ${formatLocaleAmount(level.total, locale)}`;

  return (
    <div
      role="listitem"
      aria-label={ariaLabel}
      style={{
        display: "flex",
        fontSize: 12,
        position: "relative",
        padding: "3px 4px 3px 8px",
        background: rowBg,
        transition: "background 0.5s ease-out",
        borderRadius: 4,
        borderLeft: `2px solid ${borderColor}`,
        lineHeight: 1.2,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: `${maxTotal > 0 ? (level.total / maxTotal) * 100 : 0}%`,
          background: bg,
          zIndex: 0,
          transition: "width 0.3s ease-out",
          borderRadius: "0 4px 4px 0",
        }}
      />
      <div
        style={{
          flex: 1,
          color,
          fontWeight: 700,
          zIndex: 1,
          textShadow: `0 0 6px ${color}44`,
          fontFamily: "var(--hm-font-mono)",
          fontSize: 11,
        }}
      >
        {level.price.toFixed(3)}
      </div>
      <div
        style={{
          flex: 1,
          textAlign: "right",
          color: "var(--hm-text, rgba(255,255,255,0.75))",
          zIndex: 1,
          fontFamily: "var(--hm-font-mono)",
          fontSize: 11,
        }}
      >
        {formatLocaleAmount(level.amount, locale)}
      </div>
      <div
        style={{
          flex: 1,
          textAlign: "right",
          color: "var(--hm-text-muted, rgba(255,255,255,0.4))",
          zIndex: 1,
          fontFamily: "var(--hm-font-mono)",
          fontSize: 11,
        }}
      >
        {formatLocaleAmount(level.total, locale)}
      </div>
    </div>
  );
}

export function OrderBook({
  yesPot,
  noPot,
  totalPot,
  goldPriceUsd,
  locale,
  assetSymbol = "GOLD",
  bids = [],
  asks = [],
  midPrice,
  spread,
}: OrderBookProps) {
  const resolvedLocale = resolveUiLocale(locale);
  const copy = getUiCopy(resolvedLocale);
  const displayMid = midPrice ?? (totalPot > 0 ? yesPot / totalPot : 0.5);
  const displaySpread = spread ?? 0;
  const orderBookLabel = copy.orderBook ?? "Order book";

  const maxBidTotal = bids.reduce((m, b) => Math.max(m, b.total), 1);
  const maxAskTotal = asks.reduce((m, a) => Math.max(m, a.total), 1);

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid var(--hm-border-subtle, rgba(255,255,255,0.05))",
          paddingBottom: 4,
        }}
      >
        <div
          role="heading"
          aria-level={3}
          style={{
            fontSize: 13,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: 2,
            color: "var(--hm-text-dim, rgba(255,255,255,0.55))",
            fontFamily: "var(--hm-font-display)",
          }}
        >
          {orderBookLabel}
        </div>
        {goldPriceUsd !== null && false /* Shown in chart area instead */}
      </div>

      {/* Header */}
      <div
        role="presentation"
        style={{
          display: "flex",
          fontSize: 9,
          fontWeight: 900,
          color: "var(--hm-text-muted, rgba(255,255,255,0.55))",
          padding: "2px 8px",
          textTransform: "uppercase",
          letterSpacing: 1.5,
          fontFamily: "var(--hm-font-display)",
        }}
      >
        <div style={{ flex: 1 }}>{copy.price}</div>
        <div style={{ flex: 1, textAlign: "right" }}>{copy.size}</div>
        <div style={{ flex: 1, textAlign: "right" }}>{copy.total}</div>
      </div>

      {/* Asks (Sells) */}
      <div
        role="list"
        aria-label={`${orderBookLabel} asks`}
        tabIndex={0}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 1,
          flex: 1,
          minHeight: 0,
          justifyContent: "flex-end",
          overflowY: "auto",
          scrollbarGutter: "stable",
          paddingRight: 2,
        }}
      >
        {asks.map((ask) => (
          <LevelRow
            key={`ask-${ask.price}`}
            level={ask}
            type="ask"
            maxTotal={maxAskTotal}
            locale={resolvedLocale}
            label={copy.sell ?? "Ask"}
          />
        ))}
      </div>

      {/* Spread / Mid */}
      <div
        role="status"
        aria-live="polite"
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: "4px 0",
          margin: "1px 0",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "var(--hm-chip-bg-strong, rgba(0,0,0,0.4))",
            padding: "4px 12px",
            borderRadius: 6,
            border: "1px solid var(--hm-chip-border, rgba(232,65,66,0.2))",
            boxShadow:
              "0 0 8px var(--hm-chip-shadow, rgba(232,65,66,0.08)), inset 0 1px 0 rgba(255,255,255,0.05)",
          }}
        >
          <div
            style={{
              fontSize: 16,
              fontWeight: 900,
              color: "var(--hm-accent-gold)",
              fontFamily: "var(--hm-font-mono)",
              textShadow: "0 0 8px var(--hm-chip-highlight, rgba(232,65,66,0.3))",
            }}
          >
            {displayMid.toFixed(3)}
          </div>
          <div
            style={{
              fontSize: 10,
              color: "var(--hm-text-muted, rgba(255,255,255,0.55))",
              fontFamily: "var(--hm-font-body)",
            }}
          >
            {copy.spread}: {displaySpread.toFixed(3)}
          </div>
        </div>
      </div>

      {/* Bids (Buys) */}
      <div
        role="list"
        aria-label={`${orderBookLabel} bids`}
        tabIndex={0}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 1,
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          scrollbarGutter: "stable",
          paddingRight: 2,
        }}
      >
        {bids.map((bid) => (
          <LevelRow
            key={`bid-${bid.price}`}
            level={bid}
            type="bid"
            maxTotal={maxBidTotal}
            locale={resolvedLocale}
            label={copy.buy ?? "Bid"}
          />
        ))}
      </div>


    </>
  );
}
