import { parseEther } from "viem";

import type { Market } from "./market";

/**
 * Sample markets for a deployment that cannot reach a chain.
 *
 * A public build has nowhere to read from: the only live contract sits on a Hardhat node
 * on someone's laptop, and Ritual's testnet RPC is down. Rather than serve an empty board
 * with an error on it, the app falls back to these — always behind a banner that says
 * plainly they are not chain data, and always with betting disabled, because there is
 * nothing to sign against.
 *
 * They are shaped to show the three outcomes the contract can reach, including the two
 * that matter most: a market that failed its reads rather than being talked into a NO,
 * and one whose scheduled executions never arrived at all.
 */
const CREATOR = "0x0000000000000000000000000000000000000000" as const;

function market(m: Partial<Market> & Pick<Market, "id" | "question">): Market {
  return {
    creator: CREATOR,
    oracleUrl: "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    jsonPath: ".ethereum.usd | floor",
    target: 4000n,
    comparator: 1, // GTE
    closeBlock: 1_000n,
    resolveBlock: 1_200n,
    scheduleId: 1n,
    totalYes: 0n,
    totalNo: 0n,
    state: 0,
    outcome: 0,
    attempts: 0,
    observedValue: 0n,
    invalidReason: "",
    ...m,
  } as Market;
}

export const DEMO_BLOCK = 1_120n;

/** Ritual Chain measured ~195ms when this was written. */
export const DEMO_BLOCK_TIME_MS = 195;

export const DEMO_MARKETS: Market[] = [
  market({
    id: 4n,
    question: "Will ETH/USD be at or above $4,000 when this market resolves?",
    totalYes: parseEther("3.2"),
    totalNo: parseEther("6.8"),
    // Far enough out that the sample market stays open for a visit rather than
    // expiring while someone reads the page.
    closeBlock: 22_120n,
    resolveBlock: 28_120n,
    state: 0, // Open
  }),
  market({
    id: 3n,
    question: "Will BTC/USD be at or above $100,000 when this market resolves?",
    oracleUrl: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    jsonPath: ".bitcoin.usd | floor",
    target: 100_000n,
    totalYes: parseEther("1.5"),
    totalNo: parseEther("4.5"),
    closeBlock: 900n,
    resolveBlock: 950n,
    state: 3, // Resolved
    outcome: 2, // NO
    attempts: 1,
    observedValue: 94_180n,
  }),
  market({
    id: 2n,
    question: "Will the Bitcoin chain be past block 900,000 when this market resolves?",
    oracleUrl: "https://blockchain.info/q/getblockcount",
    jsonPath: ".",
    target: 900_000n,
    comparator: 0, // GT
    totalYes: parseEther("5"),
    totalNo: parseEther("1.25"),
    closeBlock: 700n,
    resolveBlock: 760n,
    state: 3,
    outcome: 1, // YES
    attempts: 2,
    observedValue: 963_412n,
  }),
  market({
    id: 1n,
    question: "Will the demo oracle stay up until this market resolves?",
    oracleUrl: "https://oracle.example/api/down",
    jsonPath: ".price",
    totalYes: parseEther("2"),
    totalNo: parseEther("2"),
    closeBlock: 500n,
    resolveBlock: 560n,
    state: 4, // Invalid
    outcome: 0, // never became a NO
    attempts: 3,
    invalidReason: "http status not 200",
  }),
];
