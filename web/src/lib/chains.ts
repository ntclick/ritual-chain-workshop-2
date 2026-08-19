import { defineChain } from "viem";

/**
 * Ritual Chain testnet.
 *
 * Block timestamps here are Unix **milliseconds**, not seconds. Nothing in this app
 * relies on them — like the contract, it counts in block numbers.
 */
export const ritualChain = defineChain({
  id: 1979,
  name: "Ritual Chain",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_RITUAL_RPC_URL ?? "https://rpc.ritualfoundation.org"],
    },
  },
  blockExplorers: {
    default: { name: "Ritual Explorer", url: "https://explorer.ritualfoundation.org" },
  },
});

/**
 * A local Hardhat node with the Ritual system contracts etched in.
 *
 * `hardhat/scripts/local-node-setup.ts` puts the mock runtime code at the canonical
 * addresses, so the exact same contract — and therefore this exact frontend — runs
 * end to end without a testnet.
 */
export const localChain = defineChain({
  id: 31337,
  name: "Hardhat (local Ritual)",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

export const SUPPORTED_CHAINS = [localChain, ritualChain] as const;

export function chainById(id: number | undefined) {
  return SUPPORTED_CHAINS.find((chain) => chain.id === id);
}

/**
 * Which chain to open on when the visitor has no stored preference.
 *
 * A deployed build must not default to a Hardhat node on 127.0.0.1 — that address means
 * "my own machine" to whoever loads the page, so every visitor would get a dead RPC.
 * `NEXT_PUBLIC_DEFAULT_CHAIN_ID` decides it; failing that, anything not served from
 * localhost is assumed to be a real deployment.
 *
 * Only ever called from an effect, never during render: the server cannot know the
 * hostname the client will see, and disagreeing about it would be a hydration mismatch.
 */
export function defaultChain() {
  const fromEnv = chainById(Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID));
  if (fromEnv) return fromEnv;

  const host = typeof window === "undefined" ? "" : window.location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "";
  return isLocal ? localChain : ritualChain;
}

export function explorerTx(chainId: number | undefined, hash: string): string | undefined {
  const url = chainById(chainId)?.blockExplorers?.default.url;
  return url ? `${url}/tx/${hash}` : undefined;
}

export function explorerAddress(chainId: number | undefined, address: string): string | undefined {
  const url = chainById(chainId)?.blockExplorers?.default.url;
  return url ? `${url}/address/${address}` : undefined;
}
