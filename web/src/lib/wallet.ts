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

/** What a wallet announces about itself under EIP-6963. */
type ProviderDetail = {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
};

const announced: ProviderDetail[] = [];

/**
 * The wallet, however it chooses to make itself known.
 *
 * Reading `window.ethereum` once on mount is a race the page usually loses: extensions
 * inject asynchronously, and a first load over the network gives them less slack than a
 * warm reload from localhost. The symptom is a site insisting no wallet is installed
 * while MetaMask sits in the toolbar.
 *
 * EIP-6963 exists for exactly this — wallets announce themselves in response to an
 * event, so there is nothing to be early for. `window.ethereum` stays as the fallback
 * for anything that does not implement it.
 */
export function getProvider(): Eip1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  return announced[0]?.provider ?? window.ethereum;
}

export function announcedWallets(): ProviderDetail[] {
  return announced;
}

/**
 * Ask every installed wallet to announce itself, and keep listening.
 *
 * Calls `onChange` whenever the answer changes, so a wallet that arrives after first
 * paint still turns the UI on. Returns an unsubscribe.
 */
export function discoverProviders(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<ProviderDetail>).detail;
    if (!detail?.provider) return;
    if (announced.some((p) => p.info.uuid === detail.info.uuid)) return;
    announced.push(detail);
    onChange();
  };

  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  // Belt and braces for wallets that predate EIP-6963: poll briefly for the legacy
  // injection rather than deciding on the first frame that there is nothing there.
  let tries = 0;
  const legacy = window.setInterval(() => {
    tries += 1;
    if (window.ethereum || announced.length > 0) {
      onChange();
      window.clearInterval(legacy);
    } else if (tries >= 10) {
      window.clearInterval(legacy);
    }
  }, 300);

  return () => {
    window.removeEventListener("eip6963:announceProvider", onAnnounce);
    window.clearInterval(legacy);
  };
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
