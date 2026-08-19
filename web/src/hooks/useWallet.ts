"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { chainById } from "@/lib/chains";
import {
  DEFAULT_CHAIN,
  getProvider,
  readClient,
  switchChain,
  writeClient,
} from "@/lib/wallet";

export type WalletState = {
  account: `0x${string}` | undefined;
  chainId: number | undefined;
  isSupportedChain: boolean;
  hasWallet: boolean;
  connecting: boolean;
  error: string | undefined;
};

/**
 * Injected-wallet connection, deliberately without a wallet library.
 *
 * Reads never depend on it: `publicClient` follows the wallet's chain when that chain
 * is one we support and falls back to the default otherwise, so the market list works
 * before anyone connects.
 */
export function useWallet() {
  const [account, setAccount] = useState<`0x${string}` | undefined>();
  const [chainId, setChainId] = useState<number | undefined>();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [hasWallet, setHasWallet] = useState(false);

  useEffect(() => {
    const provider = getProvider();
    setHasWallet(Boolean(provider));
    if (!provider) return;

    // Reconnect silently if this site is already authorised.
    void (async () => {
      try {
        const accounts = (await provider.request({ method: "eth_accounts" })) as `0x${string}`[];
        if (accounts.length > 0) setAccount(accounts[0]);
        const id = (await provider.request({ method: "eth_chainId" })) as string;
        setChainId(Number.parseInt(id, 16));
      } catch {
        // A wallet that refuses to answer is treated as "not connected".
      }
    })();

    const onAccountsChanged = (...args: never[]) => {
      const accounts = args[0] as unknown as `0x${string}`[];
      setAccount(accounts?.[0]);
    };
    const onChainChanged = (...args: never[]) => {
      setChainId(Number.parseInt(args[0] as unknown as string, 16));
    };

    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("chainChanged", onChainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, []);

  const connect = useCallback(async () => {
    const provider = getProvider();
    if (!provider) {
      setError("No injected wallet found. Install MetaMask or another EIP-1193 wallet.");
      return;
    }

    setConnecting(true);
    setError(undefined);
    try {
      const accounts = (await provider.request({
        method: "eth_requestAccounts",
      })) as `0x${string}`[];
      setAccount(accounts[0]);
      const id = (await provider.request({ method: "eth_chainId" })) as string;
      setChainId(Number.parseInt(id, 16));
    } catch (cause) {
      setError((cause as Error).message ?? "Could not connect.");
    } finally {
      setConnecting(false);
    }
  }, []);

  const requestChain = useCallback(async (id: number) => {
    setError(undefined);
    try {
      await switchChain(id);
    } catch (cause) {
      setError((cause as Error).message ?? "Could not switch chain.");
    }
  }, []);

  const chain = chainById(chainId) ?? DEFAULT_CHAIN;
  const isSupportedChain = chainById(chainId) !== undefined;

  const publicClient = useMemo(() => readClient(chain), [chain]);

  const getWalletClient = useCallback(() => {
    if (!account) throw new Error("Connect a wallet first.");
    if (!isSupportedChain) throw new Error("Switch to a supported network first.");
    return writeClient(chain, account);
  }, [account, chain, isSupportedChain]);

  return {
    account,
    chainId,
    chain,
    isSupportedChain,
    hasWallet,
    connecting,
    error,
    connect,
    requestChain,
    publicClient,
    getWalletClient,
  };
}
