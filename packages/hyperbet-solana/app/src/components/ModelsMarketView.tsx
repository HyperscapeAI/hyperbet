import type { ComponentProps } from "react";
import { ModelsMarketView as SharedModelsMarketView } from "@hyperbet/ui/components/ModelsMarketView";

import {
  useAppConnection,
  useAppWallet,
  useAppWalletModal,
} from "../lib/appWallet";

type SharedProps = ComponentProps<typeof SharedModelsMarketView>;

export function ModelsMarketView(props: SharedProps) {
  const { connection } = useAppConnection();
  const wallet = useAppWallet();
  const walletModal = useAppWalletModal();

  return (
    <SharedModelsMarketView
      {...props}
      connectionOverride={connection}
      walletOverride={wallet}
      walletModalOverride={walletModal}
    />
  );
}
