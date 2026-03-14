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

export type LvrRouterMatch = {
  exists: boolean;
  duelKey: string;
  status: bigint;
  winner: bigint;
  nextOrderId: bigint;
  bestBid: bigint;
  bestAsk: bigint;
  totalAShares: bigint;
  totalBShares: bigint;
};

export type LvrRouterPosition = {
  aShares: bigint;
  bShares: bigint;
  aStake: bigint;
  bStake: bigint;
};

export type LvrRouterOrder = {
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

interface TypedContract<Self extends BaseContract> extends BaseContract {
  connect(runner: ContractRunner | null): Self;
  waitForDeployment(): Promise<this>;
  getAddress(): Promise<string>;
}

export interface LvrRouterContract extends TypedContract<LvrRouterContract> {
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
  getMarket(duelKey: BytesLike, marketKind: BigNumberish): Promise<LvrRouterMatch>;
  positions(marketKey: BytesLike, trader: string): Promise<LvrRouterPosition>;
  orders(marketKey: BytesLike, orderId: BigNumberish): Promise<LvrRouterOrder>;
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
  reportResult(
    duelKey: BytesLike,
    winner: BigNumberish,
    seed: BigNumberish,
    replayHash: BytesLike,
    resultHash: BytesLike,
    duelEndTs: BigNumberish,
    metadataUri: string,
  ): Promise<ContractTransactionResponse>;
  cancelDuel(
    duelKey: BytesLike,
    metadataUri: string,
  ): Promise<ContractTransactionResponse>;
  setReporter(
    reporter: string,
    enabled: boolean,
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
    metadataUri: string;
  }>;
}

export interface SkillOracleContract extends TypedContract<SkillOracleContract> {
  updateAgentSkill(
    agentId: BytesLike,
    mu: BigNumberish,
    sigma: BigNumberish,
  ): Promise<ContractTransactionResponse>;
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
  modifyPosition(
    agentId: BytesLike,
    marginDelta: BigNumberish,
    sizeDelta: BigNumberish,
  ): Promise<ContractTransactionResponse>;
  liquidate(
    agentId: BytesLike,
    trader: string,
  ): Promise<ContractTransactionResponse>;
  positions(agentId: BytesLike, trader: string): Promise<PerpPosition>;
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

export async function deployLvrRouter(
  admin: string,
  marketOperator: string,
  oracle: string,
  treasury: string,
  marketMaker: string,
  runner?: Signer,
): Promise<LvrRouterContract> {
  const factory = runner
    ? await ethers.getContractFactory("LvrRouter", runner)
    : await ethers.getContractFactory("LvrRouter");
  return (await factory.deploy(
    admin,
    marketOperator,
    oracle,
    treasury,
    marketMaker,
  )) as unknown as LvrRouterContract;
}

export async function deployDuelOutcomeOracle(
  admin: string,
  reporter: string,
  runner?: Signer,
): Promise<DuelOutcomeOracleContract> {
  const factory = runner
    ? await ethers.getContractFactory("DuelOutcomeOracle", runner)
    : await ethers.getContractFactory("DuelOutcomeOracle");
  return (await factory.deploy(
    admin,
    reporter,
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
