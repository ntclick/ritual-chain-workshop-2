import { formatEther } from "viem";

import { COMPARATOR_LABEL, MARKET_STATE, OUTCOME } from "./presets";

/** The shape `getMarket` / `getMarkets` return, as viem decodes it. */
export type Market = {
  id: bigint;
  creator: `0x${string}`;
  question: string;
  oracleUrl: string;
  jsonPath: string;
  target: bigint;
  comparator: number;
  closeBlock: bigint;
  resolveBlock: bigint;
  scheduleId: bigint;
  totalYes: bigint;
  totalNo: bigint;
  state: number;
  outcome: number;
  attempts: number;
  observedValue: bigint;
  invalidReason: string;
};

export const STATE = { Open: 0, Closed: 1, Resolving: 2, Resolved: 3, Invalid: 4 } as const;
export const RESULT = { Unresolved: 0, Yes: 1, No: 2 } as const;

export const stateName = (m: Market) => MARKET_STATE[m.state] ?? "Unknown";
export const outcomeName = (m: Market) => OUTCOME[m.outcome] ?? "Unknown";
export const ruleText = (m: Market) =>
  `observed ${COMPARATOR_LABEL[m.comparator] ?? "?"} ${m.target.toString()}`;

export const pool = (m: Market) => m.totalYes + m.totalNo;

/** Implied probability of YES, straight from the pool split. */
export function yesPercent(m: Market): number {
  const total = pool(m);
  if (total === 0n) return 50;
  return Number((m.totalYes * 10_000n) / total) / 100;
}

/**
 * What one more unit staked on `isYes` would return if that side wins, as a multiple
 * of the stake. Pari-mutuel, so a side attracting less money pays more.
 */
export function payoutMultiple(m: Market, isYes: boolean, stake: bigint): number {
  const winning = (isYes ? m.totalYes : m.totalNo) + stake;
  const total = pool(m) + stake;
  if (winning === 0n) return 0;
  return Number((total * 10_000n) / winning) / 10_000;
}

/** A settled market pays nothing to the losing side, and refunds everyone if invalid. */
export function isSettled(m: Market) {
  return m.state === STATE.Resolved || m.state === STATE.Invalid;
}

export function isBettable(m: Market, currentBlock: bigint) {
  return m.state === STATE.Open && currentBlock < m.closeBlock;
}

export function ritual(amount: bigint, digits = 4): string {
  const value = Number(formatEther(amount));
  if (value === 0) return "0";
  if (value < 0.0001) return "<0.0001";
  return value.toFixed(digits).replace(/\.?0+$/, "");
}

/**
 * Blocks until `target`, rendered as a duration. Ritual Chain runs at roughly 195 ms,
 * but the contract's own `blockTimeMs` is the number that actually set the deadline,
 * so it is what we count with.
 */
export function blocksUntil(target: bigint, current: bigint, blockTimeMs: bigint): string {
  if (target <= current) return "now";
  const blocks = target - current;
  const seconds = Number((blocks * blockTimeMs) / 1000n);

  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
