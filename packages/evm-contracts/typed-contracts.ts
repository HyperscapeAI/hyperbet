import type {
  BaseContract,
  BigNumberish,
  BytesLike,
  ContractRunner,
  ContractTransactionResponse,
  Signer,
} from "ethers";
import { ethers } from "hardhat";

type PayableOverrides = {
  value?: BigNumberish;
};

export type GoldClobMatch = {
  exists: boolean;
  duelKey: string;
  status: bigint;
  winner: bigint;
  tradeTreasuryFeeBpsSnapshot: bigint;
  tradeMarketMakerFeeBpsSnapshot: bigint;
  winningsMarketMakerFeeBpsSnapshot: bigint;
  nextOrderId: bigint;
  bestBid: bigint;
  bestAsk: bigint;
  totalAShares: bigint;
  totalBShares: bigint;
};

export type GoldClobPosition = {
  aShares: bigint;
  bShares: bigint;
  aStake: bigint;
  bStake: bigint;
};

export type GoldClobOrder = {
  id: bigint;
  side: bigint;
  price: bigint;
  maker: string;
  amount: bigint;
  filled: bigint;
  prevOrderId: bigint;
  nextOrderId: bigint;
  active: boolean;
};

export type PerpPosition = {
  size: bigint;
  margin: bigint;
  entryPrice: bigint;
};

export type AgentPerpPosition = PerpPosition & {
  lastCumulativeFundingRate: bigint;
};

export type AgentPerpMarketConfig = {
  skewScale: bigint;
  maxLeverage: bigint;
  maintenanceMarginBps: bigint;
  liquidationRewardBps: bigint;
  maxOracleDelay: bigint;
  exists: boolean;
};

export type AgentPerpMarketState = {
  totalLongOI: bigint;
  totalShortOI: bigint;
  currentFundingRate: bigint;
  cumulativeFundingRate: bigint;
  lastFundingTimestamp: bigint;
  lastOraclePrice: bigint;
  lastConservativeSkill: bigint;
  lastOracleTimestamp: bigint;
  vaultBalance: bigint;
  insuranceFund: bigint;
  badDebt: bigint;
  status: bigint;
};

interface TypedContract<Self extends BaseContract> extends BaseContract {
  connect(runner: ContractRunner | null): Self;
  waitForDeployment(): Promise<this>;
  getAddress(): Promise<string>;
}

export interface GoldClobContract extends TypedContract<GoldClobContract> {
  createMarketForDuel(
    duelKey: BytesLike,
    marketKind: BigNumberish,
  ): Promise<ContractTransactionResponse>;
  placeOrder(
    duelKey: BytesLike,
    marketKind: BigNumberish,
    side: BigNumberish,
    price: BigNumberish,
    amount: BigNumberish,
    orderFlags: BigNumberish,
    overrides?: PayableOverrides,
  ): Promise<ContractTransactionResponse>;
  syncMarketFromOracle(
    duelKey: BytesLike,
    marketKind: BigNumberish,
  ): Promise<ContractTransactionResponse>;
  claim(
    duelKey: BytesLike,
    marketKind: BigNumberish,
  ): Promise<ContractTransactionResponse>;
  cancelOrder(
    duelKey: BytesLike,
    marketKind: BigNumberish,
    orderId: BigNumberish,
  ): Promise<ContractTransactionResponse>;
  getMarket(duelKey: BytesLike, marketKind: BigNumberish): Promise<GoldClobMatch>;
  positions(marketKey: BytesLike, trader: string): Promise<GoldClobPosition>;
  orders(marketKey: BytesLike, orderId: BigNumberish): Promise<GoldClobOrder>;
  getPriceLevel(
    duelKey: BytesLike,
    marketKind: BigNumberish,
    side: BigNumberish,
    price: BigNumberish,
  ): Promise<[bigint, bigint, bigint]>;
  marketKey(duelKey: BytesLike, marketKind: BigNumberish): Promise<string>;
  tradeTreasuryFeeBps(): Promise<bigint>;
  tradeMarketMakerFeeBps(): Promise<bigint>;
  winningsMarketMakerFeeBps(): Promise<bigint>;
  setFeeConfig(
    tradeTreasuryFeeBps: BigNumberish,
    tradeMarketMakerFeeBps: BigNumberish,
    winningsMarketMakerFeeBps: BigNumberish,
  ): Promise<ContractTransactionResponse>;
  setPauser(
    pauser: string,
    enabled: boolean,
  ): Promise<ContractTransactionResponse>;
  setMarketCreationPaused(
    paused: boolean,
  ): Promise<ContractTransactionResponse>;
  setOrderPlacementPaused(
    paused: boolean,
  ): Promise<ContractTransactionResponse>;
}

