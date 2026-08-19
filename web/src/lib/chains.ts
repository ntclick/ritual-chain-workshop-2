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

export function explorerTx(chainId: number | undefined, hash: string): string | undefined {
  const url = chainById(chainId)?.blockExplorers?.default.url;
  return url ? `${url}/tx/${hash}` : undefined;
}

export function explorerAddress(chainId: number | undefined, address: string): string | undefined {
  const url = chainById(chainId)?.blockExplorers?.default.url;
  return url ? `${url}/address/${address}` : undefined;
}
