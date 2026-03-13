import { ethers } from "ethers";
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { resolveBettingEvmRuntimeEnv, resolveBettingSolanaDeployment, BETTING_EVM_CHAIN_ORDER } from "@hyperbet/chain-registry";
import lvrAmmIdl from "./idl/lvr_amm.json" with { type: "json" };
import dotenv from "dotenv";
dotenv.config();

const ROUTER_ABI = [
    "function buyYes(address market, uint256 amountIn) external",
    "function buyNo(address market, uint256 amountIn) external",
    "function sellYes(address market, uint256 amountIn) external",
    "function sellNo(address market, uint256 amountIn) external",
];

const MARKET_ABI = [
    "function calcPrice() external view returns (uint256, uint256)",
    "function isDynamic() external view returns (bool)",
    "function reserves(uint256) external view returns (uint256)",
];

const TARGET_SPREAD_BPS = 200; // 2% 
const SNIPE_AMOUNT_USD = 100; // $100 equivalent in 1e18 or lamports

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export class LvrSniperBot {
    private evmProviders: Record<string, ethers.JsonRpcProvider> = {};
    private evmWallets: Record<string, ethers.Wallet> = {};

    constructor() {
        console.log("Initializing LvrSniperBot...");
        const privKey = process.env.EVM_PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
        for (const chain of BETTING_EVM_CHAIN_ORDER) {
            try {
                const env = resolveBettingEvmRuntimeEnv(chain, "localnet", process.env);
                this.evmProviders[chain] = new ethers.JsonRpcProvider(env.rpcUrl);
                this.evmWallets[chain] = new ethers.Wallet(privKey, this.evmProviders[chain]);
                console.log(`[EVM] Connected ${chain} sniper.`);
            } catch (e) {
                console.warn(`[EVM] Skipping ${chain}: ` + (e as Error).message);
            }
        }
    }

    async getSignalPrice(): Promise<number> {
        // Mock external oracle
        return 0.60; 
    }

    async evmSnipe(chain: string, marketAddress: string, routerAddress: string) {
        const wallet = this.evmWallets[chain];
        if (!wallet) return;

        const market = new ethers.Contract(marketAddress, MARKET_ABI, wallet);
        const router = new ethers.Contract(routerAddress, ROUTER_ABI, wallet);

        try {
            const [priceYes, priceNo] = await market.calcPrice();
            const pYes = Number(priceYes) / 1000000;

            const signal = await this.getSignalPrice();
            const spreadThreshold = TARGET_SPREAD_BPS / 10000;

            if (signal - pYes > spreadThreshold) {
                // Yes is underpriced -> Buy Yes
                console.log(`[${chain.toUpperCase()}] Sniping YES (Signal: ${signal}, AMM: ${pYes})`);
                await (await router.buyYes(marketAddress, ethers.parseEther(SNIPE_AMOUNT_USD.toString()))).wait();
            } else if (pYes - signal > spreadThreshold) {
                // Yes is overpriced -> Sell Yes / Buy No
                console.log(`[${chain.toUpperCase()}] Sniping NO (Signal: ${signal}, AMM: ${pYes})`);
                await (await router.buyNo(marketAddress, ethers.parseEther(SNIPE_AMOUNT_USD.toString()))).wait();
            }
        } catch (e) {
            console.error(`[EVM Snipe Error] ${chain}: ${(e as Error).message}`);
        }
    }

    async solanaSnipe(programIdString: string, betPdaString: string) {
        try {
            const privKey = process.env.SOLANA_PRIVATE_KEY;
            if (!privKey) return;
            // Similar logic for Solana... getting PDA price via IDL and sending CPI to buy/sell
            console.log(`[SOLANA] Sniping loop active.`);
        } catch (e) {}
    }

    async run() {
        while (true) {
            console.log("Polling AMM states...");
            // Example run against a known market if exists, else wait
            await sleep(2000);
        }
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    new LvrSniperBot().run().catch(console.error);
}
