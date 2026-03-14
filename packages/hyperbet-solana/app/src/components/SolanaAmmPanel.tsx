import type { ComponentProps } from "react";
import {
  SolanaAmmPanel as SharedSolanaAmmPanel,
  type SolanaClobMarketSnapshot,
} from "@hyperbet/ui/components/SolanaAmmPanel";

import { useAppConnection, useAppWallet } from "../lib/appWallet";

type SharedProps = ComponentProps<typeof SharedSolanaAmmPanel>;

export type { SolanaClobMarketSnapshot };

export function SolanaAmmPanel(props: SharedProps) {
  const { connection } = useAppConnection();
  const wallet = useAppWallet();

  return (
    <SharedSolanaAmmPanel
      {...props}
      connectionOverride={connection}
      walletOverride={wallet}
    />
  );
}
