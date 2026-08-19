"use client";

import { useEffect, useState } from "react";

import { usePredictAddress } from "@/hooks/usePredict";
import { useWallet } from "@/hooks/useWallet";
import { pool, ritual, type Market } from "@/lib/market";
import { predictAbi } from "@/lib/predict-abi";

/**
 * Live figures on the landing page, read straight from the contract.
 *
 * Renders nothing at all when there is no deployment configured or the chain is
 * unreachable. A marketing page that shows "0" or an error where a number should be is
 * worse than one that simply does not show the row.
 */
export function LiveStats() {
  const wallet = useWallet();
  const { address } = usePredictAddress();
  const [stats, setStats] = useState<{ markets: number; volume: bigint; block: bigint }>();

  useEffect(() => {
    if (!address) return;
    let cancelled = false;

    void (async () => {
      try {
        const [markets, block] = await Promise.all([
          wallet.publicClient.readContract({
            address,
            abi: predictAbi,
            functionName: "getMarkets",
          }) as Promise<unknown> as Promise<Market[]>,
          wallet.publicClient.getBlockNumber(),
        ]);
        if (cancelled) return;
        setStats({
          markets: markets.length,
          volume: markets.reduce((sum, m) => sum + pool(m), 0n),
          block,
        });
      } catch {
        // Silence is the correct output here.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, wallet.publicClient]);

  if (!stats) return null;

  return (
    <div className="hero-stats">
      <div className="hero-stat">
        <b>{stats.markets}</b>
        <span className="label">Markets</span>
      </div>
      <div className="hero-stat">
        <b>{ritual(stats.volume)}</b>
        <span className="label">RITUAL staked</span>
      </div>
      <div className="hero-stat">
        <b>{stats.block.toString()}</b>
        <span className="label">Block · {wallet.chain.name}</span>
      </div>
    </div>
  );
}
