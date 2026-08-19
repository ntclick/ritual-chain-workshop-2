/**
 * Enum mirrors and the preset workshop market.
 *
 * Kept in step with hardhat/scripts/market-presets.ts and the enums in
 * contracts/RitualPredict.sol — if one side changes, change both.
 */

/** RitualPredict.Comparator */
export const COMPARATOR = { gt: 0, gte: 1, lt: 2, lte: 3 } as const;

export type ComparatorKey = keyof typeof COMPARATOR;

export const COMPARATOR_LABEL: Record<number, string> = {
  0: "＞",
  1: "≥",
  2: "＜",
  3: "≤",
};

/** RitualPredict.MarketState */
export const MARKET_STATE = ["Open", "Closed", "Resolving", "Resolved", "Invalid"] as const;
export type MarketStateName = (typeof MARKET_STATE)[number];

/** RitualPredict.Outcome */
export const OUTCOME = ["Unresolved", "YES", "NO"] as const;

/** The preset workshop market: short enough to demo end to end in a few minutes. */
export const DEMO_MARKET = {
  question: "Will ETH/USD be at least $4,000 when this market resolves?",
  oracleUrl: process.env.NEXT_PUBLIC_DEMO_ORACLE_URL ?? "http://localhost:3000/api/oracle/eth",
  jsonPath: ".price",
  target: 4000n,
  comparator: "gte" as ComparatorKey,
  bettingSeconds: 180n,
  resolveDelaySeconds: 60n,
} as const;

/** Mirrors the contract's own bounds, so the form can reject before the chain does. */
export const LIMITS = {
  minBettingSeconds: 30n,
  minResolveDelaySeconds: 15n,
  maxMarketSeconds: 86_400n,
} as const;