export interface DuelOutcomeOracleContract
  extends TypedContract<DuelOutcomeOracleContract> {
  upsertDuel(
    duelKey: BytesLike,
    participantAHash: BytesLike,
    participantBHash: BytesLike,
    betOpenTs: BigNumberish,
    betCloseTs: BigNumberish,
    duelStartTs: BigNumberish,
    metadataUri: string,
    status: BigNumberish,
  ): Promise<ContractTransactionResponse>;
  proposeResult(
    duelKey: BytesLike,
    winner: BigNumberish,
    seed: BigNumberish,
    replayHash: BytesLike,
    resultHash: BytesLike,
    duelEndTs: BigNumberish,
    metadataUri: string,
  ): Promise<ContractTransactionResponse>;
  challengeResult(
    duelKey: BytesLike,
    metadataUri: string,
  ): Promise<ContractTransactionResponse>;
  finalizeResult(
    duelKey: BytesLike,
    metadataUri: string,
  ): Promise<ContractTransactionResponse>;
  proposalId(
    duelKey: BytesLike,
    resultHash: BytesLike,
    replayHash: BytesLike,
  ): Promise<string>;
  cancelDuel(
    duelKey: BytesLike,
    metadataUri: string,
  ): Promise<ContractTransactionResponse>;
  setReporter(
    reporter: string,
    enabled: boolean,
  ): Promise<ContractTransactionResponse>;
  setFinalizer(
    finalizer: string,
    enabled: boolean,
  ): Promise<ContractTransactionResponse>;
  setChallenger(
    challenger: string,
    enabled: boolean,
  ): Promise<ContractTransactionResponse>;
  setPauser(
    pauser: string,
    enabled: boolean,
  ): Promise<ContractTransactionResponse>;
  setOraclePaused(
    paused: boolean,
  ): Promise<ContractTransactionResponse>;
  getDuel(duelKey: BytesLike): Promise<{
    duelKey: string;
    participantAHash: string;
    participantBHash: string;
    status: bigint;
    winner: bigint;
    betOpenTs: bigint;
    betCloseTs: bigint;
    duelStartTs: bigint;
    duelEndTs: bigint;
    seed: bigint;
    resultHash: string;
    replayHash: string;
    activeProposalId: string;
    metadataUri: string;
  }>;
  disputeWindowSeconds(): Promise<bigint>;
  oracleActionsPaused(): Promise<boolean>;
  REPORTER_ROLE(): Promise<string>;
  FINALIZER_ROLE(): Promise<string>;
  CHALLENGER_ROLE(): Promise<string>;
  PAUSER_ROLE(): Promise<string>;
  hasRole(role: BytesLike, account: string): Promise<boolean>;
}

export interface SkillOracleContract extends TypedContract<SkillOracleContract> {
  updateAgentSkill(
    agentId: BytesLike,
    mu: BigNumberish,
    sigma: BigNumberish,
  ): Promise<ContractTransactionResponse>;
  setReporter(
    reporter: string,
    enabled: boolean,
  ): Promise<ContractTransactionResponse>;
  agentSkills(agentId: BytesLike): Promise<{
    mu: bigint;
    sigma: bigint;
    lastUpdate: bigint;
  }>;
  getIndexPrice(agentId: BytesLike): Promise<bigint>;
  globalMeanMu(): Promise<bigint>;
}

export interface MockERC20Contract extends TypedContract<MockERC20Contract> {
  mint(to: string, amount: BigNumberish): Promise<ContractTransactionResponse>;
  approve(
    spender: string,
    amount: BigNumberish,
  ): Promise<ContractTransactionResponse>;
  balanceOf(account: string): Promise<bigint>;
}

