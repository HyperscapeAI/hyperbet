import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { ChainId } from "./chainConfig";
import { getAvailableChains, LARGEST_MARKET_CACHE_KEY } from "./chainConfig";

const SELECTED_CHAIN_STORAGE_KEY = "goldArena_selectedChain";

type ChainContextValue = {
  activeChain: ChainId;
  setActiveChain: (chain: ChainId) => void;
  availableChains: ChainId[];
};

type ChainProviderOptions = {
  e2eDefaultChain?: ChainId;
  /** Pin the available chains instead of deriving from env/config. */
  chains?: ChainId[];
};

const ChainCtx = createContext<ChainContextValue>({
  activeChain: "solana",
  setActiveChain: () => {},
  availableChains: ["solana"],
});

function getDefaultChain(e2eDefaultChain?: ChainId, chains?: ChainId[]): ChainId {
  const available = chains ?? getAvailableChains();

  try {
    const selected = localStorage.getItem(SELECTED_CHAIN_STORAGE_KEY);
    if (selected && available.includes(selected as ChainId)) {
      return selected as ChainId;
    }
  } catch {
    // localStorage not available
  }

  if (import.meta.env.MODE === "e2e") {
    if (e2eDefaultChain && available.includes(e2eDefaultChain)) {
      return e2eDefaultChain;
    }
    if (available.includes("solana")) return "solana";
  }

  try {
    const cached = localStorage.getItem(LARGEST_MARKET_CACHE_KEY);
    if (cached && available.includes(cached as ChainId)) {
      return cached as ChainId;
    }
  } catch {
    // localStorage not available
  }

  if (available.includes("base")) return "base";
  if (available.includes("bsc")) return "bsc";
  if (available.includes("avax")) return "avax";

  return available[0] ?? "solana";
}

function ChainProviderBase({
  children,
  e2eDefaultChain,
  chains,
}: {
  children: ReactNode;
  e2eDefaultChain?: ChainId;
  chains?: ChainId[];
}) {
  const availableChains = useMemo(() => chains ?? getAvailableChains(), [chains]);
  const [activeChain, setActiveChainRaw] = useState<ChainId>(() =>
    getDefaultChain(e2eDefaultChain, chains),
  );

  const setActiveChain = useCallback(
    (chain: ChainId) => {
      if (availableChains.includes(chain)) {
        setActiveChainRaw(chain);
        try {
          localStorage.setItem(SELECTED_CHAIN_STORAGE_KEY, chain);
        } catch {
          // ignore
        }
      }
    },
    [availableChains],
  );

  useEffect(() => {
    if (!availableChains.includes(activeChain)) {
      setActiveChainRaw(availableChains[0] ?? "solana");
    }
  }, [availableChains, activeChain]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    (
      window as typeof window & {
        __HYPERBET_ACTIVE_CHAIN__?: ChainId | null;
      }
    ).__HYPERBET_ACTIVE_CHAIN__ = activeChain;
    return () => {
      (
        window as typeof window & {
          __HYPERBET_ACTIVE_CHAIN__?: ChainId | null;
        }
      ).__HYPERBET_ACTIVE_CHAIN__ = null;
    };
  }, [activeChain]);

  const value = useMemo<ChainContextValue>(
    () => ({
      activeChain,
      setActiveChain,
      availableChains,
    }),
    [activeChain, setActiveChain, availableChains],
  );

  return <ChainCtx.Provider value={value}>{children}</ChainCtx.Provider>;
}

export function createChainProvider(options: ChainProviderOptions = {}) {
  function ChainProvider({ children }: { children: ReactNode }) {
    return (
      <ChainProviderBase e2eDefaultChain={options.e2eDefaultChain} chains={options.chains}>
        {children}
      </ChainProviderBase>
    );
  }

  ChainProvider.displayName = "ChainProvider";
  return ChainProvider;
}

export const ChainProvider = createChainProvider();

export function useChain(): ChainContextValue {
  return useContext(ChainCtx);
}
