"use client";

import { SUPPORTED_CHAINS } from "@/lib/chains";
import type { useWallet } from "@/hooks/useWallet";

/**
 * Blocks an action that cannot succeed yet, and offers the fix in the same place.
 *
 * Without this the wallet layer throws "Switch to a supported network first" *after*
 * the click, which names the problem and then leaves the reader to go find the network
 * selector on their own. Returns null when the action is fine to attempt.
 */
export function NetworkGate({ wallet }: { wallet: ReturnType<typeof useWallet> }) {
  if (!wallet.account) {
    return <p className="hint">Connect a wallet first.</p>;
  }
  if (wallet.isSupportedChain) return null;

  return (
    <div className="banner banner-warn stack" style={{ gap: "0.5rem" }}>
      <span>
        Your wallet is on an unsupported network
        {wallet.chainId ? ` (chain ${wallet.chainId})` : ""}, so this action would fail.
      </span>
      <div className="row">
        {SUPPORTED_CHAINS.map((chain) => (
          <button
            key={chain.id}
            className="btn btn-sm"
            onClick={() => void wallet.requestChain(chain.id)}
          >
            Switch to {chain.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** True when a write is worth enabling at all. */
export function canTransact(wallet: ReturnType<typeof useWallet>): boolean {
  return Boolean(wallet.account) && wallet.isSupportedChain;
}