export interface AgentPerpEngineContract extends TypedContract<AgentPerpEngineContract> {
  createMarket(agentId: BytesLike): Promise<ContractTransactionResponse>;
  createMarket(
    agentId: BytesLike,
    skewScale: BigNumberish,
    maxLeverage: BigNumberish,
    maintenanceMarginBps: BigNumberish,
    liquidationRewardBps: BigNumberish,
    maxOracleDelay: BigNumberish,
  ): Promise<ContractTransactionResponse>;
  updateMarketConfig(
    agentId: BytesLike,
    skewScale: BigNumberish,
    maxLeverage: BigNumberish,
    maintenanceMarginBps: BigNumberish,
    liquidationRewardBps: BigNumberish,
    maxOracleDelay: BigNumberish,
  ): Promise<ContractTransactionResponse>;
  modifyPosition(
    agentId: BytesLike,
    marginDelta: BigNumberish,
    sizeDelta: BigNumberish,
  ): Promise<ContractTransactionResponse>;
  withdrawMargin(
    agentId: BytesLike,
    amount: BigNumberish,
  ): Promise<ContractTransactionResponse>;
  liquidate(
    agentId: BytesLike,
    trader: string,
  ): Promise<ContractTransactionResponse>;
  depositInsuranceFund(
    agentId: BytesLike,
    amount: BigNumberish,
  ): Promise<ContractTransactionResponse>;
  withdrawInsuranceFund(
    agentId: BytesLike,
    to: string,
    amount: BigNumberish,
  ): Promise<ContractTransactionResponse>;
  setMarketStatus(
    agentId: BytesLike,
    status: BigNumberish,
  ): Promise<ContractTransactionResponse>;
  syncOracle(agentId: BytesLike): Promise<ContractTransactionResponse>;
  marketCount(): Promise<bigint>;
  marketConfigs(agentId: BytesLike): Promise<AgentPerpMarketConfig>;
  markets(agentId: BytesLike): Promise<AgentPerpMarketState>;
  positions(agentId: BytesLike, trader: string): Promise<AgentPerpPosition>;
}

export interface AgentPerpEngineNativeContract extends TypedContract<AgentPerpEngineNativeContract> {
  modifyPosition(
    agentId: BytesLike,
    sizeDelta: BigNumberish,
    overrides?: PayableOverrides,
  ): Promise<ContractTransactionResponse>;
  withdrawMargin(
    agentId: BytesLike,
    amount: BigNumberish,
  ): Promise<ContractTransactionResponse>;
  positions(agentId: BytesLike, trader: string): Promise<PerpPosition>;
}

export async function deployGoldClob(
  admin: string,
  marketOperator: string,
  oracle: string,
  treasury: string,
  marketMaker: string,
  pauser: string,
  runner?: Signer,
): Promise<GoldClobContract> {
  const factory = runner
    ? await ethers.getContractFactory("GoldClob", runner)
    : await ethers.getContractFactory("GoldClob");
  return (await factory.deploy(
    admin,
    marketOperator,
    oracle,
    treasury,
    marketMaker,
    pauser,
  )) as unknown as GoldClobContract;
}

export async function deployDuelOutcomeOracle(
  admin: string,
  reporter: string,
  finalizer: string,
  challenger: string,
  pauser: string,
  disputeWindowSeconds: bigint | number = 3600,
  runner?: Signer,
): Promise<DuelOutcomeOracleContract> {
  const factory = runner
    ? await ethers.getContractFactory("DuelOutcomeOracle", runner)
    : await ethers.getContractFactory("DuelOutcomeOracle");
  return (await factory.deploy(
    admin,
    reporter,
    finalizer,
    challenger,
    pauser,
    disputeWindowSeconds,
  )) as unknown as DuelOutcomeOracleContract;
}

export async function deploySkillOracle(
  initialBasePrice: BigNumberish,
  runner?: Signer,
): Promise<SkillOracleContract> {
  const factory = runner
    ? await ethers.getContractFactory("SkillOracle", runner)
    : await ethers.getContractFactory("SkillOracle");
  return (await factory.deploy(
    initialBasePrice,
  )) as unknown as SkillOracleContract;
}

export async function deployMockErc20(
  name: string,
  symbol: string,
  runner?: Signer,
): Promise<MockERC20Contract> {
  const factory = runner
    ? await ethers.getContractFactory("MockERC20", runner)
    : await ethers.getContractFactory("MockERC20");
  return (await factory.deploy(name, symbol)) as unknown as MockERC20Contract;
}

export async function deployAgentPerpEngine(
  oracleAddress: string,
  marginTokenAddress: string,
  skewScale: BigNumberish,
  runner?: Signer,
): Promise<AgentPerpEngineContract> {
  const factory = runner
    ? await ethers.getContractFactory("AgentPerpEngine", runner)
    : await ethers.getContractFactory("AgentPerpEngine");
  return (await factory.deploy(
    oracleAddress,
    marginTokenAddress,
    skewScale,
  )) as unknown as AgentPerpEngineContract;
}

export async function deployAgentPerpEngineNative(
  oracleAddress: string,
  skewScale: BigNumberish,
  runner?: Signer,
): Promise<AgentPerpEngineNativeContract> {
  const factory = runner
    ? await ethers.getContractFactory("AgentPerpEngineNative", runner)
    : await ethers.getContractFactory("AgentPerpEngineNative");
  return (await factory.deploy(
    oracleAddress,
    skewScale,
  )) as unknown as AgentPerpEngineNativeContract;
}
