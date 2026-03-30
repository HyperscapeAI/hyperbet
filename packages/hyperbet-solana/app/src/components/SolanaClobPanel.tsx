import type { ComponentProps } from "react";
import {
  SolanaClobPanel as SharedSolanaClobPanel,
  type SolanaClobMarketSnapshot,
} from "@hyperbet/ui/components/SolanaClobPanel";

import { useAppConnection, useAppWallet } from "../lib/appWallet";

type SharedProps = ComponentProps<typeof SharedSolanaClobPanel>;

export type { SolanaClobMarketSnapshot };

export function SolanaClobPanel(props: SharedProps) {
  const { connection } = useAppConnection();
  const wallet = useAppWallet();

  return (
    <SharedSolanaClobPanel
      {...props}
      connectionOverride={connection}
      walletOverride={wallet}
    />
  );
}
