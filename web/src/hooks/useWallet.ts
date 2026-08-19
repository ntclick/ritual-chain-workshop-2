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

const CHAIN_KEY = "ritual-predict:chain";

/**
 * Injected-wallet connection, deliberately without a wallet library.
 *
 * The chain the app *reads* from is chosen here and is independent of whatever the
 * wallet happens to be pointed at. Tying reads to the wallet looks tidy until the
 * wallet sits on a network whose RPC is down — Ritual's testnet, say — and the whole
 * page goes blank even though the contract the user configured lives on a local node
 * that is running perfectly well. Selecting a chain still *asks* the wallet to follow,
 * because writes must go to the same place, but a wallet that declines no longer takes
 * the market list down with it.
 */
export function useWallet() {
  const [account, setAccount] = useState<`0x${string}` | undefined>();
  const [walletChainId, setWalletChainId] = useState<number | undefined>();
  const [readChainId, setReadChainId] = useState<number>(DEFAULT_CHAIN.id);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [hasWallet, setHasWallet] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(CHAIN_KEY);
    if (stored && chainById(Number(stored))) setReadChainId(Number(stored));
  }, []);

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
        setWalletChainId(Number.parseInt(id, 16));
      } catch {
        // A wallet that refuses to answer is treated as "not connected".
      }
    })();

    const onAccountsChanged = (...args: never[]) => {
      const accounts = args[0] as unknown as `0x${string}`[];
      setAccount(accounts?.[0]);
    };
    const onChainChanged = (...args: never[]) => {
      setWalletChainId(Number.parseInt(args[0] as unknown as string, 16));
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
      setWalletChainId(Number.parseInt(id, 16));
    } catch (cause) {
      setError((cause as Error).message ?? "Could not connect.");
    } finally {
      setConnecting(false);
    }
  }, []);

  /** Point the app at a chain, and ask the wallet to come along if there is one. */
  const requestChain = useCallback(async (id: number) => {
    if (!chainById(id)) return;
    setError(undefined);
    setReadChainId(id);
    window.localStorage.setItem(CHAIN_KEY, String(id));

    if (!getProvider()) return;
    try {
      await switchChain(id);
    } catch (cause) {
      // Reads already moved; only writes need the wallet to agree.
      setError(
        `Viewing ${chainById(id)?.name}, but the wallet did not switch: ` +
          `${(cause as Error).message ?? "unknown error"}`,
      );
    }
  }, []);

  const chain = chainById(readChainId) ?? DEFAULT_CHAIN;

  /** True when the wallet can sign for the chain being viewed. */
  const walletOnReadChain = walletChainId === chain.id;

  const publicClient = useMemo(() => readClient(chain), [chain]);

  const getWalletClient = useCallback(() => {
    if (!account) throw new Error("Connect a wallet first.");
    if (!walletOnReadChain) {
      throw new Error(`Switch the wallet to ${chain.name} first.`);
    }
    return writeClient(chain, account);
  }, [account, chain, walletOnReadChain]);

  return {
    account,
    /** The chain the app is reading from. */
    chain,
    chainId: chain.id,
    /** Whatever the wallet is actually on, which may differ. */
    walletChainId,
    isSupportedChain: walletOnReadChain,
    hasWallet,
    connecting,
    error,
    connect,
    requestChain,
    publicClient,
    getWalletClient,
  };
}
