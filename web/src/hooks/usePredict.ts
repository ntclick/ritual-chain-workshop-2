"use client";

import { useCallback, useEffect, useState } from "react";
import { isAddress } from "viem";

import type { Market } from "@/lib/market";
import { predictAbi } from "@/lib/predict-abi";
import type { useWallet } from "./useWallet";

const STORAGE_KEY = "ritual-predict:address";

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

  const refresh = useCallback(async () => {
    if (!address) {
      setData(undefined);
      setLoading(false);
      return;
    }

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

      setData({
        markets: markets as unknown as Market[],
        currentBlock,
        blockTimeMs: blockTimeMs as bigint,
        executionBalance: executionBalance as bigint,
        maxAttempts: Number(maxAttempts),
      });
      setError(undefined);
    } catch (cause) {
      // Name the chain. Reads follow the wallet's network, so the usual cause is a
      // wallet sitting on Ritual Chain — whose public RPC is currently down — while the
      // contract is actually deployed on the local node, and the old message gave no
      // hint which of the two to go and change.
      setError(
        `Could not read ${address} on ${chain.name}. Either the contract is not ` +
          `deployed on that network, or its RPC is unreachable. Check the network selector above.`,
      );
      void cause;
    } finally {
      setLoading(false);
    }
  }, [address, publicClient, chain]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  return { data, error, loading, refresh };
}
