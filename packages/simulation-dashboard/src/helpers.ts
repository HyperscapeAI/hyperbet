import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ethers } from "ethers";

// ─── Contract Constants ──────────────────────────────────────────────────────
export const MARKET_KIND_DUEL_WINNER = 0;
export const DUEL_STATUS_BETTING_OPEN = 2;
export const SIDE_A = 1;
export const SIDE_B = 2;
export const BUY_SIDE = 1;
export const SELL_SIDE = 2;
export const MAX_PRICE = 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────
export function duelKey(label: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(label));
}

export function hashParticipant(label: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(label));
}

export function quoteCost(
    side: number,
    price: number,
    amount: bigint,
): bigint {
    const component = BigInt(side === BUY_SIDE ? price : MAX_PRICE - price);
    return (amount * component) / BigInt(MAX_PRICE);
}

export function quoteWithFees(
    side: number,
    price: number,
    amount: bigint,
    treasuryFeeBps: bigint,
    mmFeeBps: bigint,
): bigint {
    const cost = quoteCost(side, price, amount);
    const treasuryFee = (cost * treasuryFeeBps) / 10_000n;
    const mmFee = (cost * mmFeeBps) / 10_000n;
    return cost + treasuryFee + mmFee;
}

export type Artifact = {
    abi: readonly unknown[];
    bytecode: string;
};

export function loadArtifact(contractsDir: string, name: string): Artifact {
    const foundryPath = join(
        contractsDir,
        "out",
        `${name}.sol`,
        `${name}.json`,
    );
    try {
        return JSON.parse(readFileSync(foundryPath, "utf8")) as Artifact;
    } catch {
        // Fall back to Hardhat artifacts.
    }

    // Try the nested contracts/<name>.sol/<name>.json format first
    const nestedPath = join(
        contractsDir,
        "artifacts",
        "contracts",
        `${name}.sol`,
        `${name}.json`,
    );
    try {
        return JSON.parse(readFileSync(nestedPath, "utf8")) as Artifact;
    } catch {
        // Try perps subdirectory
        const perpsPath = join(
            contractsDir,
            "artifacts",
            "contracts",
            "perps",
            `${name}.sol`,
            `${name}.json`,
        );
        return JSON.parse(readFileSync(perpsPath, "utf8")) as Artifact;
    }
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    reject(new Error(`${label} timed out after ${ms}ms`));
                }, ms);
            }),
        ]);
    } finally {
        if (timer != null) {
            clearTimeout(timer);
        }
    }
}

let randomSource: () => number = () => Math.random();

function hashSeed(seed: string | number): number {
    const value = String(seed);
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function mulberry32(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let next = state;
        next = Math.imul(next ^ (next >>> 15), next | 1);
        next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
        return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
    };
}

export function random(): number {
    return randomSource();
}

export function setRandomSeed(seed: string | number): void {
    randomSource = mulberry32(hashSeed(seed));
}

export function resetRandomSource(): void {
    randomSource = () => Math.random();
}

export function randomInt(min: number, max: number): number {
    return Math.floor(random() * (max - min + 1)) + min;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function formatEth(wei: bigint): string {
    return ethers.formatEther(wei);
}

export function shortAddr(addr: string): string {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
