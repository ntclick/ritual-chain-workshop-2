/**
 * Enum mirrors and the market templates offered by the create form.
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

/** Mirrors the contract's own bounds, so the form can reject before the chain does. */
export const LIMITS = {
  minBettingSeconds: 30n,
  minResolveDelaySeconds: 15n,
  maxMarketSeconds: 86_400n,
} as const;

export type MarketTemplate = {
  id: string;
  label: string;
  group: string;
  question: string;
  oracleUrl: string;
  jsonPath: string;
  target: bigint;
  comparator: ComparatorKey;
  bettingSeconds: bigint;
  resolveDelaySeconds: bigint;
  /** Why the filter is written the way it is. The jq step is where markets die. */
  note: string;
};

/**
 * Where this app serves its own demo oracle.
 *
 * Derived from the origin the page is actually loaded from rather than a hardcoded
 * port — Next.js moves to 3001 whenever 3000 is taken, and a preset pointing at the
 * wrong port produces a market that can never resolve. The literal is only the
 * server-render fallback; `NEXT_PUBLIC_DEMO_ORACLE_URL` still wins when set, which is
 * how you point at a tunnel.
 */
export function demoOracleUrl(): string {
  if (process.env.NEXT_PUBLIC_DEMO_ORACLE_URL) {
    return process.env.NEXT_PUBLIC_DEMO_ORACLE_URL;
  }
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/oracle/eth`;
  }
  return "http://localhost:3000/api/oracle/eth";
}

const DEMO_ORACLE = demoOracleUrl();

/**
 * Every template resolves to a **non-negative integer**, because the jq precompile is
 * asked for a uint256. That is the whole trick: a float or a string extracts as zero,
 * and jq does not revert when a filter matches nothing — it returns empty output, which
 * the contract then reports as "jq extraction failed". So prices are floored, string
 * fields go through `tonumber`, and nothing here can go negative.
 */
export const MARKET_TEMPLATES: MarketTemplate[] = [
  {
    id: "demo-eth",
    label: "ETH ≥ $4,000",
    group: "Workshop",
    question: "Will ETH/USD be at least $4,000 when this market resolves?",
    oracleUrl: DEMO_ORACLE,
    jsonPath: ".price",
    target: 4000n,
    comparator: "gte",
    bettingSeconds: 180n,
    resolveDelaySeconds: 60n,
    note: "The workshop preset. This app's own /api/oracle/eth already floors the price to an integer, so the filter is just .price.",
  },
  {
    id: "eth-live",
    label: "ETH ≥ $4,000 (CoinGecko)",
    group: "Crypto",
    question: "Will ETH/USD be at least $4,000 on CoinGecko when this market resolves?",
    oracleUrl: "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    jsonPath: ".ethereum.usd | floor",
    target: 4000n,
    comparator: "gte",
    bettingSeconds: 180n,
    resolveDelaySeconds: 60n,
    note: "CoinGecko returns a float. Without | floor the value extracts as 0 and the market resolves NO for the wrong reason.",
  },
  {
    id: "btc-100k",
    label: "BTC ≥ $100,000",
    group: "Crypto",
    question: "Will BTC/USD be at least $100,000 when this market resolves?",
    oracleUrl: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    jsonPath: ".bitcoin.usd | floor",
    target: 100_000n,
    comparator: "gte",
    bettingSeconds: 300n,
    resolveDelaySeconds: 60n,
    note: "Same shape as the ETH feed, different id. Change ids= and the filter together or the filter matches nothing.",
  },
  {
    id: "eth-cents",
    label: "ETH ≥ $4,000.50 (cents)",
    group: "Crypto",
    question: "Will ETH/USD be at least $4,000.50 when this market resolves?",
    oracleUrl: "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    jsonPath: ".ethereum.usd * 100 | floor",
    target: 400_050n,
    comparator: "gte",
    bettingSeconds: 180n,
    resolveDelaySeconds: 60n,
    note: "uint256 has no decimals, so scale by 100 in jq and scale the target to match. This is how you ask a sub-dollar question.",
  },
  {
    id: "btc-height",
    label: "Bitcoin block height",
    group: "Chain",
    question: "Will the Bitcoin chain be past block 900,000 when this market resolves?",
    oracleUrl: "https://blockchain.info/q/getblockcount",
    jsonPath: ".",
    target: 900_000n,
    comparator: "gt",
    bettingSeconds: 300n,
    resolveDelaySeconds: 60n,
    note: "The endpoint returns a bare number, which is still valid JSON, so the whole document is the value: the filter is just a dot.",
  },
  {
    id: "gh-stars",
    label: "GitHub stars",
    group: "World",
    question: "Will ritual-foundation/ritual-dapp-skills have at least 50 stars?",
    oracleUrl: "https://api.github.com/repos/ritual-foundation/ritual-dapp-skills",
    jsonPath: ".stargazers_count",
    target: 50n,
    comparator: "gte",
    bettingSeconds: 300n,
    resolveDelaySeconds: 60n,
    note: "Already an integer, so no conversion. Note the executor is unauthenticated, and GitHub rate-limits by IP — a 403 counts as a failed read, never a NO.",
  },
  {
    id: "weather",
    label: "Hanoi temperature",
    group: "World",
    question: "Will it be at least 30°C in Hanoi when this market resolves?",
    oracleUrl:
      "https://api.open-meteo.com/v1/forecast?latitude=21.03&longitude=105.85&current=temperature_2m",
    jsonPath: ".current.temperature_2m | floor",
    target: 30n,
    comparator: "gte",
    bettingSeconds: 300n,
    resolveDelaySeconds: 60n,
    note: "Works because Hanoi never goes below freezing. A negative reading cannot be expressed as a uint256 — for a cold city, add an offset in jq and to the target.",
  },
];

/** The workshop preset, still exported under its old name for the scripts' sake. */
export const DEMO_MARKET = MARKET_TEMPLATES[0]!;

export const BLANK_TEMPLATE: MarketTemplate = {
  id: "custom",
  label: "Write your own",
  group: "Custom",
  question: "",
  oracleUrl: "",
  jsonPath: "",
  target: 0n,
  comparator: "gte",
  bettingSeconds: 180n,
  resolveDelaySeconds: 60n,
  note: "Any endpoint that returns JSON works, as long as your filter reduces it to one non-negative integer.",
};
