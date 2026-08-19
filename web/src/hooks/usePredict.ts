"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isAddress } from "viem";

import { DEMO_BLOCK, DEMO_BLOCK_TIME_MS, DEMO_MARKETS } from "@/lib/demo";
import type { Market } from "@/lib/market";
import { predictAbi } from "@/lib/predict-abi";
import type { useWallet } from "./useWallet";

const STORAGE_KEY = "ritual-predict:address";

/** No new block for this long and the clock estimates stop meaning anything. */
const IDLE_AFTER_MS = 20_000;

/**
 * Sample data stands in only when there is genuinely nothing to read: no contract
 * configured, or the configured one is unreachable. A successful read always wins, so a
 * working deployment can never be masked by the preview.
 */
const DEMO_DATA: Omit<PredictData, "currentBlock" | "observedAt"> = {
  markets: DEMO_MARKETS,
  chainIdle: false,
  isDemo: true,
  blockTimeMs: BigInt(DEMO_BLOCK_TIME_MS),
  executionBalance: 500_000_000_000_000_000n,
  maxAttempts: 3,
};

/**
 * The sample board advances its own block height.
 *
 * A frozen counter under a market labelled "Open" reads as a broken page — which is the
 * failure this project is otherwise about. The preview is already declared as sample
 * data, so letting it keep time is not a claim about any chain; it is the difference
 * between a still image and a plausible one. `observedAt` is set to the moment the
 * current block would have arrived, which is what lets the countdown interpolate
 * smoothly between polls instead of stepping.
 */
function demoDataAt(startedAt: number): PredictData {
  const elapsed = Math.max(0, Date.now() - startedAt);
  const mined = Math.floor(elapsed / DEMO_BLOCK_TIME_MS);
  return {
    ...DEMO_DATA,
    currentBlock: DEMO_BLOCK + BigInt(mined),
    observedAt: startedAt + mined * DEMO_BLOCK_TIME_MS,
  };
}

/**
 * The deployed market contract.
 *
 * Configured at build time with NEXT_PUBLIC_PREDICT_ADDRESS, but overridable at runtime
 * and remembered locally — a fresh deployment during a workshop should not need a
 * rebuild to point the UI at it.
 */
export function usePredictAddress() {
  const fromEnv = process.env.NEXT_PUBLIC_PREDICT_ADDRESS;
  const [address, setAddress] = useState<`0x${string}` | undefined>(
    fromEnv && isAddress(fromEnv) ? (fromEnv as `0x${string}`) : undefined,
  );

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && isAddress(stored)) setAddress(stored as `0x${string}`);
  }, []);

  const update = useCallback((next: string) => {
    if (!isAddress(next)) return false;
    window.localStorage.setItem(STORAGE_KEY, next);
    setAddress(next as `0x${string}`);
    return true;
  }, []);

  return { address, setAddress: update };
}

export type PredictData = {
  markets: Market[];
  currentBlock: bigint;
  /**
   * Wall clock when this block number was *first* seen — not when it was last polled.
   * Anchoring to the poll instead makes a countdown saw-tooth: every read resets the
   * elapsed time and the remaining figure jumps back up.
   */
  observedAt: number;
  /** The chain has not produced a block for a while — countdowns are fiction. */
  chainIdle: boolean;
  /** These are sample markets, not chain data. Never true when a read succeeded. */
  isDemo: boolean;
  blockTimeMs: bigint;
  executionBalance: bigint;
  maxAttempts: number;
};

/**
 * Polls the contract.
 *
 * There is no event subscription here on purpose: resolution happens inside a
 * Scheduler-driven transaction that this UI never sends, so the only way to see it is
 * to keep asking. Polling is also the honest model for "the market resolves itself
 * whether or not anyone is watching".
 */
export function usePredict(
  wallet: ReturnType<typeof useWallet>,
  address: `0x${string}` | undefined,
  intervalMs = 3_000,
) {
  const { publicClient, chain } = wallet;
  const [data, setData] = useState<PredictData | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  // A slow chain must not let polls pile up on top of each other.
  const inFlight = useRef(false);
  // Which (contract, chain) the newest request belongs to. A read started before the
  // user switched networks can still resolve afterwards, and without this it would
  // write another chain's markets into the view it no longer belongs to.
  const requestKey = useRef("");
  // Last time the block number actually moved, used to spot a stalled chain.
  const lastBlock = useRef<{ number: bigint; at: number }>({ number: -1n, at: 0 });
  // When the preview started, so its block height can climb from there.
  const demoStart = useRef(0);

  const refresh = useCallback(async () => {
    if (!address) {
      if (!demoStart.current) demoStart.current = Date.now();
      setData(demoDataAt(demoStart.current));
      setLoading(false);
      return;
    }
    // Claim the key *before* bailing out on an in-flight read. Skipping that step lets
    // a read still running against the previous chain finish, find its own key intact,
    // and publish that chain's markets into a view that has already moved on.
    const key = `${address}@${chain.id}`;
    requestKey.current = key;

    if (inFlight.current) return;
    inFlight.current = true;

    try {
      const contract = { address, abi: predictAbi } as const;
      const [markets, currentBlock, blockTimeMs, executionBalance, maxAttempts] =
        await Promise.all([
          publicClient.readContract({ ...contract, functionName: "getMarkets" }),
          publicClient.getBlockNumber(),
          publicClient.readContract({ ...contract, functionName: "blockTimeMs" }),
          publicClient.readContract({ ...contract, functionName: "executionBalance" }),
          publicClient.readContract({ ...contract, functionName: "MAX_ATTEMPTS" }),
        ]);

      if (requestKey.current !== key) return; // superseded by a network switch
      const seenAt = Date.now();
      if (currentBlock !== lastBlock.current.number) {
        lastBlock.current = { number: currentBlock, at: seenAt };
      }

      setData({
        markets: markets as unknown as Market[],
        currentBlock,
        observedAt: lastBlock.current.at,
        isDemo: false,
        chainIdle: seenAt - lastBlock.current.at > IDLE_AFTER_MS,
        blockTimeMs: blockTimeMs as bigint,
        executionBalance: executionBalance as bigint,
        maxAttempts: Number(maxAttempts),
      });
      setError(undefined);
    } catch (cause) {
      if (requestKey.current !== key) return;
      // Name the chain being read. The usual cause is viewing Ritual Chain — whose
      // public RPC is currently down — while the contract lives on the local node, and
      // an unnamed "network unreachable" gives no hint which of the two to change.
      if (!demoStart.current) demoStart.current = Date.now();
      setData((prev) => (prev && !prev.isDemo ? prev : demoDataAt(demoStart.current)));
      setError(
        `Could not read ${address} on ${chain.name}. Either the contract is not ` +
          `deployed on that network, or its RPC is unreachable. Check the network selector above.`,
      );
      void cause;
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [address, publicClient, chain]);

  useEffect(() => {
    setData(undefined);
    setLoading(true);
    void refresh();
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  return { data, error, loading, refresh };
}
