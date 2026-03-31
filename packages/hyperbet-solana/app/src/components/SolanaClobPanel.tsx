import type { ComponentProps } from "react";
import {
  SolanaClobPanel as SharedSolanaClobPanel,
  type SolanaClobMarketSnapshot,
} from "@hyperbet/ui/components/SolanaClobPanel";

import { useAppConnection, useAppWallet } from "../lib/appWallet";

type WrapperProps = Omit<ComponentProps<typeof SharedSolanaClobPanel>, "connectionOverride" | "walletOverride">;

export type { SolanaClobMarketSnapshot };

export function SolanaClobPanel(props: WrapperProps) {
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
