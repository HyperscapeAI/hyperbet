import { useAppConnection, useAppWallet, useAppWalletModal } from "../lib/solanaRuntime";
import {
  ModelsMarketViewRuntime,
  type ModelsMarketViewProps,
} from "./ModelsMarketView";

type SolanaModelsMarketViewProps = Pick<ModelsMarketViewProps, "activeMatchup">;

export function SolanaModelsMarketView({
  activeMatchup,
}: SolanaModelsMarketViewProps) {
  const { connection } = useAppConnection();
  const wallet = useAppWallet();
  const walletModal = useAppWalletModal();

  return (
    <ModelsMarketViewRuntime
      activeMatchup={activeMatchup}
      connection={connection}
      wallet={wallet}
      setWalletModalVisible={walletModal.setVisible}
    />
  );
}
