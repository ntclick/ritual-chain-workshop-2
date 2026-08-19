"use client";

import { createPublicClient, createWalletClient, custom, http, type Chain } from "viem";

import { chainById, localChain, SUPPORTED_CHAINS } from "./chains";

/** The EIP-1193 provider an injected wallet puts on `window`. */
export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: never[]) => void) => void;
  removeListener?: (event: string, handler: (...args: never[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function getProvider(): Eip1193Provider | undefined {
  return typeof window === "undefined" ? undefined : window.ethereum;
}

/**
 * A read client for `chain`. Reads go straight to the RPC rather than through the
 * wallet, so the market list keeps refreshing even while no wallet is connected.
 */
export function readClient(chain: Chain) {
  // An unreachable RPC does not necessarily refuse the connection — Ritual's testnet
  // currently accepts it and then never answers. Without an explicit timeout the read
  // promise simply never settles, so the UI shows neither data nor an error and quietly
  // keeps displaying whatever it last read from a different chain. Fail fast instead.
  return createPublicClient({
    chain,
    transport: http(undefined, { timeout: 8_000, retryCount: 1, retryDelay: 500 }),
  });
}

export function writeClient(chain: Chain, account: `0x${string}`) {
  const provider = getProvider();
  if (!provider) throw new Error("No injected wallet found.");
  return createWalletClient({ account, chain, transport: custom(provider) });
}

/** Ask the wallet to switch, adding the chain first if it does not know it yet. */
export async function switchChain(chainId: number): Promise<void> {
  const provider = getProvider();
  const chain = chainById(chainId);
  if (!provider || !chain) throw new Error("Unsupported chain.");

  const hexId = `0x${chainId.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (error) {
    // 4902: the wallet has never heard of this chain, so offer to add it.
    const code = (error as { code?: number }).code;
    if (code !== 4902) throw error;

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexId,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [...chain.rpcUrls.default.http],
          blockExplorerUrls: chain.blockExplorers
            ? [chain.blockExplorers.default.url]
            : undefined,
        },
      ],
    });
  }
}

export const DEFAULT_CHAIN = localChain;
export { SUPPORTED_CHAINS };
